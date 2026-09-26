// @vitest-environment jsdom
// BUG 3 — La barra de pestañas tiene que mostrar las pestañas del espacio que se
// está VIENDO. Antes filtraba por el espacio del SERVIDOR
// (`session.tabsOfFocusedWorkspace`), así que al cambiar de espacio con la
// sidebar el contenido cambiaba pero la barra se quedaba con las del espacio
// anterior: parecía que todos los espacios tenían las mismas pestañas.

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/herdr/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/herdr/client')>();
  return {
    ...actual,
    call: vi.fn(async () => ({ type: 'ok' })),
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

import type { SessionSnapshot } from '../../lib/herdr/types';
import { session } from '../../lib/stores/session.svelte';
import { settings } from '../../lib/stores/settings.svelte';
import { ui } from '../../lib/stores/ui.svelte';
import TabBar from './TabBar.svelte';

beforeAll(() => {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
});

/** w1 con dos pestañas (w1:t1 activa) y w2 con otras dos (w2:t2 activa). */
function snapshot(): SessionSnapshot {
  const tab = (tabId: string, workspaceId: string, number: number) => ({
    tab_id: tabId,
    workspace_id: workspaceId,
    number,
    label: `tab-${tabId}`,
    focused: tabId === 'w1:t1',
    pane_count: 1,
    agent_status: 'unknown' as const,
  });
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
        label: 'uno',
        focused: true,
        pane_count: 2,
        tab_count: 2,
        active_tab_id: 'w1:t1',
        agent_status: 'unknown',
      },
      {
        workspace_id: 'w2',
        number: 2,
        label: 'dos',
        focused: false,
        pane_count: 2,
        tab_count: 2,
        active_tab_id: 'w2:t2',
        agent_status: 'unknown',
      },
    ],
    tabs: [tab('w1:t1', 'w1', 1), tab('w1:t2', 'w1', 2), tab('w2:t1', 'w2', 1), tab('w2:t2', 'w2', 2)],
    panes: [
      {
        pane_id: 'w1:p1',
        terminal_id: 'term_w1:p1',
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        focused: true,
        agent_status: 'unknown',
        revision: 0,
        title: 'w1:p1',
        terminal_title_stripped: 'w1:p1',
        cwd: 'C:/tmp',
        label: null,
        tokens: {},
        git_branch: null,
        progress: null,
        unread: false,
        has_bell: false,
        size: { cols: 80, rows: 24 },
      },
    ],
    layouts: [],
    agents: [],
    server: { running: true, pid: 1, version: 'test', protocol: 19, uptime_ms: 1 },
  } as unknown as SessionSnapshot;
}

let instance: Record<string, unknown> | null = null;
let target: HTMLElement | null = null;

function mountBar(): void {
  target = document.createElement('div');
  document.body.append(target);
  instance = mount(TabBar, { target }) as unknown as Record<string, unknown>;
  flushSync();
}

function tabIds(): string[] {
  return [...document.querySelectorAll('[data-testid="tab"]')].map(
    (element) => element.getAttribute('data-tab-id') ?? '',
  );
}

function activeTab(): string | null {
  return (
    document
      .querySelector('[data-testid="tab"][aria-current="true"]')
      ?.getAttribute('data-tab-id') ?? null
  );
}

beforeEach(() => {
  settings.values.hide_tab_bar_when_single_tab = false;
  ui.resetSessionState();
  session.applySnapshot(snapshot());
});

afterEach(() => {
  if (instance) unmount(instance as never);
  instance = null;
  target?.remove();
  target = null;
  document.body.innerHTML = '';
  ui.resetSessionState();
});

describe('TabBar: pestañas del espacio visible', () => {
  it('sin foco local muestra las del espacio del servidor', () => {
    mountBar();
    expect(tabIds()).toEqual(['w1:t1', 'w1:t2']);
    expect(activeTab()).toBe('w1:t1');
  });

  it('con el espacio visible en w2 muestra SOLO sus pestañas', () => {
    ui.focusWorkspaceLocally('w2');
    mountBar();

    expect(tabIds()).toEqual(['w2:t1', 'w2:t2']);
    // Y el resaltado sigue al criterio visible: la activa del espacio (w2:t2).
    expect(activeTab()).toBe('w2:t2');
  });

  it('el resaltado sigue a la pestaña local cuando está en el espacio visible', () => {
    ui.focusWorkspaceLocally('w2');
    ui.focusTabLocally('w2:t1', 'w2');
    mountBar();

    expect(activeTab()).toBe('w2:t1');
  });

  it('cambiar de espacio con la barra montada cambia sus pestañas', () => {
    mountBar();
    expect(tabIds()).toEqual(['w1:t1', 'w1:t2']);

    ui.focusWorkspaceLocally('w2');
    flushSync();

    expect(tabIds()).toEqual(['w2:t1', 'w2:t2']);
    expect(activeTab()).toBe('w2:t2');
  });
});
