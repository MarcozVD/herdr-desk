// T2.1 — Panel de agentes: lógica pura del panel de la sidebar.
//
// Sin runas ni DOM: se puede probar en vitest (node) y la usan el panel y los
// rollups. Todo lo que decide el ORDEN, las FILAS de cada agente y los TOKENS
// de cada fila vive aquí, para que la config `[ui.sidebar.agents]` de herdr
// (rows / rows_by_agent / row_gap, y los `$name` de metadata) tenga una sola
// traducción a UI.
//
// Contrato de la config (fixture `tests/fixtures/default-config.toml`):
//   [ui.sidebar.agents]
//   row_gap = 0
//   rows = [["state_icon", "workspace", "tab"], ["agent"]]
//   [ui.sidebar.agents.rows_by_agent]
//   claude = [["state_icon", "workspace", "tab"], ["terminal_title_stripped"], ["agent"]]
// Un token puede ser un string o `{ token = "workspace", fg = "#89b4fa", bold = true }`.

import type { AgentInfo, AgentStatus, TabInfo, WorkspaceInfo } from '../herdr/types';
import { sortAgentsByPriority } from '../stores/snapshot';

/** Tokens built-in de una fila de agente (los demás son `$name` de metadata). */
export const AGENT_BUILT_IN_TOKENS = [
  'state_icon',
  'state_text',
  'workspace',
  'tab',
  'pane',
  'agent',
  'terminal_title',
  'terminal_title_stripped',
] as const;

export type AgentBuiltInToken = (typeof AGENT_BUILT_IN_TOKENS)[number];

/** Estilo inline de un token (patrón de la config; los campos que faltan se heredan). */
export interface AgentTokenStyle {
  fg?: string;
  bold?: boolean;
  dim?: boolean;
}

/** Un token tal cual viene de la config: string o `{ token, fg?, bold?, dim? }`. */
export type AgentTokenSpec = string | ({ token: string } & AgentTokenStyle);

/** Filas de un agente: array de filas y cada fila un array de tokens. */
export type AgentRows = AgentTokenSpec[][];

export interface AgentRowsConfig {
  /** Filas por defecto. */
  rows?: AgentRows | null;
  /** Filas por id canónico de agente (`rows_by_agent`). */
  rowsByAgent?: Record<string, AgentRows> | null;
  /** Filas en blanco entre agentes (`row_gap`). */
  rowGap?: number | null;
}

/** Filas por defecto si la config no dice otra cosa (default-config de herdr). */
export const DEFAULT_AGENT_ROWS: AgentRows = [['state_icon', 'workspace', 'tab'], ['agent']];

export const DEFAULT_AGENT_ROW_GAP = 0;

export const DEFAULT_AGENT_ROWS_CONFIG: Required<AgentRowsConfig> = {
  rows: DEFAULT_AGENT_ROWS,
  rowsByAgent: {},
  rowGap: DEFAULT_AGENT_ROW_GAP,
};

/** Un token ya resuelto: qué pintar y con qué estilo. */
export interface ResolvedAgentToken {
  /** Nombre del token (`state_icon`, `workspace`, `$jj_status`…). */
  id: string;
  /** `icon` pinta el punto de estado; `text` pinta texto. */
  kind: 'icon' | 'text';
  /** Texto (vacío en el icono). */
  text: string;
  /** Estado, solo en `state_icon`. */
  status?: AgentStatus;
  style: AgentTokenStyle;
}

export interface AgentTokenContext {
  agent: AgentInfo;
  workspace: WorkspaceInfo | null;
  tab: TabInfo | null;
  /** Etiquetas i18n de estado (para `state_text`). */
  stateLabels: Record<AgentStatus, string>;
}

/** Nombre visible de un agente: `display_agent` > `agent` > id del pane. */
export function agentName(agent: AgentInfo): string {
  return agent.display_agent ?? agent.agent ?? agent.pane_id;
}

/** Id canónico del agente para `rows_by_agent` (`claude`, `opencode`…). */
export function canonicalAgentId(agent: AgentInfo): string | null {
  const id = agent.agent ?? agent.display_agent ?? null;
  return id && id.length > 0 ? id : null;
}

function normalizeToken(raw: unknown): AgentTokenSpec | null {
  if (typeof raw === 'string') return raw.trim().length > 0 ? raw.trim() : null;
  if (raw && typeof raw === 'object') {
    const spec = raw as Record<string, unknown>;
    const token = typeof spec.token === 'string' ? spec.token.trim() : '';
    if (token.length === 0) return null;
    const style: AgentTokenStyle = {};
    if (typeof spec.fg === 'string') style.fg = spec.fg;
    if (typeof spec.bold === 'boolean') style.bold = spec.bold;
    if (typeof spec.dim === 'boolean') style.dim = spec.dim;
    return { token, ...style };
  }
  return null;
}

/** Normaliza las filas de la config: descarta lo malformado y las filas vacías. */
export function normalizeAgentRows(raw: unknown): AgentRows {
  if (!Array.isArray(raw)) return [];
  const rows: AgentRows = [];
  for (const row of raw) {
    if (!Array.isArray(row)) continue;
    const tokens: AgentTokenSpec[] = [];
    for (const token of row) {
      const normalized = normalizeToken(token);
      if (normalized !== null) tokens.push(normalized);
    }
    if (tokens.length > 0) rows.push(tokens);
  }
  return rows;
}

/** Filas que le tocan a un agente: `rows_by_agent[<id canónico>]` manda sobre `rows`. */
export function agentRowsFor(agent: AgentInfo, config: AgentRowsConfig = {}): AgentRows {
  const specific = config.rowsByAgent ?? {};
  const canonical = canonicalAgentId(agent);
  if (canonical) {
    const rows = normalizeAgentRows(specific[canonical]);
    if (rows.length > 0) return rows;
  }
  const rows = normalizeAgentRows(config.rows ?? DEFAULT_AGENT_ROWS);
  return rows.length > 0 ? rows : DEFAULT_AGENT_ROWS;
}

/** Filas en blanco entre agentes (`row_gap`), acotadas a un rango razonable. */
export function agentRowGap(config: AgentRowsConfig = {}): number {
  const gap = Math.trunc(config.rowGap ?? DEFAULT_AGENT_ROW_GAP);
  if (!Number.isFinite(gap) || gap < 0) return DEFAULT_AGENT_ROW_GAP;
  return Math.min(gap, 5);
}

/**
 * `«número» «etiqueta»` sin repetir: las pestañas de herdr vienen etiquetadas
 * con su propio número («1»), y pintarlas daría «1 1».
 */
function numberedLabel(number: number, label: string): string {
  const text = label.trim();
  return text.length === 0 || text === String(number) ? String(number) : `${number} ${text}`;
}

function styleOf(spec: AgentTokenSpec): AgentTokenStyle {
  return typeof spec === 'string' ? {} : { fg: spec.fg, bold: spec.bold, dim: spec.dim };
}

function tokenId(spec: AgentTokenSpec): string {
  return typeof spec === 'string' ? spec : spec.token;
}

/**
 * Resuelve un token de la config a algo pintable.
 *
 * - built-ins: `state_icon`, `state_text`, `workspace`, `tab`, `pane`, `agent`,
 *   `terminal_title`, `terminal_title_stripped`.
 * - `$name`: metadata del pane (`tokens` y `state_labels` de herdr); si no
 *   existe, el token se Omite (no se pinta un hueco vacío).
 * - token vacío o desconocido: `null`.
 */
export function resolveAgentToken(
  spec: AgentTokenSpec,
  ctx: AgentTokenContext,
): ResolvedAgentToken | null {
  const id = tokenId(spec);
  const style = styleOf(spec);
  if (id.length === 0) return null;

  if (id === 'state_icon') {
    return { id, kind: 'icon', text: '', status: ctx.agent.agent_status, style };
  }

  const text: string | null = (() => {
    switch (id) {
      case 'state_text':
        return ctx.stateLabels[ctx.agent.agent_status] ?? ctx.agent.agent_status;
      case 'workspace':
        return ctx.workspace
          ? numberedLabel(ctx.workspace.number, ctx.workspace.label)
          : ctx.agent.workspace_id;
      case 'tab':
        return ctx.tab ? numberedLabel(ctx.tab.number, ctx.tab.label) : ctx.agent.tab_id;
      case 'pane':
        return ctx.agent.pane_id;
      case 'agent':
        return agentName(ctx.agent);
      case 'terminal_title':
        return ctx.agent.terminal_title ?? '';
      case 'terminal_title_stripped':
        return ctx.agent.terminal_title_stripped ?? '';
      default: {
        if (!id.startsWith('$')) return null;
        const name = id.slice(1);
        return ctx.agent.tokens?.[name] ?? ctx.agent.state_labels?.[name] ?? '';
      }
    }
  })();

  // Token desconocido: no se pinta. Token conocido sin valor (`$vacio`, título
  // vacío): tampoco, para no dejar huecos en la fila.
  if (text === null || text.length === 0) return null;
  return { id, kind: 'text', text, style };
}

export type AgentPanelSort = 'spaces' | 'priority';

/** Alias documentado de la config: `workspaces` es lo mismo que `spaces`. */
export function normalizeAgentPanelSort(value: unknown): AgentPanelSort {
  return value === 'priority' ? 'priority' : 'spaces';
}

export interface AgentPanelSection {
  /** Id de la sección: `priority` para la cola de atención, o el workspace. */
  id: string;
  /** Título (vacío en la cola de atención). */
  title: string;
  agents: AgentInfo[];
}

export interface AgentPanelInput {
  agents: readonly AgentInfo[];
  workspaces: readonly WorkspaceInfo[];
  mode: AgentPanelSort;
  /** Texto del filtro (vacío = todos). */
  query?: string;
}

function matchesQuery(agent: AgentInfo, needle: string, workspace: string, tab: string): boolean {
  const haystack = [
    agent.display_agent,
    agent.agent,
    agent.name,
    agent.terminal_title_stripped,
    agent.terminal_title,
    agent.pane_id,
    agent.cwd,
    workspace,
    tab,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

/**
 * Filtra y ordena los agentes y los agrupa según el modo.
 *
 * - `priority`: una sola sección (cola de atención) con
 *   `blocked > done > working > idle > unknown`; los empates por
 *   `state_change_seq` (más reciente primero) y luego `pane_id` — el mismo
 *   comparador que ya usa la sidebar desde F1 (`sortAgentsByPriority`).
 * - `spaces`: una sección por workspace, en el orden del snapshot; dentro de
 *   cada una, el mismo orden por prioridad (así lo accionable queda arriba).
 *   Las secciones sin agentes (tras filtrar) no se pintan.
 */
export function buildAgentPanel(input: AgentPanelInput): AgentPanelSection[] {
  const query = (input.query ?? '').trim().toLowerCase();
  const workspaceById = new Map(input.workspaces.map((item) => [item.workspace_id, item]));

  const visible = input.agents.filter((agent) => {
    if (query.length === 0) return true;
    const workspace = workspaceById.get(agent.workspace_id);
    const label = workspace ? `${workspace.number} ${workspace.label}` : agent.workspace_id;
    return matchesQuery(agent, query, label, agent.tab_id);
  });

  const sorted = sortAgentsByPriority(visible);

  if (input.mode === 'priority') {
    return sorted.length === 0 ? [] : [{ id: 'priority', title: '', agents: sorted }];
  }

  const sections: AgentPanelSection[] = [];
  const placed = new Set<string>();
  for (const workspace of input.workspaces) {
    const agents = sorted.filter((agent) => agent.workspace_id === workspace.workspace_id);
    if (agents.length === 0) continue;
    placed.add(workspace.workspace_id);
    sections.push({
      id: workspace.workspace_id,
      title: `${workspace.number} ${workspace.label}`.trim(),
      agents,
    });
  }
  // Agentes de un workspace que ya no está en el snapshot: no se pierden; van a
  // una sección propia al final (una por workspace desconocido).
  const extras = new Map<string, AgentInfo[]>();
  for (const agent of sorted) {
    if (placed.has(agent.workspace_id)) continue;
    const bucket = extras.get(agent.workspace_id);
    if (bucket) bucket.push(agent);
    else extras.set(agent.workspace_id, [agent]);
  }
  for (const [workspaceId, agents] of extras) {
    sections.push({ id: workspaceId, title: workspaceId, agents });
  }
  return sections;
}

export interface AgentRollup {
  status: AgentStatus;
  total: number;
  counts: Record<AgentStatus, number>;
  /** Cuántos hay en `blocked` (lo que va al overlay de la barra de tareas). */
  blocked: number;
}

const STATUS_ORDER: readonly AgentStatus[] = ['blocked', 'done', 'working', 'idle', 'unknown'];

/** Rollup de estado de un conjunto de agentes (workspace, tab o la sesión). */
export function rollupAgents(agents: readonly AgentInfo[]): AgentRollup {
  const counts: Record<AgentStatus, number> = {
    blocked: 0,
    done: 0,
    working: 0,
    idle: 0,
    unknown: 0,
  };
  for (const agent of agents) counts[agent.agent_status] += 1;
  let status: AgentStatus = 'unknown';
  if (agents.length > 0) {
    status = STATUS_ORDER.find((candidate) => counts[candidate] > 0) ?? 'unknown';
  }
  return { status, total: agents.length, counts, blocked: counts.blocked };
}

/** Agentes de un workspace (para el rollup de la fila de espacio). */
export function agentsOfWorkspace(agents: readonly AgentInfo[], workspaceId: string): AgentInfo[] {
  return agents.filter((agent) => agent.workspace_id === workspaceId);
}

/** Agentes de un tab (para el rollup de la pestaña). */
export function agentsOfTab(agents: readonly AgentInfo[], tabId: string): AgentInfo[] {
  return agents.filter((agent) => agent.tab_id === tabId);
}

/** Cuántos agentes bloqueados hay en total (overlay de la barra de tareas). */
export function blockedCount(agents: readonly AgentInfo[]): number {
  return rollupAgents(agents).blocked;
}
