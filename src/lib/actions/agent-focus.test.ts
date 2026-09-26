// @vitest-environment jsdom
// BUG 1/4 — Enfocar un agente tiene que IRSE CON ÉL: si su panel está en otro
// espacio (o en otra pestaña), la GUI cambia. Antes `flows.focusAgent` solo movía
// el foco de panel local y nunca resolvía el espacio ni la pestaña del panel, así
// que un agente de otro espacio no cambiaba nada (la vista sale del espacio y la
// pestaña visibles). Vale igual desde la sidebar, desde la paleta y desde los
// atajos de cola: todos pasan por aquí.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ method: string; params: unknown }> = [];

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

import type { AgentInfo, SessionSnapshot } from '../herdr/types';
import { flows } from './flows';
import { session } from '../stores/session.svelte';
import { ui } from '../stores/ui.svelte';

beforeAll(() => {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
});

/**
 * Dos espacios: w1 (tabs w1:t1 y w1:t2, agente en w1:p1) y w2 (tab w2:t1 con
 * w2:p1 y w2:p2, agente en w2:p2). El servidor enfoca w1.
 */
function snapshot(): SessionSnapshot {
  const pane = (
    paneId: string,
    workspaceId: string,
    tabId: string,
    focused = false,
  ): Record<string, unknown> => ({
    pane_id: paneId,
    terminal_id: `term_${paneId}`,
    workspace_id: workspaceId,
    tab_id: tabId,
    focused,
    agent_status: 'blocked' as const,
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
  const agent = (paneId: string, workspaceId: string, tabId: string): AgentInfo =>
    ({
      pane_id: paneId,
      terminal_id: `term_${paneId}`,
      workspace_id: workspaceId,
      tab_id: tabId,
      focused: false,
      agent_status: 'blocked',
      revision: 0,
      agent: 'opencode',
      name: paneId,
    }) as unknown as AgentInfo;
  const tab = (tabId: string, workspaceId: string, number: number, paneCount: number) => ({
    tab_id: tabId,
    workspace_id: workspaceId,
    number,
    label: `${number}`,
    focused: tabId === 'w1:t1',
    pane_count: paneCount,
    agent_status: 'blocked' as const,
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
        agent_status: 'blocked',
      },
      {
        workspace_id: 'w2',
        number: 2,
        label: 'dos',
        focused: false,
        pane_count: 2,
        tab_count: 1,
        active_tab_id: 'w2:t1',
        agent_status: 'blocked',
      },
    ],
    tabs: [tab('w1:t1', 'w1', 1, 1), tab('w1:t2', 'w1', 2, 1), tab('w2:t1', 'w2', 1, 2)],
    panes: [
      pane('w1:p1', 'w1', 'w1:t1', true),
      pane('w1:p2', 'w1', 'w1:t2'),
      pane('w2:p1', 'w2', 'w2:t1'),
      pane('w2:p2', 'w2', 'w2:t1'),
    ],
    layouts: [
      { tab_id: 'w1:t1', zoomed: false, panes: [{ pane_id: 'w1:p1' }] },
      { tab_id: 'w1:t2', zoomed: false, panes: [{ pane_id: 'w1:p2' }] },
      { tab_id: 'w2:t1', zoomed: false, panes: [{ pane_id: 'w2:p1' }, { pane_id: 'w2:p2' }] },
    ],
    agents: [agent('w1:p1', 'w1', 'w1:t1'), agent('w2:p2', 'w2', 'w2:t1')],
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

describe('BUG 1/4 — enfocar un agente de otro espacio', () => {
  it('cambia de espacio, de pestaña y de panel (y luego avisa al servidor)', () => {
    expect(ui.localFocusedWorkspaceId).toBeNull();

    flows.focusAgent('w2:p2'); // agente bloqueado en OTRO espacio

    expect(ui.localFocusedWorkspaceId).toBe('w2');
    expect(ui.localFocusedTabId).toBe('w2:t1');
    expect(ui.localFocusedPaneId).toBe('w2:p2');
    expect(calls.some((call) => call.method === 'agent.focus')).toBe(true);
  });

  it('funciona igual desde los atajos de cola (nextAgent)', () => {
    flows.nextAgent(1); // el siguiente de la cola de atención

    expect(ui.localFocusedWorkspaceId).toBe('w2');
    expect(ui.localFocusedTabId).toBe('w2:t1');
    expect(ui.localFocusedPaneId).toBe('w2:p2');
  });

  it('un agente del mismo espacio no cambia de espacio, pero sí de pestaña', () => {
    flows.focusAgent('w1:p2'); // w1:t2, misma espacio, otra pestaña

    expect(ui.localFocusedWorkspaceId).toBe('w1');
    expect(ui.localFocusedTabId).toBe('w1:t2');
    expect(ui.localFocusedPaneId).toBe('w1:p2');
  });
});
