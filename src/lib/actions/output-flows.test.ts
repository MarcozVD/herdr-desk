// @vitest-environment jsdom
// T4c — Tests propios de la salida de panel: buscar, editar el scrollback y
// esperar. Antes solo se cubría que las entradas del menú existían.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
let waitFails = false;

vi.mock('@tauri-apps/plugin-opener', () => ({
  openPath: vi.fn(async () => undefined),
  openUrl: vi.fn(async () => undefined),
}));

vi.mock('../herdr/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../herdr/client')>();
  return {
    ...actual,
    call: vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'pane.read') {
        return { type: 'pane_read', read: { text: 'línea uno\nlínea dos' } };
      }
      if (method === 'pane.wait_for_output') {
        if (waitFails) throw { code: 'timeout', message: 'no llegó el patrón' };
        return { type: 'ok' };
      }
      return { type: 'ok' };
    }),
    storeSubscribe: vi.fn(async () => undefined),
    sessionCurrent: vi.fn(async () => ({ ok: true, value: 'herdr-desk-dev' })),
    writeScratchFile: vi.fn(async () => 'C:/fake/scratch.txt'),
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

import { settings } from '../stores/settings.svelte';
import { ui } from '../stores/ui.svelte';
import { flows } from './flows';

beforeEach(() => {
  calls.length = 0;
  waitFails = false;
  ui.resetSessionState();
  settings.values.search_lines = 320;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('T4c — salida de panel', () => {
  it('buscar lee recent_unwrapped en texto y lo abre en el visor', async () => {
    await flows.searchPaneOutput('w1:p1');

    expect(calls).toEqual([
      {
        method: 'pane.read',
        params: {
          pane_id: 'w1:p1',
          source: 'recent_unwrapped',
          lines: 320,
          format: 'text',
          strip_ansi: true,
        },
      },
    ]);
    expect(ui.viewer?.text).toContain('línea dos');
  });

  it('editar scrollback usa al menos 500 líneas y abre el temporal', async () => {
    const { openPath } = await import('@tauri-apps/plugin-opener');

    await flows.editScrollback('w1:p1');

    expect(calls[0]).toMatchObject({
      method: 'pane.read',
      params: { pane_id: 'w1:p1', lines: 500, format: 'text', strip_ansi: true },
    });
    expect(openPath).toHaveBeenCalledWith('C:/fake/scratch.txt');
  });

  it('esperar con re: manda regex, timeout de 60 s y las líneas configuradas', async () => {
    vi.spyOn(ui, 'prompt').mockResolvedValue('re:error\\d+');

    await flows.waitPaneOutput('w1:p1');

    expect(calls.at(-1)).toMatchObject({
      method: 'pane.wait_for_output',
      params: {
        pane_id: 'w1:p1',
        match: { type: 'regex', value: 'error\\d+' },
        timeout_ms: 60_000,
        lines: 320,
      },
    });
    expect(ui.toasts.some((toast) => toast.text.includes('coincidió'))).toBe(true);
  });

  it('esperar con texto plano manda substring; si falla, avisa del error', async () => {
    waitFails = true;
    vi.spyOn(ui, 'prompt').mockResolvedValue('listo');

    await flows.waitPaneOutput('w1:p1');

    expect(calls.at(-1)?.params.match).toEqual({ type: 'substring', value: 'listo' });
    expect(ui.toasts.some((toast) => toast.kind === 'error')).toBe(true);
  });
});
