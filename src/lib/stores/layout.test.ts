// @vitest-environment jsdom
// Regresión del fallo en vivo: tras un split o un cierre, el `layout.export`
// podía llegar ANTES de que el server publicara el layout nuevo, así que la UI se
// quedaba con el árbol viejo (el panel nuevo no aparecía / el cerrado seguía en
// pantalla). El store compara el árbol con los panes del snapshot y reintenta.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../herdr/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../herdr/actions')>();
  return {
    ...actual,
    layoutApi: { ...actual.layoutApi, export: vi.fn() },
  };
});

import { layoutApi, type LayoutNode } from '../herdr/actions';
import type { SessionSnapshot } from '../herdr/types';
import { layout } from './layout.svelte';
import { session } from './session.svelte';

const STALE: LayoutNode = { type: 'pane', pane_id: 'w1:p1' };
const FRESH: LayoutNode = {
  type: 'split',
  direction: 'right',
  ratio: 0.5,
  first: { type: 'pane', pane_id: 'w1:p1' },
  second: { type: 'pane', pane_id: 'w1:p2' },
};

/** Snapshot que YA conoce los dos paneles del tab. */
function snapshot(): SessionSnapshot {
  return {
    version: '0.8.0-preview.test',
    protocol: 19,
    focused_workspace_id: 'w1',
    focused_tab_id: 'w1:t1',
    focused_pane_id: 'w1:p1',
    workspaces: [],
    tabs: [],
    panes: [],
    agents: [],
    layouts: [
      {
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        zoomed: false,
        area: { x: 0, y: 0, width: 100, height: 100 },
        focused_pane_id: 'w1:p1',
        panes: [
          { pane_id: 'w1:p1', focused: true, rect: { x: 0, y: 0, width: 50, height: 100 } },
          { pane_id: 'w1:p2', focused: false, rect: { x: 50, y: 0, width: 50, height: 100 } },
        ],
        splits: [],
      },
    ],
  } as unknown as SessionSnapshot;
}

beforeEach(() => {
  session.applySnapshot(snapshot());
  layout.reset();
  vi.mocked(layoutApi.export).mockReset();
});

afterEach(() => {
  layout.reset();
  session.reset();
});

describe('export del árbol de paneles', () => {
  it('reintenta si el primer export llega antes que el layout nuevo (árbol incompleto)', async () => {
    vi.mocked(layoutApi.export).mockResolvedValueOnce(STALE).mockResolvedValueOnce(FRESH);

    await layout.refreshNow('w1:t1');
    // El reintento va con temporizador (LAYOUT_EXPORT_RETRY_MS): se le da margen.
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(layoutApi.export).toHaveBeenCalledTimes(2);
    expect(layout.paneCount).toBe(2);
    expect(layout.tree?.second?.paneId).toBe('w1:p2');
  });

  it('acepta el export cuando cuadra con los panes del snapshot (sin reintentos de más)', async () => {
    vi.mocked(layoutApi.export).mockResolvedValue(FRESH);

    await layout.refreshNow('w1:t1');

    expect(layoutApi.export).toHaveBeenCalledTimes(1);
    expect(layout.paneCount).toBe(2);
  });

  it('deja de reintentar y aplica lo que haya si el export nunca cuadra', async () => {
    vi.mocked(layoutApi.export).mockResolvedValue(STALE);

    await layout.refreshNow('w1:t1');
    // Los reintentos son asíncronos (LAYOUT_EXPORT_RETRY_MS): se espera a que paren.
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(layoutApi.export).toHaveBeenCalledTimes(3);
    expect(layout.paneCount).toBe(1);
  });

  it('un tab sin referencia en el snapshot no provoca reintentos', async () => {
    session.applySnapshot({ ...snapshot(), layouts: [] } as unknown as SessionSnapshot);
    vi.mocked(layoutApi.export).mockResolvedValue(STALE);

    await layout.refreshNow('w1:t1');

    expect(layoutApi.export).toHaveBeenCalledTimes(1);
    expect(layout.paneCount).toBe(1);
  });
});
