// @vitest-environment jsdom
// T2 — «Limpiar panel» (`pane.clear`): el flujo llama al método del server con
// el id del panel y un fallo del server NO se traga (avisa por toast).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface RecordedCall {
  method: string;
  params: unknown;
}

const calls: RecordedCall[] = [];
let shouldFail = false;

vi.mock('../herdr/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../herdr/client')>();
  return {
    ...actual,
    call: vi.fn(async (method: string, params: unknown) => {
      calls.push({ method, params });
      if (shouldFail) throw new Error('el server rechazó pane.clear');
      return { type: 'ok' };
    }),
    storeSubscribe: vi.fn(async () => undefined),
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

import { ui } from '../stores/ui.svelte';
import { flows } from './flows';

beforeEach(() => {
  calls.length = 0;
  shouldFail = false;
  ui.resetSessionState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('T2 — pane.clear', () => {
  it('limpia el panel indicado con una sola llamada', async () => {
    await flows.clearPane('w1:p1');
    expect(calls).toEqual([{ method: 'pane.clear', params: { pane_id: 'w1:p1' } }]);
  });

  it('si el server falla avisa por toast en vez de romper', async () => {
    shouldFail = true;
    await flows.clearPane('w1:p1');
    expect(ui.toasts.some((toast) => toast.kind === 'error')).toBe(true);
  });
});
