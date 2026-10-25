// @vitest-environment jsdom
// BUG 8 — `edit_scrollback` escribe el scrollback en un archivo temporal y lo
// abre con el plugin opener. El scope de `opener:allow-open-path` lo limita al
// temp de scrollback y al config de herdr; un fallo de `openPath` NO se traga
// (se registra y se avisa por toast).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scratchPath = 'C:\\Temp\\herdr-desk-scrollback-w1_p1-1.txt';
const opened: string[] = [];
let openShouldFail = false;

vi.mock('@tauri-apps/plugin-opener', () => ({
  openPath: vi.fn(async (path: string) => {
    if (openShouldFail) throw new Error('scope denegado');
    opened.push(path);
  }),
  openUrl: vi.fn(async () => undefined),
}));

vi.mock('../herdr/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../herdr/client')>();
  return {
    ...actual,
    call: vi.fn(async () => ({ type: 'pane_read', read: { text: 'salida del pane' } })),
    storeSubscribe: vi.fn(async () => undefined),
    sessionCurrent: vi.fn(async () => ({ ok: true, value: 'herdr-desk-dev' })),
    writeScratchFile: vi.fn(async () => scratchPath),
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

import { ui } from '../stores/ui.svelte';
import { flows } from './flows';

beforeEach(() => {
  opened.length = 0;
  openShouldFail = false;
  ui.resetSessionState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BUG 8 — edit_scrollback y el scope de opener', () => {
  it('abre el archivo temporal de scrollback', async () => {
    await flows.editScrollback('w1:p1');
    expect(opened).toEqual([scratchPath]);
  });

  it('si openPath falla registra el error y avisa por toast', async () => {
    openShouldFail = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await flows.editScrollback('w1:p1');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(ui.toasts.some((toast) => toast.kind === 'error')).toBe(true);
  });
});
