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

  /** Reordena la pestaña dentro de su espacio (drag de la tab bar, T3.2). */
  async move(tabId: string, insertIndex: number): Promise<void> {
    await call('tab.move', { tab_id: tabId, insert_index: insertIndex });
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

  /** Modo resize (T3.1): mueve el divisor del panel en `direction`. */
  async resize(direction: PaneDirection, amount = 0.05, paneId?: string | null): Promise<void> {
    await call('pane.resize', { pane_id: paneId ?? null, direction, amount });
  },

  /** Intercambia dos paneles (drag del header sobre otro, T3.1). */
  async swap(sourcePaneId: string, targetPaneId: string): Promise<void> {
    await call('pane.swap', {
      source_pane_id: sourcePaneId,
      target_pane_id: targetPaneId,
    });
  },

  /** Mueve un panel a otra pestaña, pestaña nueva o espacio nuevo (T3.1). */
  async move(paneId: string, destination: Api.PaneMoveDestination, focus = true): Promise<void> {
    await call('pane.move', { pane_id: paneId, destination, focus });
  },

  async sendText(paneId: string, text: string): Promise<void> {
    await call('pane.send_text', { pane_id: paneId, text });
  },

  /** Texto + teclas de golpe (`pane.send_input`, T3.8). */
  async sendInput(paneId: string, text: string, keys: string[] = []): Promise<void> {
    await call('pane.send_input', { pane_id: paneId, text, keys });
  },

  /** Espera a que la salida del panel coincida (T3.9). Devuelve la respuesta. */
  async waitForOutput(
    paneId: string,
    match: Api.OutputMatch,
    timeoutMs: number,
    lines: number,
  ): Promise<Api.ResponseResult> {
    return call('pane.wait_for_output', {
      pane_id: paneId,
      match,
      source: 'recent_unwrapped',
      lines,
      strip_ansi: true,
      timeout_ms: timeoutMs,
    });
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

/**
 * Fuente con la que la GUI reporta/libera los agentes que arranca ella misma
 * (`pane.report_agent` / `pane.release_agent`). El backend acepta cualquier
 * `source`: se usa una propia para poder distinguir lo que ha lanzado la GUI.
 */
export const GUI_AGENT_SOURCE = 'custom:herdr-desk';

export const agentApi = {
  async list(): Promise<Api.AgentInfo[]> {
    const result = await call('agent.list', {});
    return result.type === 'agent_list' ? result.agents : [];
  },

  async get(target: string): Promise<Api.AgentInfo | null> {
    const result = await call('agent.get', { target });
    return result.type === 'agent_info' ? result.agent : null;
  },

  /** Enfoca el agente en el servidor (la TUI lo marca como visto). */
  async focus(target: string): Promise<Api.AgentInfo | null> {
    const result = await call('agent.focus', { target });
    return result.type === 'agent_info' ? result.agent : null;
  },

  /** Renombra el agente; `null` limpia el nombre (`--clear`). */
  async rename(target: string, name: string | null): Promise<Api.AgentInfo | null> {
    const result = await call('agent.rename', { target, name });
    return result.type === 'agent_info' ? result.agent : null;
  },

  /** Teclas al agente: `esc` (Escape) y `ctrl+c` (interrumpir) son las de T2.2. */
  async sendKeys(target: string, keys: string[]): Promise<Api.AgentInfo | null> {
    const result = await call('agent.send_keys', { target, keys });
    return result.type === 'agent_info' ? result.agent : null;
  },

  async prompt(
    target: string,
    text: string,
    wait?: Api.AgentPromptWaitOptions | null,
  ): Promise<Api.AgentInfo | null> {
    const result = await call('agent.prompt', { target, text, wait: wait ?? null });
    return result.type === 'agent_prompted' ? result.agent : null;
  },

  /** Transcript del agente (`recent_unwrapped` como en la TUI). */
  async read(target: string, lines = 200): Promise<Api.PaneReadResult | null> {
    const result = await call('agent.read', {
      target,
      source: 'recent_unwrapped',
      lines,
      format: 'text',
      strip_ansi: true,
    });
    return result.type === 'pane_read' ? result.read : null;
  },

  /** Espera a que el agente llegue a alguno de esos estados. */
  async wait(
    target: string,
    until?: Api.AgentStatus[],
    timeoutMs?: number | null,
  ): Promise<Api.AgentInfo | null> {
    const result = await call('agent.wait', {
      target,
      until: until ?? [],
      timeout_ms: timeoutMs ?? null,
    });
    return result.type === 'agent_info' ? result.agent : null;
  },

  /** Explicación de la detección (JSON crudo, para el visor). */
  async explain(target: string): Promise<unknown> {
    const result = await call('agent.explain', { target });
    return result.type === 'agent_explain' ? result.explain : null;
  },

  /**
   * Reporta el agente que la GUI acaba de arrancar. El estado es `PaneAgentState`
   * (idle | working | blocked | unknown): `done` NO se puede reportar —lo pone el
   * detector del backend cuando el agente termina—.
   */
  async report(paneId: string, agent: string, state: Api.PaneAgentState): Promise<void> {
    await call('pane.report_agent', {
      pane_id: paneId,
      source: GUI_AGENT_SOURCE,
      agent,
      state,
    });
  },

  /** Suelta el agente (la GUI lo hace con su propia fuente). */
  async release(paneId: string, agent: string): Promise<void> {
    await call('pane.release_agent', {
      pane_id: paneId,
      source: GUI_AGENT_SOURCE,
      agent,
    });
  },

  /** Arranca un agente en un panel; devuelve el agente y el argv real. */
  async start(params: {
    pane_id: string;
    kind: string;
    name: string;
    args?: string[];
    timeout_ms?: number | null;
  }): Promise<{ agent: Api.AgentInfo; argv: string[] } | null> {
    const result = await call('agent.start', {
      pane_id: params.pane_id,
      kind: params.kind,
      name: params.name,
      args: params.args ?? [],
      timeout_ms: params.timeout_ms ?? null,
    });
    return result.type === 'agent_started' ? { agent: result.agent, argv: result.argv } : null;
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

  /** Aplica un preset de layout (`layout.apply`, T3.3). */
  async apply(
    root: Api.LayoutNode,
    options: {
      workspace_id?: string | null;
      tab_id?: string | null;
      tab_label?: string | null;
      focus?: boolean;
    } = {},
  ): Promise<void> {
    await call('layout.apply', {
      root,
      workspace_id: options.workspace_id ?? null,
      tab_id: options.tab_id ?? null,
      tab_label: options.tab_label ?? null,
      focus: options.focus ?? true,
    });
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
