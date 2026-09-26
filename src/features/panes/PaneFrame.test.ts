// @vitest-environment jsdom
// Regresión del fallo «los botones de los paneles no sirven»: el `onpointerdown`
// del marco hacía `focusPane()` en CADA clic, incluidos los del header. Un cambio
// de foco en medio del gesto puede desmontar/re-clavar el nodo y el navegador ya
// no entrega el `click` (mousedown y mouseup deben apuntar al mismo nodo vivo).
//
// Se monta el PaneFrame real y se comprueba, botón a botón:
//  - un pointerdown sobre un botón del header NO toca el foco local,
//  - el `click` que sigue llega a la acción del botón (split / zoom / menú /
//    cierre con confirmación),
//  - el host de la terminal vive dentro del cuerpo del marco.
// El IPC se mockea a nivel del cliente (éxito) para poder mirar QUÉ método pidió
// cada botón.

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ method: string; params: Record<string, unknown> }> = [];

vi.mock('../../lib/herdr/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/herdr/client')>();
  return {
    ...actual,
    call: vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'layout.export') {
        return { type: 'layout_export', layout: { root: null } };
      }
      if (method === 'workspace.create') {
        return { type: 'workspace_created', workspace: null };
      }
      if (method === 'tab.create') {
        return { type: 'tab_created', tab: null, root_pane: null };
      }
      if (method === 'pane.split') {
        return { type: 'pane_info', pane: null };
      }
      return { type: 'ok' };
    }),
    callFor: vi.fn(async () => ({ status: 'reloaded', diagnostics: [] })),
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

import PaneFrame from '../../features/panes/PaneFrame.svelte';
import { session } from '../../lib/stores/session.svelte';
import { settings } from '../../lib/stores/settings.svelte';
import { ui } from '../../lib/stores/ui.svelte';
import { pool } from '../../lib/terminal/pool';
import type { SessionSnapshot } from '../../lib/herdr/types';

beforeAll(() => {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
});

function snapshotWithPane(paneId: string, focused = true): SessionSnapshot {
  return {
    version: '0.8.0-preview.test',
    protocol: 19,
    focused_workspace_id: 'w1',
    focused_tab_id: 'w1:t1',
    focused_pane_id: focused ? paneId : null,
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
        pane_id: paneId,
        terminal_id: 'term_1',
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        focused,
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

function mountPane(paneId = 'w1:p1', focused = true): void {
  session.applySnapshot(snapshotWithPane(paneId, focused));
  target = document.createElement('div');
  document.body.append(target);
  instance = mount(PaneFrame, { target, props: { paneId } }) as unknown as Record<string, unknown>;
  flushSync();
}

const paneId = 'w1:p1';

function button(testId: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!element) throw new Error(`no existe el botón ${testId}`);
  return element;
}

/** Gestos del navegador: pointerdown + mouseup + click sobre el mismo nodo. */
function press(element: HTMLElement): void {
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  flushSync();
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  flushSync();
}

function methodsCalled(): string[] {
  return calls.map((call) => call.method);
}

beforeEach(() => {
  calls.length = 0;
  settings.values.confirm_close = true;
  ui.localFocusedPaneId = null;
  ui.closeContextMenu();
  ui.resolveConfirm(false);
  ui.resolvePrompt(null);
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
  ui.localFocusedPaneId = null;
});

describe('PaneFrame: los botones del header responden', () => {
  it('monta la terminal dentro del cuerpo del marco', () => {
    mountPane();
    const frame = document.querySelector('[data-testid="pane-frame"]');
    const body = frame?.querySelector('.pane-frame__body');
    const host = body?.querySelector('[data-testid="terminal-host"]');
    expect(body).not.toBeNull();
    expect(host).not.toBeNull();
  });

  it('un pointerdown en un botón del header NO cambia el foco local', () => {
    // Panel NO enfocado: si el pointerdown del botón disparase el foco, el
    // cambio ocurriría en medio del gesto y el navegador ya no entregaría el
    // click al botón (el fallo reportado).
    mountPane(paneId, false);
    expect(ui.localFocusedPaneId).toBeNull();

    button('pane-split-right').dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true }),
    );
    flushSync();

    expect(ui.localFocusedPaneId).toBeNull();
  });

  it('el pointerdown fuera del header (cuerpo/título) sí enfoca el panel', () => {
    // El panel no es el enfocado de la sesión: el clic en su título debe
    // enfocarlo localmente.
    mountPane(paneId, false);
    document
      .querySelector('[data-testid="pane-title"]')
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    flushSync();

    expect(ui.localFocusedPaneId).toBe(paneId);
  });

  it('split-right dispara pane.split con la dirección', () => {
    mountPane();
    press(button('pane-split-right'));

    expect(methodsCalled()).toContain('pane.split');
    const call = calls.find((item) => item.method === 'pane.split');
    expect(call?.params).toMatchObject({ direction: 'right', target_pane_id: paneId });
  });

  it('split-down dispara pane.split hacia abajo', () => {
    mountPane();
    press(button('pane-split-down'));

    const call = calls.find((item) => item.method === 'pane.split');
    expect(call?.params).toMatchObject({ direction: 'down', target_pane_id: paneId });
  });

  it('zoom dispara pane.zoom', () => {
    mountPane();
    press(button('pane-zoom'));

    const call = calls.find((item) => item.method === 'pane.zoom');
    expect(call?.params).toMatchObject({ pane_id: paneId, mode: 'toggle' });
  });

  it('el botón de menú abre el menú contextual del panel', () => {
    mountPane();
    press(button('pane-menu'));

    expect(ui.contextMenu).not.toBeNull();
    expect(ui.contextMenu?.items.map((item) => item.id)).toEqual([
      'split-right',
      'split-down',
      'zoom',
      'rename',
      'close',
    ]);
  });

  it('el clic del menú no sube al window (si no, el menú se cerraría solo)', () => {
    // ContextMenu cierra el menú con cualquier click de window; el clic que lo
    // ABRE (botón «…») no debe llegar ahí o el menú abriría y cerraría en el
    // mismo gesto — el botón parecía no hacer nada.
    mountPane();
    let reachedWindow = false;
    const listener = (): void => {
      reachedWindow = true;
    };
    window.addEventListener('click', listener);
    try {
      press(button('pane-menu'));
    } finally {
      window.removeEventListener('click', listener);
    }

    expect(ui.contextMenu).not.toBeNull();
    expect(reachedWindow).toBe(false);
  });

  it('cerrar pide confirmación y luego llama a pane.close', async () => {
    mountPane();
    press(button('pane-close'));

    expect(ui.pendingConfirm).not.toBeNull();
    expect(methodsCalled()).not.toContain('pane.close');

    ui.resolveConfirm(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();

    const call = calls.find((item) => item.method === 'pane.close');
    expect(call?.params).toMatchObject({ pane_id: paneId });
  });

  it('el botón responde aunque el panel no estuviera enfocado', () => {
    mountPane();
    // Otro panel tiene el foco local.
    ui.localFocusedPaneId = 'w1:otro';

    press(button('pane-split-right'));

    expect(methodsCalled()).toContain('pane.split');
  });
});
