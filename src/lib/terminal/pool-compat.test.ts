// @vitest-environment jsdom
// C1 — Server incompatible (protocolo privado viejo): el bridge muere al nacer y
// el error es DEFINITIVO. Antes la UI entraba en bucle (watchdog + reopen +
// respawn del backend) y las terminales no arrancaban nunca.
//
// Contrato:
//   - cierre con motivo `server_incompatible` => estado 'error' con mensaje;
//   - `terminal_open` rechazado con code `server_incompatible` => estado 'error';
//   - SIN watchdog y SIN reaperturas programadas.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface OpenCall {
  paneId: string;
  bridgeId: number;
  frame: (buffer: ArrayBuffer) => void;
}

const openCalls: OpenCall[] = [];
const closeCalls: number[] = [];
let nextBridge = 900;
let rejectWith: unknown = null;

/** Frame `closed` de verdad (mismo layout que el frameWith de otros tests). */
function closedFrame(reason: string): ArrayBuffer {
  const payload = new TextEncoder().encode(reason);
  const buffer = new Uint8Array(16 + payload.length);
  const view = new DataView(buffer.buffer);
  view.setBigUint64(0, 1n, true);
  view.setUint16(8, 80, true);
  view.setUint16(10, 24, true);
  buffer[12] = 2; // bit1 = closed
  buffer.set(payload, 16);
  return buffer.buffer;
}

vi.mock('../herdr/client', () => ({
  terminalOpen: vi.fn(
    async (paneId: string, _cols: number, _rows: number, onFrame: (b: ArrayBuffer) => void) => {
      if (rejectWith !== null) throw rejectWith;
      const bridgeId = (nextBridge += 1);
      openCalls.push({ paneId, bridgeId, frame: onFrame });
      return bridgeId;
    },
  ),
  terminalClose: vi.fn(async (bridgeId: number) => {
    closeCalls.push(bridgeId);
  }),
  terminalRelease: vi.fn(async () => true),
  terminalInput: vi.fn(async () => undefined),
  terminalInputBytes: vi.fn(async () => undefined),
  terminalResize: vi.fn(async () => undefined),
  terminalScroll: vi.fn(async () => undefined),
  // El store de ajustes importa estos commands: se mockean como «backend ausente».
  configRead: vi.fn(async () => ({ ok: false, kind: 'missing' })),
  configWrite: vi.fn(async () => ({ ok: false, kind: 'missing' })),
  guiSettingsRead: vi.fn(async () => ({ ok: false, kind: 'missing' })),
  guiSettingsWrite: vi.fn(async () => ({ ok: false, kind: 'missing' })),
}));

const { pool, SERVER_INCOMPATIBLE_REASON } = await import('./pool');
const { es } = await import('../i18n/es');

beforeEach(() => {
  vi.useFakeTimers();
  openCalls.length = 0;
  closeCalls.length = 0;
  rejectWith = null;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  pool.disposeAll();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('C1 — server incompatible: error definitivo, sin bucle', () => {
  it('un cierre server_incompatible deja el panel en error y no reabre', async () => {
    await pool.open('w1:p1', 80, 24, 1);
    const entry = pool.entry('w1:p1');
    expect(entry?.state).toBe('open');

    openCalls[0]?.frame(closedFrame(SERVER_INCOMPATIBLE_REASON));

    expect(entry?.state).toBe('error');
    expect(entry?.errorText).toBe(es.terminal.serverIncompatible);
    expect(entry?.bridgeId).toBeNull();
    expect(openCalls).toHaveLength(1);

    // El watchdog (1,5 s) y la reapertura programada NO deben dispararse.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(openCalls).toHaveLength(1);
    expect(closeCalls).toEqual([]);
  });

  it('terminal_open rechazado con server_incompatible conserva el mensaje del backend', async () => {
    rejectWith = {
      code: 'server_incompatible',
      message: 'El servidor de la sesion dev es herdr 0.8.0-preview (protocolo 19)…',
    };
    await pool.open('w1:p1', 80, 24, 1);
    const entry = pool.entry('w1:p1');
    expect(entry?.state).toBe('error');
    expect(entry?.errorText).toContain('protocolo 19');
    expect(openCalls).toHaveLength(0);

    rejectWith = null;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(openCalls).toHaveLength(0);
    expect(closeCalls).toEqual([]);
  });

  it('una caída normal sigue reconectando (el caso incompatible no la traga)', async () => {
    await pool.open('w1:p1', 80, 24, 1);
    const entry = pool.entry('w1:p1');

    openCalls[0]?.frame(closedFrame('server is shutting down'));

    expect(entry?.state).toBe('reconnecting');
    expect(entry?.errorText).toBe('');
  });
});
