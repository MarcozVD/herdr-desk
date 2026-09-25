// Helpers puros sobre `session.snapshot`: sin runas, para poder probarlos con
// vitest en node y reusarlos desde los stores.

import type {
  AgentInfo,
  AgentStatus,
  PaneInfo,
  SessionSnapshot,
  TabInfo,
  WorkspaceInfo,
} from '../herdr/types';

export const AGENT_STATUS_ORDER: readonly AgentStatus[] = [
  'blocked',
  'done',
  'working',
  'idle',
  'unknown',
];

export function workspacesOf(snapshot: SessionSnapshot | null): WorkspaceInfo[] {
  return snapshot?.workspaces ?? [];
}

export function tabsOf(snapshot: SessionSnapshot | null): TabInfo[] {
  return snapshot?.tabs ?? [];
}

export function panesOf(snapshot: SessionSnapshot | null): PaneInfo[] {
  return snapshot?.panes ?? [];
}

export function agentsOf(snapshot: SessionSnapshot | null): AgentInfo[] {
  return snapshot?.agents ?? [];
}

export function focusedWorkspaceOf(snapshot: SessionSnapshot | null): WorkspaceInfo | null {
  if (!snapshot) return null;
  const id = snapshot.focused_workspace_id;
  const found = snapshot.workspaces.find((workspace) => workspace.workspace_id === id);
  return found ?? snapshot.workspaces.find((workspace) => workspace.focused) ?? null;
}

export function focusedTabOf(snapshot: SessionSnapshot | null): TabInfo | null {
  if (!snapshot) return null;
  const id = snapshot.focused_tab_id;
  const found = snapshot.tabs.find((tab) => tab.tab_id === id);
  return found ?? snapshot.tabs.find((tab) => tab.focused) ?? null;
}

export function focusedPaneIdOf(snapshot: SessionSnapshot | null): string | null {
  if (!snapshot) return null;
  if (snapshot.focused_pane_id) {
    const exists = snapshot.panes.some((pane) => pane.pane_id === snapshot.focused_pane_id);
    if (exists) return snapshot.focused_pane_id;
  }
  return snapshot.panes.find((pane) => pane.focused)?.pane_id ?? null;
}

export function focusedPaneOf(snapshot: SessionSnapshot | null): PaneInfo | null {
  const id = focusedPaneIdOf(snapshot);
  if (!id) return null;
  return snapshot?.panes.find((pane) => pane.pane_id === id) ?? null;
}

export function tabsOfWorkspace(
  snapshot: SessionSnapshot | null,
  workspaceId: string | null | undefined,
): TabInfo[] {
  if (!workspaceId) return [];
  return tabsOf(snapshot).filter((tab) => tab.workspace_id === workspaceId);
}

export function panesOfTab(
  snapshot: SessionSnapshot | null,
  tabId: string | null | undefined,
): PaneInfo[] {
  if (!tabId) return [];
  return panesOf(snapshot).filter((pane) => pane.tab_id === tabId);
}

/** Orden de prioridad del panel de agentes (T2.1): blocked > done > working > idle > unknown. */
export function sortAgentsByPriority(agents: readonly AgentInfo[]): AgentInfo[] {
  return [...agents].sort((left, right) => {
    const delta =
      AGENT_STATUS_ORDER.indexOf(left.agent_status) -
      AGENT_STATUS_ORDER.indexOf(right.agent_status);
    if (delta !== 0) return delta;
    const leftSeq = left.state_change_seq ?? 0;
    const rightSeq = right.state_change_seq ?? 0;
    if (leftSeq !== rightSeq) return rightSeq - leftSeq;
    return left.pane_id.localeCompare(right.pane_id);
  });
}

export function countAgentsByStatus(agents: readonly AgentInfo[]): Record<AgentStatus, number> {
  const counts: Record<AgentStatus, number> = {
    blocked: 0,
    done: 0,
    working: 0,
    idle: 0,
    unknown: 0,
  };
  for (const agent of agents) counts[agent.agent_status] += 1;
  return counts;
}

/** Título visible de un panel: label > título de terminal > agente > id. */
export function paneTitle(pane: PaneInfo | null): string {
  if (!pane) return '';
  return (
    pane.label ||
    pane.title ||
    pane.terminal_title_stripped ||
    pane.display_agent ||
    pane.agent ||
    pane.pane_id
  );
}

/** Últimas dos partes de una ruta, para la status bar. */
export function shortPath(path: string | null | undefined): string {
  if (!path) return '';
  const normalized = path.replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/).filter((part) => part.length > 0);
  if (parts.length === 0) return path;
  return parts.length <= 2 ? parts.join('/') : parts.slice(-2).join('/');
}

export function workspaceOfPane(
  snapshot: SessionSnapshot | null,
  pane: PaneInfo | null,
): WorkspaceInfo | null {
  if (!snapshot || !pane) return null;
  return (
    snapshot.workspaces.find((workspace) => workspace.workspace_id === pane.workspace_id) ?? null
  );
}
