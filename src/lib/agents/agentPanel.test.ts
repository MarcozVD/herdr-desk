// T2.1 — Panel de agentes: orden, agrupado, filas de la config y tokens.

import { describe, expect, it } from 'vitest';

import type { AgentInfo, AgentStatus, TabInfo, WorkspaceInfo } from '../herdr/types';
import {
  agentName,
  agentRowGap,
  agentRowsFor,
  blockedCount,
  buildAgentPanel,
  canonicalAgentId,
  DEFAULT_AGENT_ROWS,
  normalizeAgentPanelSort,
  normalizeAgentRows,
  resolveAgentToken,
  rollupAgents,
} from './agentPanel';

const LABELS: Record<AgentStatus, string> = {
  idle: 'inactivo',
  working: 'trabajando',
  blocked: 'bloqueado',
  done: 'listo',
  unknown: 'desconocido',
};

function agent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    pane_id: 'w1:p1',
    terminal_id: 'term_a',
    workspace_id: 'w1',
    tab_id: 'w1:t1',
    focused: false,
    agent_status: 'unknown',
    revision: 0,
    agent: null,
    display_agent: null,
    name: null,
    terminal_title: null,
    terminal_title_stripped: null,
    tokens: undefined,
    ...overrides,
  } as AgentInfo;
}

function workspace(overrides: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
  return {
    workspace_id: 'w1',
    number: 1,
    label: 'spike-r3',
    focused: false,
    pane_count: 1,
    tab_count: 1,
    active_tab_id: 'w1:t1',
    agent_status: 'unknown',
    ...overrides,
  };
}

function tab(overrides: Partial<TabInfo> = {}): TabInfo {
  return {
    tab_id: 'w1:t1',
    workspace_id: 'w1',
    number: 1,
    label: '1',
    focused: false,
    pane_count: 1,
    agent_status: 'unknown',
    ...overrides,
  };
}

describe('orden del panel (T2.1)', () => {
  const agents = [
    agent({ pane_id: 'w1:p4', agent_status: 'unknown' }),
    agent({ pane_id: 'w1:p3', agent_status: 'idle' }),
    agent({ pane_id: 'w1:p2', agent_status: 'done' }),
    agent({ pane_id: 'w1:p1', agent_status: 'blocked' }),
    agent({ pane_id: 'w1:p5', agent_status: 'working' }),
  ];

  it('priority: blocked > done > working > idle > unknown', () => {
    const sections = buildAgentPanel({
      agents,
      workspaces: [workspace()],
      mode: 'priority',
    });

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('');
    expect(sections[0].agents.map((item) => item.agent_status)).toEqual([
      'blocked',
      'done',
      'working',
      'idle',
      'unknown',
    ]);
  });

  it('spaces: una sección por workspace, en el orden del snapshot', () => {
    const sections = buildAgentPanel({
      agents: [
        agent({ pane_id: 'w2:p1', workspace_id: 'w2', agent_status: 'blocked' }),
        agent({ pane_id: 'w1:p1', workspace_id: 'w1', agent_status: 'working' }),
        agent({ pane_id: 'w1:p2', workspace_id: 'w1', agent_status: 'done' }),
      ],
      workspaces: [workspace(), workspace({ workspace_id: 'w2', number: 2, label: 'docs-r11' })],
      mode: 'spaces',
    });

    expect(sections.map((section) => section.id)).toEqual(['w1', 'w2']);
    expect(sections.map((section) => section.title)).toEqual(['1 spike-r3', '2 docs-r11']);
    // Dentro de la sección, la cola de atención manda: done antes que working.
    expect(sections[0].agents.map((item) => item.pane_id)).toEqual(['w1:p2', 'w1:p1']);
  });

  it('spaces: no pinta secciones sin agentes y no pierde agentes de un workspace desconocido', () => {
    const sections = buildAgentPanel({
      agents: [
        agent({ pane_id: 'w1:p1', workspace_id: 'w1' }),
        agent({ pane_id: 'w9:p1', workspace_id: 'w9' }),
      ],
      workspaces: [workspace(), workspace({ workspace_id: 'w2', number: 2, label: 'docs' })],
      mode: 'spaces',
    });

    expect(sections.map((section) => section.id)).toEqual(['w1', 'w9']);
    expect(sections[1].title).toBe('w9');
    expect(sections[1].agents.map((item) => item.pane_id)).toEqual(['w9:p1']);
  });

  it('el alias `workspaces` de la config es `spaces`', () => {
    expect(normalizeAgentPanelSort('workspaces')).toBe('spaces');
    expect(normalizeAgentPanelSort('spaces')).toBe('spaces');
    expect(normalizeAgentPanelSort('priority')).toBe('priority');
    expect(normalizeAgentPanelSort(undefined)).toBe('spaces');
  });
});

describe('filtro del panel (T2.1)', () => {
  const agents = [
    agent({
      pane_id: 'w1:p1',
      display_agent: 'Claude',
      terminal_title_stripped: 'revisando docs',
      workspace_id: 'w1',
    }),
    agent({ pane_id: 'w1:p2', agent: 'opencode', workspace_id: 'w1' }),
    agent({ pane_id: 'w2:p1', display_agent: 'hermes', workspace_id: 'w2' }),
  ];
  const workspaces = [workspace(), workspace({ workspace_id: 'w2', number: 2, label: 'docs-r11' })];

  it('filtra por nombre, título y espacio, sin distinguir mayúsculas', () => {
    const byName = buildAgentPanel({ agents, workspaces, mode: 'priority', query: 'clau' });
    expect(byName[0].agents.map((item) => item.pane_id)).toEqual(['w1:p1']);

    const byTitle = buildAgentPanel({ agents, workspaces, mode: 'priority', query: 'REVISANDO' });
    expect(byTitle[0].agents.map((item) => item.pane_id)).toEqual(['w1:p1']);

    const bySpace = buildAgentPanel({ agents, workspaces, mode: 'priority', query: 'docs-r11' });
    expect(bySpace[0].agents.map((item) => item.pane_id)).toEqual(['w2:p1']);
  });

  it('sin coincidencias no hay secciones; sin filtro están todos', () => {
    expect(buildAgentPanel({ agents, workspaces, mode: 'priority', query: 'zzz' })).toEqual([]);
    expect(buildAgentPanel({ agents, workspaces, mode: 'spaces' })).toHaveLength(2);
  });

  it('el filtro se aplica también en modo spaces', () => {
    const sections = buildAgentPanel({ agents, workspaces, mode: 'spaces', query: 'opencode' });
    expect(sections.map((section) => section.id)).toEqual(['w1']);
    expect(sections[0].agents.map((item) => item.pane_id)).toEqual(['w1:p2']);
  });
});

describe('filas de la config `[ui.sidebar.agents]` (T2.1)', () => {
  it('sin config usa las filas por defecto', () => {
    expect(agentRowsFor(agent(), {})).toEqual(DEFAULT_AGENT_ROWS);
  });

  it('rows_by_agent manda para el id canónico', () => {
    const rows = [['state_icon', 'workspace'], ['terminal_title_stripped'], ['agent']];
    expect(agentRowsFor(agent({ agent: 'claude' }), { rowsByAgent: { claude: rows } })).toEqual(
      rows,
    );
    // Otro agente sigue con las filas por defecto.
    expect(agentRowsFor(agent({ agent: 'opencode' }), { rowsByAgent: { claude: rows } })).toEqual(
      DEFAULT_AGENT_ROWS,
    );
  });

  it('cae a `rows` si la entrada de rows_by_agent está vacía o malformada', () => {
    const fallback = [['agent']];
    expect(
      agentRowsFor(agent({ agent: 'claude' }), { rows: fallback, rowsByAgent: { claude: [] } }),
    ).toEqual(fallback);
    expect(
      agentRowsFor(agent({ agent: 'claude' }), {
        rows: fallback,
        rowsByAgent: { claude: 'x' as never },
      }),
    ).toEqual(fallback);
  });

  it('normaliza los tokens con estilo y descarta lo que no vale', () => {
    const rows = normalizeAgentRows([
      ['state_icon', { token: 'workspace', fg: '#89b4fa', bold: true }, '', 42, null],
      'no-es-fila',
      [],
    ]);
    expect(rows).toEqual([['state_icon', { token: 'workspace', fg: '#89b4fa', bold: true }]]);
  });

  it('row_gap se acota y por defecto es 0', () => {
    expect(agentRowGap({})).toBe(0);
    expect(agentRowGap({ rowGap: 1 })).toBe(1);
    expect(agentRowGap({ rowGap: -3 })).toBe(0);
    expect(agentRowGap({ rowGap: 99 })).toBe(5);
  });

  it('acepta el rows/rows_by_agent que llega del JSON de la config', () => {
    // El shape real: arrays de arrays con objetos {token, ...}.
    const config = {
      rows: [['state_icon', 'agent']],
      rowsByAgent: { opencode: [['state_icon'], [{ token: 'agent', dim: true }]] },
    };
    expect(agentRowsFor(agent({ agent: 'opencode' }), config)).toEqual([
      ['state_icon'],
      [{ token: 'agent', dim: true }],
    ]);
    expect(agentRowsFor(agent({ agent: 'claude' }), config)).toEqual([['state_icon', 'agent']]);
  });
});

describe('tokens de fila (T2.1)', () => {
  const ctx = {
    agent: agent({
      pane_id: 'w1:p7',
      agent_status: 'blocked',
      agent: 'claude',
      display_agent: 'Claude',
      terminal_title: '  Claude  ',
      terminal_title_stripped: 'Claude',
      tokens: { jj_status: 'rebase', vacio: '' },
      state_labels: { custom: 'etiqueta' },
    }),
    workspace: workspace(),
    tab: tab(),
    stateLabels: LABELS,
  };

  it('resuelve los built-ins', () => {
    expect(resolveAgentToken('state_icon', ctx)).toMatchObject({ kind: 'icon', status: 'blocked' });
    expect(resolveAgentToken('state_text', ctx)?.text).toBe('bloqueado');
    expect(resolveAgentToken('workspace', ctx)?.text).toBe('1 spike-r3');
    expect(resolveAgentToken('tab', ctx)?.text).toBe('1 1');
    expect(resolveAgentToken('pane', ctx)?.text).toBe('w1:p7');
    expect(resolveAgentToken('agent', ctx)?.text).toBe('Claude');
    expect(resolveAgentToken('terminal_title', ctx)?.text).toBe('  Claude  ');
    expect(resolveAgentToken('terminal_title_stripped', ctx)?.text).toBe('Claude');
  });

  it('resuelve los `$name` de la metadata del pane', () => {
    expect(resolveAgentToken('$jj_status', ctx)?.text).toBe('rebase');
    expect(resolveAgentToken('$custom', ctx)?.text).toBe('etiqueta');
    // Token vacío o inexistente: se omite, no deja hueco.
    expect(resolveAgentToken('$vacio', ctx)).toBeNull();
    expect(resolveAgentToken('$no_existe', ctx)).toBeNull();
  });

  it('conserva el estilo inline y omite los tokens que no son nada', () => {
    expect(resolveAgentToken({ token: 'workspace', fg: '#89b4fa', bold: true }, ctx)).toMatchObject(
      {
        id: 'workspace',
        text: '1 spike-r3',
        style: { fg: '#89b4fa', bold: true },
      },
    );
    expect(resolveAgentToken('lo_que_sea', ctx)).toBeNull();
    expect(resolveAgentToken('', ctx)).toBeNull();
  });

  it('sin workspace ni tab en el snapshot usa los ids', () => {
    const bare = { ...ctx, workspace: null, tab: null };
    expect(resolveAgentToken('workspace', bare)?.text).toBe('w1');
    expect(resolveAgentToken('tab', bare)?.text).toBe('w1:t1');
  });

  it('nombre e id canónico del agente', () => {
    expect(agentName(agent({ display_agent: 'Claude', agent: 'claude' }))).toBe('Claude');
    expect(agentName(agent({ agent: 'opencode' }))).toBe('opencode');
    expect(agentName(agent({ pane_id: 'w1:p9' }))).toBe('w1:p9');
    expect(canonicalAgentId(agent({ agent: 'claude' }))).toBe('claude');
    expect(canonicalAgentId(agent({ display_agent: 'Claude' }))).toBe('Claude');
    expect(canonicalAgentId(agent())).toBeNull();
  });
});

describe('rollups de estado (T2.4)', () => {
  it('cuenta por estado y dice el peor', () => {
    const rollup = rollupAgents([
      agent({ agent_status: 'idle' }),
      agent({ agent_status: 'blocked' }),
      agent({ agent_status: 'blocked' }),
      agent({ agent_status: 'working' }),
    ]);

    expect(rollup.total).toBe(4);
    expect(rollup.status).toBe('blocked');
    expect(rollup.blocked).toBe(2);
    expect(rollup.counts).toEqual({ blocked: 2, done: 0, working: 1, idle: 1, unknown: 0 });
    expect(blockedCount([agent({ agent_status: 'blocked' })])).toBe(1);
  });

  it('sin agentes el rollup es unknown y no cuenta nada', () => {
    const rollup = rollupAgents([]);
    expect(rollup).toMatchObject({ status: 'unknown', total: 0, blocked: 0 });
    expect(blockedCount([])).toBe(0);
  });

  it('el peor estado sigue el orden blocked > done > working > idle > unknown', () => {
    expect(
      rollupAgents([agent({ agent_status: 'done' }), agent({ agent_status: 'working' })]).status,
    ).toBe('done');
    expect(
      rollupAgents([agent({ agent_status: 'idle' }), agent({ agent_status: 'unknown' })]).status,
    ).toBe('idle');
  });
});
