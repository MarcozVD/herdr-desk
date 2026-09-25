// Acciones tipadas sobre el API de herdr: un solo sitio con los comandos que usan
// la UI (T1.9), el motor de atajos (T1.10) y el selector de sesiones (T1.11).

import { call, callFor } from './client';
import type * as Api from './types.gen';

export type SplitDirection = Api.SplitDirection;
export type PaneDirection = Api.PaneDirection;
export type LayoutNode = Api.LayoutNode;

export const workspaceApi = {
  async create(params: {
    cwd?: string | null;
    label?: string | null;
    focus?: boolean;
  }): Promise<Api.WorkspaceInfo | null> {
    const result = await call('workspace.create', params);
    return result.type === 'workspace_created' ? result.workspace : null;
  },

  async rename(workspaceId: string, label: string): Promise<void> {
    await call('workspace.rename', { workspace_id: workspaceId, label });
  },

  async close(workspaceId: string): Promise<void> {
    await call('workspace.close', { workspace_id: workspaceId });
  },

  async focus(workspaceId: string): Promise<void> {
    await call('workspace.focus', { workspace_id: workspaceId });
  },

  async move(workspaceId: string, insertIndex: number): Promise<void> {
    await call('workspace.move', { workspace_id: workspaceId, insert_index: insertIndex });
  },

  async list(): Promise<Api.WorkspaceInfo[]> {
    const result = await call('workspace.list', {});
    return result.type === 'workspace_list' ? result.workspaces : [];
  },
};

export const tabApi = {
  async create(params: {
    workspace_id?: string | null;
    cwd?: string | null;
    label?: string | null;
    focus?: boolean;
  }): Promise<Api.TabInfo | null> {
    const result = await call('tab.create', params);
    return result.type === 'tab_created' ? result.tab : null;
  },

  async rename(tabId: string, label: string): Promise<void> {
    await call('tab.rename', { tab_id: tabId, label });
  },

  async close(tabId: string): Promise<void> {
    await call('tab.close', { tab_id: tabId });
  },

  async focus(tabId: string): Promise<void> {
    await call('tab.focus', { tab_id: tabId });
  },
};

export const paneApi = {
  async split(params: {
    direction: SplitDirection;
    workspace_id?: string | null;
    target_pane_id?: string | null;
    cwd?: string | null;
    ratio?: number | null;
    focus?: boolean;
  }): Promise<Api.PaneInfo | null> {
    const result = await call('pane.split', params);
    return result.type === 'pane_info' ? result.pane : null;
  },

  async close(paneId: string): Promise<void> {
    await call('pane.close', { pane_id: paneId });
  },

  async zoom(paneId: string, mode: 'toggle' | 'on' | 'off' = 'toggle'): Promise<void> {
    await call('pane.zoom', { pane_id: paneId, mode });
  },

  async rename(paneId: string, label: string): Promise<void> {
    await call('pane.rename', { pane_id: paneId, label });
  },

  async focus(paneId: string): Promise<void> {
    await call('pane.focus', { pane_id: paneId });
  },

  async focusDirection(direction: PaneDirection, paneId?: string | null): Promise<void> {
    await call('pane.focus_direction', { direction, pane_id: paneId ?? null });
  },

  async sendText(paneId: string, text: string): Promise<void> {
    await call('pane.send_text', { pane_id: paneId, text });
  },

  async read(paneId: string, lines = 200): Promise<string> {
    const result = await call('pane.read', {
      pane_id: paneId,
      source: 'recent_unwrapped',
      lines,
      format: 'text',
      strip_ansi: true,
    });
    return result.type === 'pane_read' ? result.read.text : '';
  },
};

export const layoutApi = {
  /** Árbol del tab visible (`layout.export`). */
  async export(tabId: string): Promise<Api.LayoutNode | null> {
    const result = await call('layout.export', { tab_id: tabId });
    return result.type === 'layout_export' ? result.layout.root : null;
  },

  async setSplitRatio(tabId: string, path: boolean[], ratio: number): Promise<void> {
    await call('layout.set_split_ratio', { tab_id: tabId, path, ratio });
  },
};

export const serverApi = {
  async ping(): Promise<Api.ResponsePong | null> {
    const result = await call('ping', {});
    return result.type === 'pong' ? result : null;
  },

  async reloadConfig(): Promise<Api.ConfigReloadStatus> {
    const result = await callFor('server.reload_config', {}, 'config_reload');
    return result.status;
  },
};
