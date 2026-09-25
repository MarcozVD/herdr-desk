// Tipos mínimos del protocolo herdr para el spike F0, escritos a mano desde
// `herdr api schema --json` (0.8.0-preview, protocol 19). En F1 los reemplaza
// el codegen (`scripts/gen-types.mjs` -> src/lib/herdr/types.gen.ts).

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

export type SplitDirection = 'right' | 'down';

export interface PaneScrollInfo {
  offset_from_bottom: number;
  max_offset_from_bottom: number;
  viewport_rows: number;
}

export interface WorkspaceWorktreeInfo {
  repo_key: string;
  repo_name: string;
  repo_root: string;
  checkout_path: string;
  is_linked_worktree: boolean;
}

export interface WorkspaceInfo {
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  tab_count: number;
  active_tab_id: string;
  agent_status: AgentStatus;
  tokens?: Record<string, string>;
  worktree?: WorkspaceWorktreeInfo | null;
}

export interface TabInfo {
  tab_id: string;
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  agent_status: AgentStatus;
}

export interface PaneInfo {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tab_id: string;
  focused: boolean;
  agent_status: AgentStatus;
  revision: number;
  cwd?: string | null;
  foreground_cwd?: string | null;
  agent?: string | null;
  display_agent?: string | null;
  label?: string | null;
  title?: string | null;
  terminal_title?: string | null;
  terminal_title_stripped?: string | null;
  scroll?: PaneScrollInfo | null;
  tokens?: Record<string, string>;
}

export interface AgentInfo {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tab_id: string;
  focused: boolean;
  agent_status: AgentStatus;
  revision: number;
  state_change_seq?: number;
  agent?: string | null;
  display_agent?: string | null;
  name?: string | null;
  cwd?: string | null;
  foreground_cwd?: string | null;
  label?: string | null;
  title?: string | null;
  terminal_title?: string | null;
  terminal_title_stripped?: string | null;
  interactive_ready?: boolean;
  launch_pending?: boolean;
  tokens?: Record<string, string>;
}

export interface PaneLayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaneLayoutPane {
  pane_id: string;
  focused: boolean;
  rect: PaneLayoutRect;
}

export interface PaneLayoutSplit {
  id: string;
  direction: SplitDirection;
  ratio: number;
  rect: PaneLayoutRect;
}

export interface PaneLayoutSnapshot {
  workspace_id: string;
  tab_id: string;
  zoomed: boolean;
  area: PaneLayoutRect;
  focused_pane_id: string;
  panes: PaneLayoutPane[];
  splits: PaneLayoutSplit[];
}

/** Cuerpo de `session.snapshot` (sin el envoltorio `{type, snapshot}`). */
export interface SessionSnapshot {
  version: string;
  protocol: number;
  focused_workspace_id?: string | null;
  focused_tab_id?: string | null;
  focused_pane_id?: string | null;
  workspaces: WorkspaceInfo[];
  tabs: TabInfo[];
  panes: PaneInfo[];
  layouts: PaneLayoutSnapshot[];
  agents: AgentInfo[];
}

export interface SessionSnapshotEnvelope {
  type: 'session_snapshot';
  snapshot: SessionSnapshot;
}

export interface PingResult {
  type: 'pong';
  version: string;
  protocol: number;
  capabilities?: Record<string, boolean>;
}

export interface SessionInfo {
  default: boolean;
  name: string;
  running: boolean;
  session_dir: string;
  socket_path: string;
}

/** Error devuelto por los commands de Tauri (§5 del plan). */
export interface ApiError {
  code: string;
  message: string;
}

export type ConnectionState = 'connecting' | 'online' | 'offline';
