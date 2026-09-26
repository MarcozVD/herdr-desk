// @vitest-environment jsdom
// BUG B y BUG C — El foco local de la GUI (espacio, tab y panel) tiene que
// quedar COMPLETO y con ids reales, y las acciones tienen que apuntar al panel
// que el usuario ve.
//
// Medido en la app real: al pulsar un espacio de la barra no cambiaba nada
// (el foco local guardaba un id de TAB como si fuera un panel) y las acciones
// que usaban ese id apuntaban a un panel inexistente.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

interface RecordedCall {
  method: string;
  params: unknown;
}

const calls: RecordedCall[] = [];

vi.mock('../herdr/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../herdr/client')>();
  return {
    ...actual,
    call: vi.fn(async (method: string, params: unknown) => {
      calls.push({ method, params });
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

import type { SessionSnapshot } from '../herdr/types';
import { runAction } from '../keys/actions';
import { session } from '../stores/session.svelte';
import { settings } from '../stores/settings.svelte';
import { ui } from '../stores/ui.svelte';
import { actionTarget, flows } from './flows';

beforeAll(() => {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
});

/** Dos espacios: w1 (tabs w1:t1 y w1:t2) y w2 (w2:t1). El servidor enfoca w1. */
function snapshot(): SessionSnapshot {
  const pane = (paneId: string, workspaceId: string, tabId: string, focused = false) => ({
    pane_id: paneId,
    terminal_id: `term_${paneId}`,
    workspace_id: workspaceId,
    tab_id: tabId,
    focused,
    agent_status: 'unknown' as const,
    revision: 0,
    title: paneId,
    terminal_title_stripped: paneId,
    cwd: 'C:/tmp',
    label: null,
    tokens: {},
    git_branch: null,
    progress: null,
    unread: false,
    has_bell: false,
    size: { cols: 80, rows: 24 },
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
        pane_count: 1,
        tab_count: 1,
        active_tab_id: 'w2:t1',
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
      {
        tab_id: 'w1:t2',
        workspace_id: 'w1',
        number: 2,
        label: '2',
        focused: false,
        pane_count: 1,
        agent_status: 'unknown',
      },
      {
        tab_id: 'w2:t1',
        workspace_id: 'w2',
        number: 1,
        label: '1',
        focused: false,
        pane_count: 1,
        agent_status: 'unknown',
      },
    ],
    panes: [
      pane('w1:p1', 'w1', 'w1:t1', true),
      pane('w1:p2', 'w1', 'w1:t2'),
      pane('w2:p1', 'w2', 'w2:t1'),
    ],
    layouts: [
      { tab_id: 'w1:t1', zoomed: false, panes: [{ pane_id: 'w1:p1' }] },
      { tab_id: 'w1:t2', zoomed: false, panes: [{ pane_id: 'w1:p2' }] },
      { tab_id: 'w2:t1', zoomed: false, panes: [{ pane_id: 'w2:p1' }] },
    ],
    agents: [],
    server: { running: true, pid: 1, version: 'test', protocol: 19, uptime_ms: 1 },
  } as unknown as SessionSnapshot;
}

beforeEach(() => {
  calls.length = 0;
  ui.resetSessionState();
  session.applySnapshot(snapshot());
});

afterEach(() => {
  ui.resetSessionState();
});

describe('BUG B — cambiar de espacio desde la barra', () => {
  it('deja el foco local completo: espacio, tab y un panel REAL de ese tab', () => {
    flows.focusWorkspace('w2');

    expect(ui.localFocusedWorkspaceId).toBe('w2');
    expect(ui.localFocusedTabId).toBe('w2:t1');
    // Antes se guardaba el id del TAB como si fuera un panel (w2:t1).
    expect(ui.localFocusedPaneId).toBe('w2:p1');
    expect(session.panes.some((pane) => pane.pane_id === ui.localFocusedPaneId)).toBe(true);
  });

  it('vuelve al tab que estabas viendo de ese espacio, no siempre al primero', () => {
    flows.focusWorkspace('w1');
    flows.focusTab('w1:t2');
    expect(ui.localFocusedTabId).toBe('w1:t2');

    flows.focusWorkspace('w2');
    flows.focusWorkspace('w1');
    expect(ui.localFocusedTabId).toBe('w1:t2');
    expect(ui.localFocusedPaneId).toBe('w1:p2');
  });

  it('con «sincronizar foco con TUI» pide workspace.focus con el id del espacio', () => {
    settings.values.sync_focus_with_tui = true;
    try {
      flows.focusWorkspace('w2');
      const focus = calls.find((call) => call.method === 'workspace.focus');
      expect(focus?.params).toEqual({ workspace_id: 'w2' });
    } finally {
      settings.values.sync_focus_with_tui = false;
    }
  });
});

describe('BUG C — objetivo de las acciones', () => {
  it('manda el panel que el usuario ve (foco local)', () => {
    ui.focusPaneLocally('w1:p2');
    expect(actionTarget().paneId).toBe('w1:p2');
  });

  it('con un id local que ya no existe cae al del servidor (no silencia la acción)', async () => {
    ui.focusPaneLocally('w9:p9'); // panel fantasma
    expect(actionTarget().paneId).toBe('w1:p1');

    await runAction('zoom');
    expect(calls.find((call) => call.method === 'pane.zoom')?.params).toEqual({
      pane_id: 'w1:p1',
      mode: 'toggle',
    });
  });

  it('un tab guardado por error como panel no rompe el zoom', async () => {
    ui.localFocusedPaneId = 'w1:t2'; // id de TAB (el bug que se veía en vivo)
    await runAction('zoom');
    expect(calls.find((call) => call.method === 'pane.zoom')?.params).toEqual({
      pane_id: 'w1:p1',
      mode: 'toggle',
    });
  });

  it('el zoom va al panel visible aunque el servidor esté enfocando otro', async () => {
    ui.focusPaneLocally('w1:p2');
    await runAction('zoom');
    expect(calls.find((call) => call.method === 'pane.zoom')?.params).toEqual({
      pane_id: 'w1:p2',
      mode: 'toggle',
    });
  });
});
