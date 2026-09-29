// @vitest-environment jsdom
// Tamaño del panel = tamaño del server. El fallo reportado era «al cambiar de
// espacio, la terminal no se expande y la gráfica de opencode sale rota hasta
// redimensionar a mano o pulsar Ctrl+P».
//
// Causa raíz: `#forceRepaint` (el repintado que pide `show`/`open` cuando el
// bridge sobrevivió a la gracia del `hide`) usa `entry.lastCols/lastRows`, y esos
// eran los del MONTAJE ANTERIOR. Con la rejilla vieja, el server repinta a otro
// tamaño y la vista nueva queda con la imagen descolocada. `setSize()` mete
// aquí el tamaño real de la vista antes de `show`/`open`, y `syncSize()` en el
// componente avisa por `resize` cuando la vista y el server discrepan.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Terminal } from '@xterm/xterm';

interface OpenCall {
  paneId: string;
  bridgeId: number;
  frame: (buffer: ArrayBuffer) => void;
}

const openCalls: OpenCall[] = [];
const closeCalls: number[] = [];
const releaseCalls: number[] = [];
const resizeCalls: Array<{ bridgeId: number; cols: number; rows: number }> = [];
/** Dimensiones de la cabecera de cada frame que el «server» mandó. */
const frameDims: Array<{ cols: number; rows: number }> = [];
const liveByPane = new Map<string, number>();
const paneByBridge = new Map<number, string>();
const screenByPane = new Map<string, string>();
let nextBridge = 700;
let seq = 0;

/** Frame con el layout real del protocolo (seq u64, w/h u16, flags, payload). */
function frameWith(text: string, cols = 80, rows = 24): ArrayBuffer {
  seq += 1;
  const payload = new TextEncoder().encode(text);
  const buffer = new Uint8Array(16 + payload.length);
  const view = new DataView(buffer.buffer);
  view.setBigUint64(0, BigInt(seq), true);
  view.setUint16(8, cols, true);
  view.setUint16(10, rows, true);
  buffer[12] = 1; // full
  buffer.set(payload, 16);
  frameDims.push({ cols, rows });
  return buffer.buffer;
}

vi.mock('../herdr/client', () => ({
  terminalOpen: vi.fn(
    async (paneId: string, cols: number, rows: number, onFrame: (b: ArrayBuffer) => void) => {
      const existing = liveByPane.get(paneId);
      if (existing !== undefined) {
        // El backend reutiliza el bridge que sigue vivo (solo cambia el canal) y
        // manda el viewport completo con la rejilla que él cree tener.
        onFrame(frameWith(screenByPane.get(paneId) ?? '', cols, rows));
        openCalls.push({ paneId, bridgeId: existing, frame: onFrame });
        return existing;
      }
      const bridgeId = (nextBridge += 1);
      liveByPane.set(paneId, bridgeId);
      paneByBridge.set(bridgeId, paneId);
      openCalls.push({ paneId, bridgeId, frame: onFrame });
      onFrame(frameWith(screenByPane.get(paneId) ?? '', cols, rows));
      return bridgeId;
    },
  ),
  terminalClose: vi.fn(async (bridgeId: number) => {
    closeCalls.push(bridgeId);
    const paneId = paneByBridge.get(bridgeId);
    if (paneId) liveByPane.delete(paneId);
  }),
  terminalRelease: vi.fn(async (bridgeId: number) => {
    releaseCalls.push(bridgeId);
    const paneId = paneByBridge.get(bridgeId);
    if (paneId) liveByPane.delete(paneId);
    return true;
  }),
  terminalInput: vi.fn(async () => undefined),
  terminalInputBytes: vi.fn(async () => undefined),
  terminalResize: vi.fn(async (bridgeId: number, cols: number, rows: number) => {
    resizeCalls.push({ bridgeId, cols, rows });
    // El server rehace el viewport con la rejilla pedida y manda un `full`.
    const paneId = paneByBridge.get(bridgeId);
    const call = openCalls.filter((item) => item.bridgeId === bridgeId).at(-1);
    if (paneId && call) call.frame(frameWith(screenByPane.get(paneId) ?? '', cols, rows));
  }),
  terminalScroll: vi.fn(async () => undefined),
  configRead: vi.fn(async () => ({ ok: false, kind: 'missing' })),
  configWrite: vi.fn(async () => ({ ok: false, kind: 'missing' })),
  guiSettingsRead: vi.fn(async () => ({ ok: false, kind: 'missing' })),
  guiSettingsWrite: vi.fn(async () => ({ ok: false, kind: 'missing' })),
}));

const { pool } = await import('./pool');
const { settings } = await import('../stores/settings.svelte');

function host(): HTMLDivElement {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

function mount(paneId: string): NonNullable<ReturnType<typeof pool.mountView>['view']> {
  const entry = pool.mountView(paneId, host());
  if (!entry.view) throw new Error('el montaje no creó la vista');
  return entry.view;
}

function bufferText(terminal: Terminal): string {
  const lines: string[] = [];
  for (let index = 0; index < terminal.buffer.active.length; index += 1) {
    lines.push(terminal.buffer.active.getLine(index)?.translateToString() ?? '');
  }
  return lines.join('\n');
}

/** Monta un panel con un bridge vivo, como tras abrir la pestaña por primera vez. */
async function openLive(paneId: string, cols: number, rows: number): Promise<void> {
  mount(paneId);
  pool.setSize(paneId, cols, rows);
  await pool.open(paneId, cols, rows, 1);
  // El watchdog de 1,5 s no debe interferir con el caso que se prueba.
  openCalls.at(-1)?.frame(frameWith(screenByPane.get(paneId) ?? '', cols, rows));
}

beforeEach(() => {
  vi.useFakeTimers();
  openCalls.length = 0;
  closeCalls.length = 0;
  releaseCalls.length = 0;
  resizeCalls.length = 0;
  frameDims.length = 0;
  liveByPane.clear();
  paneByBridge.clear();
  screenByPane.clear();
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

describe('setSize: el tamaño de la vista antes de show/open', () => {
  it('sin bridge solo guarda el tamaño (no inventa un resize)', () => {
    mount('w1:p1');

    pool.setSize('w1:p1', 143, 42);

    const entry = pool.entry('w1:p1');
    expect(entry?.lastCols).toBe(143);
    expect(entry?.lastRows).toBe(42);
    expect(resizeCalls).toEqual([]);
  });

  it('con bridge vivo y tamaño distinto manda el resize al server', async () => {
    await openLive('w1:p1', 143, 42);
    resizeCalls.length = 0;

    pool.setSize('w1:p1', 80, 24);

    expect(resizeCalls).toEqual([{ bridgeId: openCalls[0]?.bridgeId, cols: 80, rows: 24 }]);
    expect(pool.entry('w1:p1')?.lastCols).toBe(80);
    expect(pool.entry('w1:p1')?.lastRows).toBe(24);
  });

  it('con el MISMO tamaño no manda nada (evita resized de humo)', async () => {
    await openLive('w1:p1', 143, 42);
    resizeCalls.length = 0;

    pool.setSize('w1:p1', 143, 42);

    expect(resizeCalls).toEqual([]);
  });

  it('ignora tamaños imposibles y los acota a los mínimos del pool', () => {
    mount('w1:p1');
    // La entrada nace en 80x24 (el default de xterm).
    expect(pool.entry('w1:p1')?.lastCols).toBe(80);

    pool.setSize('w1:p1', 0, 0);
    expect(pool.entry('w1:p1')?.lastCols).toBe(80); // nada cambia

    pool.setSize('w1:p1', -5, -5);
    expect(pool.entry('w1:p1')?.lastCols).toBe(80);

    pool.setSize('w1:p1', 3, 2);
    expect(pool.entry('w1:p1')?.lastCols).toBe(20);
    expect(pool.entry('w1:p1')?.lastRows).toBe(5);
  });

  it('un panel desconocido no rompe nada', () => {
    expect(() => pool.setSize('w9:no-existe', 80, 24)).not.toThrow();
  });
});

describe('F3: al volver a un espacio el server recibe el tamaño REAL', () => {
  it('el repintado tras la gracia usa la rejilla nueva, no la del montaje anterior', async () => {
    // Espacio 1: panel ancho (143x42), el agente escribe su gráfica ahí.
    screenByPane.set('w1:p1', 'grafica-opencode');
    await openLive('w1:p1', 143, 42);
    const bridge = openCalls[0]?.bridgeId;
    resizeCalls.length = 0;
    frameDims.length = 0;

    // Cambio de espacio: se desmonta la vista y el bridge espera la gracia.
    pool.hide('w1:p1');
    expect(pool.entry('w1:p1')?.bridgeId).toBe(bridge);

    // Vuelta dentro de la gracia, en un panel estrecho: la vista nace con la
    // rejilla buena y hay que decírsela al server ANTES de repintar.
    const second = mount('w1:p1');
    pool.setSize('w1:p1', 80, 24);
    pool.show('w1:p1');
    await vi.advanceTimersByTimeAsync(30);

    // El truco del repintado va a la rejilla nueva (78x24 y vuelta a 80x24), no
    // a la vieja del espacio anterior (143x42): eso era la gráfica rota.
    expect(resizeCalls.map((call) => `${call.cols}x${call.rows}`)).toEqual(['78x24', '80x24']);
    expect(resizeCalls.every((call) => call.bridgeId === bridge)).toBe(true);
    // Y el último frame que llega al server lleva ya la rejilla buena.
    expect(frameDims.at(-1)).toEqual({ cols: 80, rows: 24 });
    expect(bufferText(second.terminal)).toContain('grafica-opencode');
  });

  it('pasada la gracia el reenganche abre con el tamaño real', async () => {
    screenByPane.set('w1:p1', 'contenido');
    await openLive('w1:p1', 143, 42);
    pool.hide('w1:p1');
    await vi.advanceTimersByTimeAsync(3000); // el bridge se suelta de verdad
    expect(pool.entry('w1:p1')?.bridgeId).toBeNull();

    const second = mount('w1:p1');
    pool.setSize('w1:p1', 100, 30);
    await pool.open('w1:p1', 100, 30, 2);
    await vi.advanceTimersByTimeAsync(30); // el writer entrega el frame

    expect(openCalls).toHaveLength(2);
    expect(openCalls[1]?.bridgeId).not.toBe(openCalls[0]?.bridgeId);
    // El bridge nuevo nace con la rejilla de la vista, no con la del espacio viejo.
    expect(frameDims.at(-1)).toEqual({ cols: 100, rows: 30 });
    expect(pool.entry('w1:p1')?.lastCols).toBe(100);
    expect(bufferText(second.terminal)).toContain('contenido');
  });

  it('con el bridge liberado la vista nueva se repinta al tamaño del panel', async () => {
    screenByPane.set('w1:p1', 'vivo');
    await openLive('w1:p1', 143, 42);
    pool.hide('w1:p1');
    await vi.advanceTimersByTimeAsync(3000);

    const second = mount('w1:p1');
    pool.setSize('w1:p1', 60, 20);
    await pool.open('w1:p1', 60, 20, 3);
    await vi.advanceTimersByTimeAsync(30);

    expect(frameDims.at(-1)).toEqual({ cols: 60, rows: 20 });
    expect(bufferText(second.terminal)).toContain('vivo');
    expect(settings.values.bridge_grace_ms).toBe(3000);
  });
});

describe('resize sin temblor (barra lateral): xterm adopta la rejilla con el full', () => {
  it('no reflowa en local: cambia de rejilla al llegar el full del tamaño pedido', async () => {
    screenByPane.set('w1:p1', 'estable');
    await openLive('w1:p1', 80, 24);
    await vi.advanceTimersByTimeAsync(30);
    const terminal = pool.entry('w1:p1')?.view?.terminal;
    if (!terminal) throw new Error('sin vista');
    resizeCalls.length = 0;

    pool.resizeDeferred('w1:p1', 100, 24);

    // El server recibió el tamaño y su full (100x24) ya puso la rejilla nueva.
    expect(resizeCalls).toEqual([{ bridgeId: openCalls[0]?.bridgeId, cols: 100, rows: 24 }]);
    expect(terminal.cols).toBe(100);
    expect(pool.entry('w1:p1')?.pendingSize).toBeNull();
  });

  it('un full viejo (otro tamaño) no cambia la rejilla; el plazo aplica el pedido', async () => {
    await openLive('w1:p1', 80, 24);
    await vi.advanceTimersByTimeAsync(30);
    const entry = pool.entry('w1:p1');
    const terminal = entry?.view?.terminal;
    if (!entry || !terminal) throw new Error('sin vista');
    const { terminalResize } = await import('../herdr/client');
    vi.mocked(terminalResize).mockImplementationOnce(async () => undefined); // server mudo

    pool.resizeDeferred('w1:p1', 90, 30);
    openCalls.at(-1)?.frame(frameWith('viejo', 80, 24));
    expect(terminal.cols).toBe(80);

    await vi.advanceTimersByTimeAsync(300);
    expect(terminal.cols).toBe(90);
    expect(terminal.rows).toBe(30);
  });
});
