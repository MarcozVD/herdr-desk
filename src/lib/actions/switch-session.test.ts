// @vitest-environment jsdom
// Regresión del fallo «al cambiar de sesión se ven los panes de la sesión vieja
// con terminales en desconectado». Un cambio de sesión tiene que:
//   1. dejar UNA sola suscripción viva (los mensajes del canal anterior se
//      descartan aunque lleguen tarde),
//   2. descartar TODO el estado de la sesión anterior (snapshot, colecciones,
//      foco, árbol de panes, terminales y bridges, foco local),
//   3. aplicar limpiamente el snapshot de la sesión nueva.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const subscribeCallbacks: Array<(message: unknown) => void> = [];

vi.mock('../herdr/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../herdr/client')>();
  return {
    ...actual,
    call: vi.fn(async () => ({ type: 'ok' })),
    storeSubscribe: vi.fn(async (onMessage: (message: unknown) => void) => {
      subscribeCallbacks.push(onMessage);
    }),
    sessionCurrent: vi.fn(async () => ({ ok: true, value: 'herdr-desk-dev' })),
  };
});

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

import type { SessionSnapshot } from '../herdr/types';
import { buildTree } from '../layout/tree';
import { flows } from './flows';
import { layout } from '../stores/layout.svelte';
import { session } from '../stores/session.svelte';
import { ui } from '../stores/ui.svelte';
import { pool } from '../terminal/pool';

beforeAll(() => {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
});

function snapshot(paneIds: string[]): SessionSnapshot {
  return {
    version: '0.8.0-preview.test',
    protocol: 19,
    focused_workspace_id: 'w1',
    focused_tab_id: 'w1:t1',
    focused_pane_id: paneIds[0] ?? null,
    workspaces: [
      {
        workspace_id: 'w1',
        number: 1,
        label: 'vieja',
        focused: true,
        pane_count: paneIds.length,
        tab_count: 1,
        active_tab_id: 'w1:t1',
        agent_status: 'unknown',
      },
    ],
    tabs: [
      {
        tab_id: 'w1:t1',
        workspace_id: 'w1',
        number: 1,
        label: '1',
        focused: true,
        pane_count: paneIds.length,
        agent_status: 'unknown',
      },
    ],
    panes: paneIds.map((paneId) => ({
      pane_id: paneId,
      terminal_id: `term_${paneId}`,
      workspace_id: 'w1',
      tab_id: 'w1:t1',
      focused: paneId === paneIds[0],
      agent_status: 'unknown',
      revision: 0,
    })),
    agents: [],
    layouts: [],
  } as unknown as SessionSnapshot;
}

/** Estado de la sesión A montado a mano (snapshot + árbol + terminal + foco). */
function setOldSessionState(): void {
  session.applySnapshot(snapshot(['w1:p1', 'w1:p2']));
  layout.tree = buildTree({
    type: 'split',
    direction: 'right',
    ratio: 0.5,
    first: { type: 'pane', pane_id: 'w1:p1' },
    second: { type: 'pane', pane_id: 'w1:p2' },
  });
  layout.tabId = 'w1:t1';
  pool.ensure('w1:p1');
  pool.ensure('w1:p2');
  ui.focusPaneLocally('w1:p1');
}

afterEach(() => {
  pool.disposeAll();
  session.reset();
  layout.reset();
  ui.resetSessionState();
  subscribeCallbacks.length = 0;
});

describe('cambio de sesión: no queda nada de la sesión anterior', () => {
  it('descarta snapshot, colecciones, foco, árbol, terminales y foco local', async () => {
    setOldSessionState();
    expect(session.panes).toHaveLength(2);
    expect(layout.tree).not.toBeNull();
    expect(pool.entries()).toHaveLength(2);
    expect(ui.localFocusedPaneId).toBe('w1:p1');

    await flows.switchSession('otra');

    expect(session.sessionName).toBe('otra');
    expect(session.snapshot).toBeNull();
    expect(session.workspaces).toEqual([]);
    expect(session.tabs).toEqual([]);
    expect(session.panes).toEqual([]);
    expect(session.agents).toEqual([]);
    expect(session.layouts).toEqual([]);
    expect(session.focusedWorkspaceId).toBeNull();
    expect(session.focusedTabId).toBeNull();
    expect(session.focusedPaneId).toBeNull();
    expect(session.connectionEpoch).toBe(0);
    expect(session.version).toBeNull();

    expect(layout.tree).toBeNull();
    expect(layout.tabId).toBeNull();
    expect(pool.entries()).toHaveLength(0);
    expect(ui.localFocusedPaneId).toBeNull();
    expect(ui.localFocusedWorkspaceId).toBeNull();
  });

  it('deja UNA sola suscripción viva: los mensajes del canal anterior se ignoran', async () => {
    await session.connect();
    expect(subscribeCallbacks).toHaveLength(1);
    const [oldChannel] = subscribeCallbacks;

    // El canal viejo alimenta el store (sesión A).
    oldChannel?.({ kind: 'snapshot', snapshot: snapshot(['w1:p1']) });
    expect(session.panes.map((pane) => pane.pane_id)).toEqual(['w1:p1']);

    // Cambio de sesión: se re-suscribe y el canal viejo queda inerte.
    await flows.switchSession('otra');
    expect(subscribeCallbacks).toHaveLength(2);
    const newChannel = subscribeCallbacks[1];

    oldChannel?.({ kind: 'snapshot', snapshot: snapshot(['w1:p9']) });
    expect(session.panes).toEqual([]);

    // El canal nuevo sí aplica su snapshot.
    newChannel?.({ kind: 'snapshot', snapshot: snapshot(['w9:p1']) });
    expect(session.panes.map((pane) => pane.pane_id)).toEqual(['w9:p1']);
    expect(session.connection).toBe('online');
  });
});
