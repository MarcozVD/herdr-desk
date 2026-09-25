import { describe, expect, it } from 'vitest';

import type { SessionSnapshot } from '../herdr/types';
import {
  AGENT_STATUS_ORDER,
  countAgentsByStatus,
  focusedPaneIdOf,
  focusedPaneOf,
  focusedTabOf,
  focusedWorkspaceOf,
  paneTitle,
  panesOfTab,
  shortPath,
  sortAgentsByPriority,
  tabsOfWorkspace,
} from './snapshot';

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    version: '0.8.0-preview',
    protocol: 19,
    focused_workspace_id: 'w1',
    focused_tab_id: 'w1:t1',
    focused_pane_id: 'w1:p2',
    workspaces: [
      {
        workspace_id: 'w1',
        number: 1,
        label: 'spike',
        focused: true,
        pane_count: 2,
        tab_count: 1,
        active_tab_id: 'w1:t1',
        agent_status: 'working',
      },
      {
        workspace_id: 'w2',
        number: 2,
        label: 'docs',
        focused: false,
        pane_count: 1,
        tab_count: 1,
        active_tab_id: 'w2:t1',
        agent_status: 'blocked',
      },
    ],
    tabs: [
      {
        tab_id: 'w1:t1',
        workspace_id: 'w1',
        number: 1,
        label: '1',
        focused: true,
        pane_count: 2,
        agent_status: 'working',
      },
      {
        tab_id: 'w2:t1',
        workspace_id: 'w2',
        number: 1,
        label: '1',
        focused: false,
        pane_count: 1,
        agent_status: 'blocked',
      },
    ],
    panes: [
      {
        pane_id: 'w1:p1',
        terminal_id: 'term_a',
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        focused: false,
        agent_status: 'working',
        revision: 0,
        cwd: 'C:\\Users\\mvale\\Documents\\herdr\\',
      },
      {
        pane_id: 'w1:p2',
        terminal_id: 'term_b',
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        focused: true,
        agent_status: 'unknown',
        revision: 3,
        cwd: 'C:\\Users\\mvale\\Documents\\herdr\\',
      },
      {
        pane_id: 'w2:p1',
        terminal_id: 'term_c',
        workspace_id: 'w2',
        tab_id: 'w2:t1',
        focused: false,
        agent_status: 'blocked',
        revision: 1,
        cwd: 'C:\\Users\\mvale\\Documents',
      },
    ],
    layouts: [],
    agents: [
      {
        pane_id: 'w2:p1',
        terminal_id: 'term_c',
        workspace_id: 'w2',
        tab_id: 'w2:t1',
        focused: false,
        agent_status: 'blocked',
        revision: 1,
        state_change_seq: 5,
        agent: 'hd-bot',
      },
      {
        pane_id: 'w1:p1',
        terminal_id: 'term_a',
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        focused: false,
        agent_status: 'working',
        revision: 1,
        state_change_seq: 9,
        agent: 'hd-bot',
      },
      {
        pane_id: 'w9:p1',
        terminal_id: 'term_d',
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        focused: false,
        agent_status: 'working',
        revision: 1,
        state_change_seq: 2,
        agent: 'otro',
      },
    ],
    ...overrides,
  };
}

describe('foco del snapshot', () => {
  it('usa los ids enfocados del snapshot', () => {
    const data = snapshot();
    expect(focusedWorkspaceOf(data)?.workspace_id).toBe('w1');
    expect(focusedTabOf(data)?.tab_id).toBe('w1:t1');
    expect(focusedPaneIdOf(data)).toBe('w1:p2');
    expect(focusedPaneOf(data)?.terminal_id).toBe('term_b');
  });

  it('cae al flag `focused` si el id ya no existe', () => {
    const data = snapshot({ focused_pane_id: 'w1:p9' });
    expect(focusedPaneIdOf(data)).toBe('w1:p2');
  });

  it('devuelve null sin snapshot', () => {
    expect(focusedWorkspaceOf(null)).toBeNull();
    expect(focusedTabOf(null)).toBeNull();
    expect(focusedPaneIdOf(null)).toBeNull();
    expect(focusedPaneOf(null)).toBeNull();
  });
});

describe('consultas por workspace y tab', () => {
  it('lista tabs y panes de un workspace', () => {
    const data = snapshot();
    expect(tabsOfWorkspace(data, 'w1').map((tab) => tab.tab_id)).toEqual(['w1:t1']);
    expect(panesOfTab(data, 'w1:t1').map((pane) => pane.pane_id)).toEqual(['w1:p1', 'w1:p2']);
    expect(tabsOfWorkspace(data, null)).toEqual([]);
  });
});

describe('orden y conteo de agentes (T2.1)', () => {
  it('ordena por prioridad y luego por el cambio de estado más reciente', () => {
    const sorted = sortAgentsByPriority(snapshot().agents);
    expect(sorted.map((agent) => agent.pane_id)).toEqual(['w2:p1', 'w1:p1', 'w9:p1']);
    expect(AGENT_STATUS_ORDER[0]).toBe('blocked');
  });

  it('cuenta por estado', () => {
    expect(countAgentsByStatus(snapshot().agents)).toEqual({
      blocked: 1,
      done: 0,
      working: 2,
      idle: 0,
      unknown: 0,
    });
    expect(countAgentsByStatus([]).blocked).toBe(0);
  });
});

describe('etiquetas', () => {
  it('prefiere label, luego título, luego agente y por último el id', () => {
    const data = snapshot();
    const pane = data.panes[2];
    if (!pane) throw new Error('fixture sin w2:p1');
    expect(paneTitle(pane)).toBe('w2:p1');
    expect(paneTitle({ ...pane, display_agent: 'hd-bot' })).toBe('hd-bot');
    expect(paneTitle({ ...pane, title: 'build', display_agent: 'hd-bot' })).toBe('build');
    expect(paneTitle({ ...pane, label: 'paneles', title: 'build' })).toBe('paneles');
    expect(paneTitle(null)).toBe('');
  });

  it('acorta rutas para la status bar', () => {
    expect(shortPath('C:\\Users\\mvale\\Documents\\herdr\\')).toBe('Documents/herdr');
    expect(shortPath('/home/user')).toBe('home/user');
    expect(shortPath('C:\\')).toBe('C:');
    expect(shortPath(null)).toBe('');
  });
});
