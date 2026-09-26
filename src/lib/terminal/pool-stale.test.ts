// @vitest-environment jsdom
// Regresión del bug de render medido en vivo: el backend REUSA el bridge (y su
// canal) de la página anterior cuando la webview se recarga, así que un bridge
// abierto puede no mandar NI UN frame. Síntoma: el panel se ve, el input
// funciona (va por otro camino) y no se pinta nada; los paneles creados después
// (bridge y canal nuevos) sí funcionan.
//
// El pool tiene que notarlo, decirlo (estado «reconectando») y reabrir el bridge
// desde cero para estrenar canal.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface OpenCall {
  paneId: string;
  frame: (buffer: ArrayBuffer) => void;
}

const openCalls: OpenCall[] = [];
const closeCalls: number[] = [];
let nextBridge = 100;

vi.mock('../herdr/client', () => ({
  terminalOpen: vi.fn(
    async (
      paneId: string,
      _cols: number,
      _rows: number,
      onFrame: (buffer: ArrayBuffer) => void,
    ) => {
      openCalls.push({ paneId, frame: onFrame });
      nextBridge += 1;
      return nextBridge;
    },
  ),
  terminalClose: vi.fn(async (bridgeId: number) => {
    closeCalls.push(bridgeId);
  }),
  terminalInput: vi.fn(async () => undefined),
  terminalInputBytes: vi.fn(async () => undefined),
  terminalResize: vi.fn(async () => undefined),
  terminalScroll: vi.fn(async () => undefined),
}));

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

import { es } from '../i18n/es';
import { FRAME_WATCHDOG_MS, MAX_STALE_REOPENS, STALE_REOPEN_DELAY_MS, pool } from './pool';

/** Frame válido (cabecera de 16 bytes + payload) para simular el servidor. */
function frameBuffer(payload = 'hola', full = true): ArrayBuffer {
  const bytes = new TextEncoder().encode(payload);
  const buffer = new ArrayBuffer(16 + bytes.byteLength);
  const view = new DataView(buffer);
  view.setBigUint64(0, 1n, true);
  view.setUint16(8, 80, true);
  view.setUint16(10, 24, true);
  view.setUint8(12, full ? 1 : 0);
  new Uint8Array(buffer, 16).set(bytes);
  return buffer;
}

beforeEach(() => {
  vi.useFakeTimers();
  openCalls.length = 0;
  closeCalls.length = 0;
});

afterEach(() => {
  pool.disposeAll();
  vi.useRealTimers();
});

describe('bridge que no manda frames (T2.8 / bug de render)', () => {
  it('lo detecta, cierra el bridge viejo y reabre para estrenar canal', async () => {
    const states: string[] = [];
    pool.subscribe({ onStateChange: (entry) => states.push(entry.state) });

    const entry = await pool.open('w1:p1', 80, 24, 1);
    const staleBridge = entry.bridgeId;
    expect(entry.state).toBe('open');
    expect(openCalls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(FRAME_WATCHDOG_MS + 10);

    // El bridge viejo se cierra y el nuevo se pide DESPUÉS de la gracia del
    // backend: reabrir antes reusaría el mismo bridge y su canal muerto.
    expect(closeCalls).toEqual([staleBridge]);
    expect(openCalls).toHaveLength(1);
    expect(states).toContain('reconnecting');
    expect(entry.closeReason).toBe(es.terminal.staleReopening);
    expect(entry.state).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(STALE_REOPEN_DELAY_MS + 10);
    expect(openCalls).toHaveLength(2);
    expect(entry.state).toBe('open');

    // El canal nuevo manda un frame: ya no se reabre más.
    openCalls[1]?.frame(frameBuffer());
    await vi.advanceTimersByTimeAsync((FRAME_WATCHDOG_MS + STALE_REOPEN_DELAY_MS) * 3);
    expect(openCalls).toHaveLength(2);
    expect(entry.state).toBe('open');
  });

  it('si el bridge manda un frame, no se toca', async () => {
    const entry = await pool.open('w1:p2', 80, 24, 1);
    openCalls[0]?.frame(frameBuffer());
    await vi.advanceTimersByTimeAsync(FRAME_WATCHDOG_MS * 3);

    expect(closeCalls).toEqual([]);
    expect(openCalls).toHaveLength(1);
    expect(entry.state).toBe('open');
  });

  it('tras agotar los reintentos lo cuenta como error real (sin bucle)', async () => {
    const entry = await pool.open('w1:p3', 80, 24, 1);
    await vi.advanceTimersByTimeAsync(
      (FRAME_WATCHDOG_MS + STALE_REOPEN_DELAY_MS) * (MAX_STALE_REOPENS + 2),
    );

    expect(openCalls).toHaveLength(1 + MAX_STALE_REOPENS);
    expect(entry.state).toBe('error');
    expect(entry.errorText).toContain('canal muerto');
  });

  it('cerrar el panel deja de vigilar (sin reaperturas fantasma)', async () => {
    await pool.open('w1:p4', 80, 24, 1);
    pool.release('w1:p4');
    const opens = openCalls.length;
    await vi.advanceTimersByTimeAsync(FRAME_WATCHDOG_MS * 3);
    expect(openCalls).toHaveLength(opens);
  });
});
