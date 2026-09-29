// @vitest-environment jsdom
// BUG 3 — Fuente única del foco visible (`lib/stores/visible.svelte.ts`): manda
// el foco local de la GUI y, si no, el del servidor. Antes la barra de pestañas
// filtraba por el espacio del SERVIDOR mientras el contenido lo mandaba el foco
// LOCAL, así que al cambiar de espacio parecía que todos tenían las mismas
// pestañas.
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
import { settings } from '../stores/settings.svelte';
import { ui } from '../stores/ui.svelte';
import { visible } from '../stores/visible.svelte';

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
    cwd = 'C:/tmp',
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
    cwd,
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
      pane('w1:p1', 'w1', 'w1:t1', true, 'C:/workspace-uno'),
      pane('w1:p2', 'w1', 'w1:t2', false, 'C:/workspace-uno/p2'),
      pane('w2:p1', 'w2', 'w2:t1', false, 'C:/workspace-dos'),
      pane('w2:p2', 'w2', 'w2:t1', false, 'C:/workspace-dos/p2'),
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

describe('BUG 3 — pestañas y foco visible con un solo criterio', () => {
  it('el espacio visible manda sobre el del servidor', () => {
    ui.focusWorkspaceLocally('w2');
    expect(visible.tabs.map((tab) => tab.tab_id)).toEqual(['w2:t1']);
    expect(session.tabsOfFocusedWorkspace.map((tab) => tab.tab_id)).toEqual(['w1:t1', 'w1:t2']);
  });

  it('sin foco local se usa el del servidor', () => {
    ui.resetSessionState();
    expect(visible.workspaceId).toBe('w1');
    expect(visible.tabs.map((tab) => tab.tab_id)).toEqual(['w1:t1', 'w1:t2']);
    expect(visible.tabId).toBe('w1:t1');
  });

  it('un id local que ya no existe cae al del servidor', () => {
    ui.focusTabLocally('w9:t9', 'w9');
    ui.focusWorkspaceLocally('w9');
    expect(visible.workspaceId).toBe('w1');
    expect(visible.tabId).toBe('w1:t1');
  });
});

describe('BUG 3 — pestañas nuevas y navegación sobre el espacio visible', () => {
  it('la pestaña nueva se crea en el espacio que se está viendo', async () => {
    ui.focusWorkspaceLocally('w2');
    settings.values.prompt_new_tab_name = false;
    await flows.newTab();
    const create = calls.find((call) => call.method === 'tab.create');
    expect(create?.params).toMatchObject({ workspace_id: 'w2' });
  });

  it('«pestaña siguiente» navega las del espacio visible', async () => {
    ui.focusWorkspaceLocally('w2');
    await flows.nextTab(1);
    const focus = calls.find((call) => call.method === 'tab.focus');
    expect(focus?.params).toEqual({ tab_id: 'w2:t1' });
  });

  it('«ir a la pestaña N» numera las del espacio visible', async () => {
    ui.focusWorkspaceLocally('w2');
    await flows.switchTabNumber(1);
    expect(calls.find((call) => call.method === 'tab.focus')?.params).toEqual({ tab_id: 'w2:t1' });
  });
});

describe('BUG 4 — el cwd de una terminal nueva es el del espacio VISIBLE', () => {
  // El servidor sigue enfocando w1:p1 (`C:/workspace-uno`) mientras la GUI muestra
  // w2: todo lo que nace debe heredar la ruta de lo que se está viendo.
  it('la pestaña nueva hereda el cwd del panel visible, no el enfocado por el servidor', async () => {
    ui.focusWorkspaceLocally('w2');
    settings.values.prompt_new_tab_name = false;
    await flows.newTab();
    const create = calls.find((call) => call.method === 'tab.create');
    expect(create?.params).toMatchObject({ workspace_id: 'w2', cwd: 'C:/workspace-dos' });
  });

  it('el panel divided hereda el cwd del panel visible', async () => {
    ui.focusWorkspaceLocally('w2');
    await flows.splitPane('right');
    const split = calls.find((call) => call.method === 'pane.split');
    expect(split?.params).toMatchObject({ cwd: 'C:/workspace-dos' });
  });

  it('el panel divided con objetivo explícito también hereda el cwd visible', async () => {
    ui.focusWorkspaceLocally('w2');
    await flows.splitPane('down', 'w2:p2');
    const split = calls.find((call) => call.method === 'pane.split');
    expect(split?.params).toMatchObject({ target_pane_id: 'w2:p2', cwd: 'C:/workspace-dos' });
  });

  it('el espacio nuevo se crea con el cwd del panel visible', async () => {
    ui.focusWorkspaceLocally('w2');
    settings.values.prompt_new_workspace_name = false;
    const form = vi.spyOn(ui, 'workspaceForm').mockResolvedValue({ label: 'nuevo', cwd: '' });
    try {
      await flows.createWorkspace();
      // `mockRestore` limpia las llamadas: hay que mirar antes.
      expect(form).toHaveBeenCalledWith(expect.objectContaining({ cwdValue: 'C:/workspace-dos' }));
    } finally {
      form.mockRestore();
    }
    // El formulario vacío deja `null`: herdr decide (no se inventa una ruta).
    const create = calls.find((call) => call.method === 'workspace.create');
    expect(create?.params).toMatchObject({ cwd: null });
  });

  it('el cwd del panel visible manda también sin foco local de panel', async () => {
    // Sin `localFocusedPaneId` visible.paneId cae al del servidor, pero en la
    // pestaña que se está viendo: la ruta heredada es la de ese panel.
    ui.focusWorkspaceLocally('w2');
    settings.values.prompt_new_tab_name = false;
    await flows.newTab();
    expect(calls.find((call) => call.method === 'tab.create')?.params).toMatchObject({
      cwd: 'C:/workspace-dos',
    });
  });

  it('sin panel visible se cae al cwd del panel enfocado por el servidor', async () => {
    ui.resetSessionState();
    session.applySnapshot({
      ...snapshot(),
      panes: [
        {
          ...(snapshot().panes as unknown as Array<Record<string, unknown>>)[0],
          tab_id: 'w1:t9', // panel enfocado fuera de la pestaña visible
        },
      ],
      layouts: [],
    } as unknown as SessionSnapshot);
    settings.values.prompt_new_tab_name = false;
    await flows.newTab();
    expect(calls.find((call) => call.method === 'tab.create')?.params).toMatchObject({
      cwd: 'C:/workspace-uno',
    });
  });
});
