// @vitest-environment jsdom
// BUG 5 — Ratón para agentes. Los frames del bridge son viewport renderizado y no
// traen los DECSET de mouse tracking, así que xterm nunca reporta clics y los
// diálogos de los agentes (opencode...) no respondían. En un pane con agente la
// GUI sintetiza el SGR del ratón y lo manda por el bridge; Shift+arrastre y
// Ctrl/Cmd+clic se reservan para la selección local y los links.

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSnapshot } from '../herdr/types';

const inputCalls: Array<{ bridgeId: number; data: string }> = [];

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: vi.fn(async () => ''),
  writeText: vi.fn(async () => undefined),
}));

vi.mock('../herdr/client', () => ({
  call: vi.fn(async () => ({ type: 'pong', protocol: 19, version: 'test' })),
  latencyP50: vi.fn(() => 1),
  latencySamples: vi.fn(() => 1),
  sessionCurrent: vi.fn(async () => ({ ok: false, kind: 'missing' })),
  sessionStart: vi.fn(async () => ({ ok: false, kind: 'missing' })),
  storeSubscribe: vi.fn(async () => undefined),
  terminalOpen: vi.fn(async (paneId: string) => (paneId === 'w1:p1' ? 901 : 902)),
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
const { ui } = await import('../stores/ui.svelte');

beforeAll(() => {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
});

/** Un panel; `agent` lo marca como agente TUI (gating del ratón). */
function snapshot(agent?: string): SessionSnapshot {
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
        ...(agent ? { agent } : {}),
      },
    ],
    agents: [],
    layouts: [],
  } as unknown as SessionSnapshot;
}

let instance: Record<string, unknown> | null = null;
let target: HTMLElement | null = null;

async function mountView(agent?: string): Promise<void> {
  session.applySnapshot(snapshot(agent));
  target = document.createElement('div');
  document.body.append(target);
  instance = mount(TerminalView, { target, props: { paneId: 'w1:p1' } }) as never;
  flushSync();
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
  // Rect determinista: jsdom devuelve 0 y las celdas saldrían fuera de rango.
  const host = pool.entry('w1:p1')?.view?.host;
  if (host) {
    host.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 480,
      right: 800,
      bottom: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  }
}

function screenElement(): HTMLElement {
  const element = pool.entry('w1:p1')?.view?.terminal.element;
  if (!element) throw new Error('xterm no montó su elemento');
  return element;
}

function sentData(): string {
  return inputCalls.map((call) => call.data).join('');
}

beforeEach(() => {
  inputCalls.length = 0;
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

describe('BUG 5 — ratón sintético para agentes', () => {
  it('en un pane con agente, clic izquierdo + soltar manda press y release SGR', async () => {
    await mountView('opencode');
    expect(pool.entry('w1:p1')?.bridgeId).toBe(901);
    const screen = screenElement();

    const down = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 50, // col 6 con celdas de 10 px
      clientY: 240, // row 13 con celdas de 20 px
    });
    screen.dispatchEvent(down);
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 50, clientY: 240 }));

    expect(down.defaultPrevented).toBe(true); // xterm no arranca selección
    expect(sentData()).toBe('\x1b[<0;6;13M\x1b[<0;6;13m');
    expect(inputCalls.every((call) => call.bridgeId === 901)).toBe(true);
  });

  it('el arrastre con botón manda motion (código +32)', async () => {
    await mountView('opencode');
    const screen = screenElement();

    screen.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 50,
        clientY: 240,
      }),
    );
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 240 }));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 150, clientY: 240 }));

    // col 16 con celdas de 10 px; el press/release van al botón 0 y el motion a 32.
    expect(inputCalls.map((call) => call.data)).toEqual([
      '\x1b[<0;6;13M',
      '\x1b[<32;16;13M',
      '\x1b[<0;16;13m',
    ]);
  });

  it('Shift+clic deja la selección local: no se manda nada a la app', async () => {
    await mountView('opencode');
    const screen = screenElement();
    // El gesto tiene que LLEGAR a xterm (selección local): la GUI no lo corta.
    let reached = false;
    screen.addEventListener('mousedown', () => (reached = true));

    screen.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        shiftKey: true,
        clientX: 50,
        clientY: 240,
      }),
    );
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, shiftKey: true }));

    expect(reached).toBe(true); // xterm sí recibe el gesto y selecciona
    expect(inputCalls).toEqual([]);
  });

  it('Ctrl+clic se reserva al link: no se manda el ratón a la app', async () => {
    await mountView('opencode');
    const screen = screenElement();

    screen.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        ctrlKey: true,
        clientX: 50,
        clientY: 240,
      }),
    );
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, ctrlKey: true }));

    expect(inputCalls).toEqual([]);
  });

  it('en un pane SIN agente el ratón sigue siendo de xterm (sin SGR)', async () => {
    await mountView();
    const screen = screenElement();
    let reached = false;
    screen.addEventListener('mousedown', () => (reached = true));

    screen.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 50,
        clientY: 240,
      }),
    );
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 50, clientY: 240 }));

    expect(reached).toBe(true); // el gesto es de xterm
    expect(inputCalls).toEqual([]);
  });
});
