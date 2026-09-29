// @vitest-environment jsdom
// Ctrl+V / Ctrl+C en la terminal (F1). Antes xterm+malloc: `Ctrl+V` salía como
// `^V` al shell (nada se pegaba) y `Ctrl+C` con selección mataba el proceso en
// lugar de copiar. Ahora el componente intercepta la tecla con
// `attachCustomKeyEventHandler` y usa el portapapeles del plugin de Tauri.
//
// Se monta el `TerminalView` real (jsdom) y se despachan keys sobre el textarea
// de xterm, que es donde xterm engancha su listener de teclado.

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSnapshot } from '../herdr/types';

const inputCalls: Array<{ bridgeId: number; data: string }> = [];
let clipboard = 'texto-del-portapapeles\nlinea 2';
const written: string[] = [];

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: vi.fn(async () => clipboard),
  writeText: vi.fn(async (text: string) => {
    written.push(text);
  }),
}));

vi.mock('../herdr/client', () => ({
  call: vi.fn(async () => ({ type: 'pong', protocol: 19, version: 'test' })),
  latencyP50: vi.fn(() => 1),
  latencySamples: vi.fn(() => 1),
  sessionCurrent: vi.fn(async () => ({ ok: false, kind: 'missing' })),
  sessionStart: vi.fn(async () => ({ ok: false, kind: 'missing' })),
  storeSubscribe: vi.fn(async () => undefined),
  terminalOpen: vi.fn(async (paneId: string) => {
    const bridgeId = paneId === 'w1:p1' ? 901 : 902;
    return bridgeId;
  }),
  terminalClose: vi.fn(async () => undefined),
  terminalRelease: vi.fn(async () => true),
  terminalInput: vi.fn(async (bridgeId: number, data: string) => {
    inputCalls.push({ bridgeId, data });
  }),
  terminalInputBytes: vi.fn(async () => undefined),
  terminalResize: vi.fn(async () => undefined),
  terminalScroll: vi.fn(async () => undefined),
  configRead: vi.fn(async () => ({ ok: false, kind: 'missing' })),
  configWrite: vi.fn(async () => ({ ok: false, kind: 'missing' })),
  guiSettingsRead: vi.fn(async () => ({ ok: false, kind: 'missing' })),
  guiSettingsWrite: vi.fn(async () => ({ ok: false, kind: 'missing' })),
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

const TerminalView = (await import('./TerminalView.svelte')).default;
const { pool } = await import('./pool');
const { session } = await import('../stores/session.svelte');
const { settings } = await import('../stores/settings.svelte');
const { ui } = await import('../stores/ui.svelte');

beforeAll(() => {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
});

function snapshot(): SessionSnapshot {
  return {
    version: '0.8.0-preview.test',
    protocol: 19,
    focused_workspace_id: 'w1',
    focused_tab_id: 'w1:t1',
    focused_pane_id: 'w1:p1',
    workspaces: [
      {
        workspace_id: 'w1',
        number: 1,
        label: 'spike',
        focused: true,
        pane_count: 1,
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
        pane_count: 1,
        agent_status: 'unknown',
      },
    ],
    panes: [
      {
        pane_id: 'w1:p1',
        terminal_id: 'term_1',
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        focused: true,
        agent_status: 'unknown',
        revision: 0,
      },
    ],
    agents: [],
    layouts: [],
  } as unknown as SessionSnapshot;
}

let instance: Record<string, unknown> | null = null;
let target: HTMLElement | null = null;

async function mountView(): Promise<void> {
  session.applySnapshot(snapshot());
  target = document.createElement('div');
  document.body.append(target);
  instance = mount(TerminalView, { target, props: { paneId: 'w1:p1' } }) as never;
  flushSync();
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

function textarea(): HTMLTextAreaElement {
  const element = document.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
  if (!element) throw new Error('xterm no montó su textarea');
  return element;
}

function pressKey(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  textarea().dispatchEvent(event);
  flushSync();
  return event;
}

/** Escribe en el buffer y espera al callback de `write` (xterm es asíncrono). */
function write(
  terminal: { write(data: string, callback: () => void): void },
  data: string,
): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

beforeEach(() => {
  inputCalls.length = 0;
  written.length = 0;
  clipboard = 'texto-del-portapapeles\nlinea 2';
  settings.values.copy_on_select = false;
  ui.toasts = [];
});

afterEach(() => {
  if (instance) unmount(instance as never);
  instance = null;
  target?.remove();
  target = null;
  document.body.innerHTML = '';
  pool.disposeAll();
  session.reset();
});

describe('portapapeles de la terminal', () => {
  it('Ctrl+V pega el portapapeles con terminal.paste y lo manda al bridge', async () => {
    await mountView();
    const view = pool.entry('w1:p1')?.view;
    if (!view) throw new Error('la vista no se montó');
    const pasteSpy = vi.spyOn(view.terminal, 'paste');
    expect(pool.entry('w1:p1')?.bridgeId).toBe(901);

    const event = pressKey({ key: 'v', ctrlKey: true });

    expect(event.defaultPrevented).toBe(true); // la tecla no llega a la terminal
    await Promise.resolve();
    await Promise.resolve();
    expect(pasteSpy).toHaveBeenCalledWith(clipboard);
    // El texto sale por onData → pool.send → terminal_input del bridge.
    expect(
      inputCalls.some((call) => call.bridgeId === 901 && call.data.includes('portapapeles')),
    ).toBe(true);
    expect(inputCalls.every((call) => !call.data.includes('\x16'))).toBe(true); // ni un ^V
  });

  it('Ctrl+C con selección copia y limpia la selección (no mata el proceso)', async () => {
    await mountView();
    const view = pool.entry('w1:p1')?.view;
    if (!view) throw new Error('la vista no se montó');
    await write(view.terminal, 'copiar esto');
    view.terminal.select(0, 0, 'copiar esto'.length);
    expect(view.terminal.getSelection()).toBe('copiar esto');
    expect(view.terminal.hasSelection()).toBe(true);

    const event = pressKey({ key: 'c', ctrlKey: true });
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
    expect(written).toEqual(['copiar esto']);
    expect(view.terminal.hasSelection()).toBe(false);
    expect(inputCalls).toEqual([]); // nada se mandó al pane: no es SIGINT
  });

  it('Ctrl+C SIN selección se deja pasar (sigue siendo SIGINT)', async () => {
    await mountView();
    const view = pool.entry('w1:p1')?.view;
    if (!view) throw new Error('la vista no se montó');
    expect(view.terminal.hasSelection()).toBe(false);

    const event = pressKey({ key: 'c', ctrlKey: true });
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(false);
    expect(written).toEqual([]);
  });

  it('las demás teclas no se tocan', async () => {
    await mountView();
    const view = pool.entry('w1:p1')?.view;
    if (!view) throw new Error('la vista no se montó');

    const plain = pressKey({ key: 'a' });
    const ctrlA = pressKey({ key: 'a', ctrlKey: true });
    const altV = pressKey({ key: 'v', ctrlKey: true, altKey: true });

    expect(plain.defaultPrevented).toBe(false);
    expect(ctrlA.defaultPrevented).toBe(false);
    expect(altV.defaultPrevented).toBe(false);
    expect(written).toEqual([]);
  });

  it('si el portapapeles está vacío no se manda nada', async () => {
    await mountView();
    clipboard = '';
    const view = pool.entry('w1:p1')?.view;
    if (!view) throw new Error('la vista no se montó');
    const pasteSpy = vi.spyOn(view.terminal, 'paste');

    pressKey({ key: 'v', ctrlKey: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(pasteSpy).not.toHaveBeenCalled();
    expect(inputCalls).toEqual([]);
  });
});
