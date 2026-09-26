// @vitest-environment jsdom
// BUG A — Cambiar de pestaña (ocultar un panel) NO puede cerrar su bridge.
//
// Medido en la app real: al volver a una pestaña los paneles aparecían
// «desconectados» y solo se recuperaban pulsando a un agente en la barra,
// porque `release()` cerraba el bridge al desmontar la vista del tab oculto.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openCalls: Array<{ paneId: string; bridgeId: number; frame: (buffer: ArrayBuffer) => void }> =
  [];
const closeCalls: number[] = [];
let nextBridge = 500;

vi.mock('../herdr/client', () => ({
  terminalOpen: vi.fn(
    async (
      paneId: string,
      _cols: number,
      _rows: number,
      onFrame: (buffer: ArrayBuffer) => void,
    ) => {
      const bridgeId = (nextBridge += 1);
      openCalls.push({ paneId, bridgeId, frame: onFrame });
      return bridgeId;
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

const { pool } = await import('./pool');

/** Frame completo válido (cabecera de 16 bytes + payload). */
function fullFrame(text: string): ArrayBuffer {
  const payload = new TextEncoder().encode(text);
  const buffer = new Uint8Array(16 + payload.length);
  buffer[0] = 1; // FLAG_FULL
  new DataView(buffer.buffer).setUint32(8, 7, true); // seq
  new DataView(buffer.buffer).setUint32(12, payload.length, true);
  buffer.set(payload, 16);
  return buffer.buffer;
}

beforeEach(() => {
  vi.useFakeTimers();
  openCalls.length = 0;
  closeCalls.length = 0;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
});

afterEach(() => {
  pool.disposeAll();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ocultar un panel (cambio de pestaña)', () => {
  it('no cierra el bridge y el panel sigue «open»', async () => {
    const entry = await pool.open('w1:p1', 80, 24, 1);
    const bridge = entry.bridgeId;
    expect(bridge).not.toBeNull();
    closeCalls.length = 0;

    // Cambio de pestaña: la vista se oculta (y se desmonta).
    pool.hide('w1:p1');
    await vi.advanceTimersByTimeAsync(50);

    expect(closeCalls).toEqual([]); // el bridge NO se cerró
    expect(entry.bridgeId).toBe(bridge);
    expect(entry.state).toBe('open');
    expect(entry.visible).toBe(false);
  });

  it('al volver reutiliza el MISMO bridge (sin reconectar ni parpadear)', async () => {
    await pool.open('w1:p1', 80, 24, 1);
    pool.hide('w1:p1');
    pool.show('w1:p1');
    await pool.open('w1:p1', 80, 24, 1);

    expect(openCalls).toHaveLength(1); // no hubo una segunda apertura
    expect(closeCalls).toEqual([]);
    expect(pool.entry('w1:p1')?.state).toBe('open');
    expect(pool.entry('w1:p1')?.visible).toBe(true);
  });

  it('el panel oculto sigue recibiendo frames (su canal no se pierde)', async () => {
    const entry = await pool.open('w1:p1', 80, 24, 1);
    pool.hide('w1:p1');
    const before = entry.framesSinceOpen;

    openCalls[0]?.frame(fullFrame('hola'));
    await vi.advanceTimersByTimeAsync(20);

    expect(entry.framesSinceOpen).toBe(before + 1);
  });

  it('conserva la instancia (buffer) y suelta WebGL al ocultar, y lo reengancha al volver', async () => {
    const entry = await pool.open('w1:p1', 80, 24, 1);
    const terminal = entry.terminal;
    // WebGL simulado: el addon solo tiene que soltarse/volver a pedirse.
    let disposed = 0;
    entry.webgl = true;
    entry.webglAddon = { dispose: () => void (disposed += 1) } as never;

    pool.hide('w1:p1');
    expect(disposed).toBe(1); // el contexto GPU se suelta
    expect(entry.webglAddon).toBeNull();
    expect(entry.terminal).toBe(terminal); // la instancia sigue viva (buffer intacto)
    expect(pool.openWebgl).toBe(0);

    pool.show('w1:p1');
    await vi.advanceTimersByTimeAsync(30);
    expect(pool.entry('w1:p1')?.terminal).toBe(terminal);
  });

  it('sync cierra SOLO los paneles que ya no existen', async () => {
    await pool.open('w1:p1', 80, 24, 1);
    await pool.open('w1:p2', 80, 24, 1);
    closeCalls.length = 0;

    pool.sync(['w1:p1']); // el usuario cerró w1:p2
    await vi.advanceTimersByTimeAsync(20);

    expect(closeCalls).toEqual([openCalls[1]?.bridgeId]);
    expect(pool.entry('w1:p2')).toBeUndefined();
    expect(pool.entry('w1:p1')).toBeDefined();
    expect(pool.entry('w1:p1')?.state).toBe('open');
  });
});
