// @vitest-environment jsdom
// El bug real medido en la app: al cambiar de pestaña o de espacio los paneles se
// vaciaban (la terminal seguía «activa» pero no pintaba nada).
//
// Dos vidas separadas:
//   - el BRIDGE es del PANEL: al ocultarlo se SUELTA con `terminal_release` (el
//     server deja de mandar frames) y al volver se engancha uno NUEVO, que recibe
//     el viewport completo;
//   - la VISTA xterm es del COMPONENTE: al desmontarse se DESTRUYE (xterm no
//     soporta `open()` dos veces sobre la misma instancia: dejaba el render y el
//     buffer sin pintar).
// `terminal_close` (que mata el panel con `user_close`) solo se usa cuando el
// panel desaparece de la sesión.

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
/** Bridges vivos por panel (el backend real reutiliza el que sigue vivo). */
const liveByPane = new Map<string, number>();
const paneByBridge = new Map<number, string>();
const screenByPane = new Map<string, string>();
let nextBridge = 500;
/** `false` = backend sin `terminal_release` (aún no ha aterrizado). */
let releaseSupported = true;
let seq = 0;

/** Frame con el layout real del protocolo (seq u64, w/h u16, flags, payload). */
function frameWith(text: string, full = true): ArrayBuffer {
  seq += 1;
  const payload = new TextEncoder().encode(text);
  const buffer = new Uint8Array(16 + payload.length);
  const view = new DataView(buffer.buffer);
  view.setBigUint64(0, BigInt(seq), true);
  view.setUint16(8, 80, true);
  view.setUint16(10, 24, true);
  buffer[12] = full ? 1 : 0;
  buffer.set(payload, 16);
  return buffer.buffer;
}

vi.mock('../herdr/client', () => ({
  terminalOpen: vi.fn(
    async (paneId: string, _cols: number, _rows: number, onFrame: (b: ArrayBuffer) => void) => {
      const existing = liveByPane.get(paneId);
      if (existing !== undefined) {
        // El backend reutiliza el bridge que sigue vivo (solo cambia el canal).
        openCalls.push({ paneId, bridgeId: existing, frame: onFrame });
        return existing;
      }
      const bridgeId = (nextBridge += 1);
      liveByPane.set(paneId, bridgeId);
      paneByBridge.set(bridgeId, paneId);
      openCalls.push({ paneId, bridgeId, frame: onFrame });
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
    if (releaseSupported) {
      const paneId = paneByBridge.get(bridgeId);
      if (paneId) liveByPane.delete(paneId);
    }
    return releaseSupported;
  }),
  terminalInput: vi.fn(async () => undefined),
  terminalInputBytes: vi.fn(async () => undefined),
  terminalResize: vi.fn(async (bridgeId: number, cols: number, rows: number) => {
    resizeCalls.push({ bridgeId, cols, rows });
    // El server rehace el viewport y manda un `full` (medido contra herdr real).
    const paneId = paneByBridge.get(bridgeId);
    const call = openCalls.filter((item) => item.bridgeId === bridgeId).at(-1);
    if (paneId && call) call.frame(frameWith(screenByPane.get(paneId) ?? ''));
  }),
  terminalScroll: vi.fn(async () => undefined),
  // El store de ajustes importa estos commands: se mockean como «backend ausente».
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

beforeEach(() => {
  vi.useFakeTimers();
  openCalls.length = 0;
  closeCalls.length = 0;
  releaseCalls.length = 0;
  resizeCalls.length = 0;
  liveByPane.clear();
  paneByBridge.clear();
  screenByPane.clear();
  releaseSupported = true;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    // xterm sigue usando la API antigua en jsdom.
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

describe('ocultar un panel = soltar su bridge y destruir su vista', () => {
  it('desmontar destruye el xterm y aplaza el release hasta la gracia (T5.2)', async () => {
    const view = mount('w1:p1');
    const disposeSpy = vi.spyOn(view.terminal, 'dispose');
    await pool.open('w1:p1', 80, 24, 1);
    openCalls[0]?.frame(frameWith('vivo')); // desarma el watchdog de 1,5 s
    const entry = pool.entry('w1:p1');
    const bridge = entry?.bridgeId ?? null;
    expect(bridge).not.toBeNull();

    pool.hide('w1:p1');

    expect(disposeSpy).toHaveBeenCalled(); // la vista muere ya
    expect(entry?.view).toBeNull();
    expect(releaseCalls).toEqual([]); // dentro de la gracia el bridge sigue vivo
    expect(entry?.bridgeId).toBe(bridge);
    expect(entry?.needsRepaint).toBe(true);
    expect(closeCalls).toEqual([]); // y NO se cierra (cerrarlo mataría el panel)

    await vi.advanceTimersByTimeAsync(3000);

    expect(releaseCalls).toEqual([bridge]); // pasada la gracia, se suelta
    expect(entry?.bridgeId).toBeNull();
    expect(entry?.state).toBe('idle'); // saneado: no finge un bridge que no tiene
  });

  it('con bridge_grace_ms=0 el release es inmediato (comportamiento antiguo)', async () => {
    settings.set('bridge_grace_ms', 0);
    mount('w1:p1');
    await pool.open('w1:p1', 80, 24, 1);
    const bridge = pool.entry('w1:p1')?.bridgeId ?? null;

    pool.hide('w1:p1');

    expect(releaseCalls).toEqual([bridge]);
    expect(pool.entry('w1:p1')?.bridgeId).toBeNull();
    settings.set('bridge_grace_ms', 3000);
  });

  it('al volver dentro de la gracia se reusa el bridge y se repinta la vista nueva', async () => {
    const first = mount('w1:p1');
    const firstTerminal = first.terminal;
    await pool.open('w1:p1', 80, 24, 1);
    expect(openCalls).toHaveLength(1);

    pool.hide('w1:p1');
    const second = mount('w1:p1');
    expect(second.terminal).not.toBe(firstTerminal); // instancia nueva
    await pool.open('w1:p1', 80, 24, 1);

    expect(openCalls).toHaveLength(1); // sin reenganche: el bridge sobrevivió
    expect(pool.entry('w1:p1')?.bridgeId).toBe(openCalls[0]?.bridgeId);
    expect(pool.entry('w1:p1')?.state).toBe('open');
    // Repintado forzado con el truco del resize (ida y vuelta).
    expect(resizeCalls.length).toBeGreaterThanOrEqual(2);
    expect(closeCalls).toEqual([]);
  });

  it('si no vuelve dentro de la gracia, el bridge se suelta y el reenganche es real', async () => {
    mount('w1:p1');
    await pool.open('w1:p1', 80, 24, 1);
    openCalls[0]?.frame(frameWith('vivo')); // desarma el watchdog de 1,5 s
    expect(openCalls).toHaveLength(1);

    pool.hide('w1:p1');
    await vi.advanceTimersByTimeAsync(3000);
    expect(releaseCalls).toHaveLength(1);

    const second = mount('w1:p1');
    await pool.open('w1:p1', 80, 24, 1);

    expect(second.terminal).toBeDefined();
    expect(openCalls).toHaveLength(2);
    expect(openCalls[1]?.bridgeId).not.toBe(openCalls[0]?.bridgeId);
    expect(pool.entry('w1:p1')?.state).toBe('open');
    expect(closeCalls).toEqual([]);
  });

  it('nunca llama open() dos veces sobre la misma instancia de xterm', () => {
    const openSpy = vi.spyOn(Terminal.prototype, 'open');
    const first = mount('w1:p1');
    expect(openSpy).toHaveBeenCalledTimes(1);

    const again = mount('w1:p1'); // remontaje sin desmontar (mismo panel)
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(again.terminal).toBe(first.terminal);
    openSpy.mockRestore();
  });

  it('CONTENIDO: el texto sigue viéndose tras cambiar de pestaña y volver', async () => {
    const first = mount('w1:p1');
    await pool.open('w1:p1', 80, 24, 1);
    screenByPane.set('w1:p1', 'marca-de-buffer');
    openCalls[0]?.frame(frameWith('marca-de-buffer'));
    await vi.advanceTimersByTimeAsync(30);
    expect(bufferText(first.terminal)).toContain('marca-de-buffer');

    // Cambio de pestaña: se desmonta la vista y el bridge espera la gracia.
    pool.hide('w1:p1');
    // Vuelta dentro de la gracia: vista nueva + repintado del bridge vivo.
    const second = mount('w1:p1');
    await pool.open('w1:p1', 80, 24, 1);
    await vi.advanceTimersByTimeAsync(30);

    expect(bufferText(second.terminal)).toContain('marca-de-buffer');
    expect(closeCalls).toEqual([]);
    expect(releaseCalls).toEqual([]);
  });

  it('si el backend aún reutiliza el bridge, el panel se repinta igual', async () => {
    releaseSupported = false; // el backend no sabe soltar el bridge todavía
    mount('w1:p1');
    await pool.open('w1:p1', 80, 24, 1);
    screenByPane.set('w1:p1', 'texto-vivo');
    openCalls[0]?.frame(frameWith('texto-vivo'));
    await vi.advanceTimersByTimeAsync(30);

    pool.hide('w1:p1');
    const second = mount('w1:p1');
    await pool.open('w1:p1', 80, 24, 1);
    await vi.advanceTimersByTimeAsync(30);

    // El reenganche reutilizó el bridge: se le fuerza el repintado con un resize.
    expect(resizeCalls.length).toBeGreaterThanOrEqual(2);
    expect(resizeCalls[0]?.cols).not.toBe(resizeCalls.at(-1)?.cols);
    expect(bufferText(second.terminal)).toContain('texto-vivo');
    expect(closeCalls).toEqual([]);
  });

  it('cerrar un panel de verdad (ya no está en la sesión) SÍ cierra su bridge', async () => {
    mount('w1:p1');
    mount('w1:p2');
    await pool.open('w1:p1', 80, 24, 1);
    await pool.open('w1:p2', 80, 24, 1);

    pool.sync(['w1:p1']); // el usuario cerró w1:p2

    expect(closeCalls).toEqual([openCalls[1]?.bridgeId]);
    expect(pool.entry('w1:p2')).toBeUndefined();
    expect(pool.entry('w1:p1')).toBeDefined();
    expect(pool.entry('w1:p1')?.state).toBe('open');
  });
});
