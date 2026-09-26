// T1.9 — Flujos de UI (diálogos + comandos) que usan la sidebar, la tab bar, los
// paneles y el motor de atajos. Cada flujo avisa por toast si herdr responde error.

import { es } from '../i18n/es';
import type * as Api from '../herdr/types.gen';
import type { SplitDirection } from '../herdr/types.gen';
import { agentApi, paneApi, serverApi, tabApi, workspaceApi } from '../herdr/actions';
import { noticeCenter } from '../agents/noticeCenter';
import { describeApiError, errorText, parseApiError } from '../herdr/errors';
import {
  AGENT_KEY,
  agentAtAttentionIndex,
  agentLabel,
  clampAgentStartTimeout,
  cycleAgent,
  DEFAULT_AGENT_WAIT_MS,
  prettyJson,
  TRANSCRIPT_LINES,
  validateAgentName,
  type AgentKeyName,
} from '../agents/agentActions';
import { findPane, neighborPane } from '../layout/tree';
import { session } from '../stores/session.svelte';
import { settings } from '../stores/settings.svelte';
import { ui } from '../stores/ui.svelte';
import { layout } from '../stores/layout.svelte';
import { pool } from '../terminal/pool';

export type PaneDirection = 'left' | 'right' | 'up' | 'down';

/**
 * Panel, tab y espacio de las acciones de la GUI: manda el foco LOCAL (lo que el
 * usuario ve), pero solo si ese id existe de verdad en la sesión. Un id viejo
 * —o un tab guardado por error como panel— no puede silenciar la acción ni
 * actuar sobre un panel de una pestaña que no se está viendo.
 */
export function actionTarget(): {
  paneId: string | null;
  tabId: string | null;
  workspaceId: string | null;
} {
  return ui.actionTarget({
    server: {
      paneId: session.focusedPaneId,
      tabId: session.focusedTabId,
      workspaceId: session.focusedWorkspaceId,
    },
    panes: session.panes.map((pane) => pane.pane_id),
    tabs: session.tabs.map((tab) => tab.tab_id),
    workspaces: session.workspaces.map((workspace) => workspace.workspace_id),
  });
}

function fail(raw: unknown, method?: string): void {
  ui.notify(
    describeApiError(raw, { method, session: session.sessionName ?? es.app.sessionUnknown }),
    'error',
  );
}

function ok(message: string): void {
  ui.notify(message, 'info');
}

/** Nombre por defecto cuando el ajuste no pide prompt. */
function defaultLabel(kind: 'workspace' | 'tab'): string {
  if (kind === 'workspace') {
    const next = session.workspaces.length + 1;
    return `espacio-${next}`;
  }
  const next = session.tabsOfFocusedWorkspace.length + 1;
  return `tab-${next}`;
}

export const flows = {
  /* ---- Espacios ---- */

  async createWorkspace(): Promise<void> {
    const current = session.focusedPane?.cwd ?? '';
    const form = await ui.workspaceForm({
      title: es.workspace.create,
      cwdValue: current,
    });
    if (!form) return;
    const label = settings.values.prompt_new_workspace_name ? form.label : form.label || null;
    try {
      const workspace = await workspaceApi.create({
        label,
        cwd: form.cwd.length > 0 ? form.cwd : null,
        focus: true,
      });
      if (workspace) ui.focusWorkspaceLocally(workspace.workspace_id);
    } catch (raw) {
      fail(raw, 'workspace.create');
    }
  },

  async renameWorkspace(workspaceId: string): Promise<void> {
    const workspace = session.workspaces.find((item) => item.workspace_id === workspaceId);
    const label = await ui.prompt({
      title: es.workspace.rename,
      label: es.workspace.labelLabel,
      value: workspace?.label ?? '',
      submitLabel: es.dialog.save,
    });
    if (label === null) return;
    try {
      await workspaceApi.rename(workspaceId, label);
    } catch (raw) {
      fail(raw, 'workspace.rename');
    }
  },

  async closeWorkspace(workspaceId: string): Promise<void> {
    const workspace = session.workspaces.find((item) => item.workspace_id === workspaceId);
    if (settings.values.confirm_close) {
      const accepted = await ui.confirm({
        title: es.workspace.close,
        message: es.workspace.closeConfirm.replace('{label}', workspace?.label ?? workspaceId),
        confirmLabel: es.workspace.close,
        danger: true,
      });
      if (!accepted) return;
    }
    try {
      await workspaceApi.close(workspaceId);
    } catch (raw) {
      fail(raw, 'workspace.close');
    }
  },

  /**
   * Cambia de espacio en la GUI (R11: local por defecto; con «Sincronizar foco
   * con TUI» también se lo pide a herdr).
   *
   * El foco local tiene que quedar COMPLETO y con ids reales: espacio, tab (el
   * último visitado de ese espacio, si no el primero) y un panel de ese tab. Con
   * un id inventado la vista no seguía el clic y las acciones apuntaban a un
   * panel inexistente.
   */
  focusWorkspace(workspaceId: string): void {
    ui.focusWorkspaceLocally(workspaceId);
    const tabs = session.tabs.filter((tab) => tab.workspace_id === workspaceId);
    const remembered = ui.tabByWorkspace[workspaceId];
    const activeTabId = session.workspaces.find(
      (item) => item.workspace_id === workspaceId,
    )?.active_tab_id;
    const tab =
      tabs.find((item) => item.tab_id === remembered) ??
      tabs.find((item) => item.tab_id === activeTabId) ??
      tabs[0] ??
      null;
    ui.focusTabLocally(tab?.tab_id ?? null, workspaceId);
    const paneId = tab ? this.firstPaneOfTab(tab.tab_id) : null;
    if (paneId) ui.focusPaneLocally(paneId);
    if (settings.values.sync_focus_with_tui)
      void workspaceApi.focus(workspaceId).catch(() => undefined);
  },

  /** Primer panel de un tab: el del árbol exportado o el que trae el snapshot. */
  firstPaneOfTab(tabId: string): string | null {
    const exported = session.layouts.find((item) => item.tab_id === tabId);
    const fromLayout = exported?.panes.find((pane) => pane.pane_id)?.pane_id ?? null;
    if (fromLayout) return fromLayout;
    return session.panes.find((pane) => pane.tab_id === tabId)?.pane_id ?? null;
  },

  async moveWorkspace(workspaceId: string, delta: number): Promise<void> {
    const index = session.workspaces.findIndex((item) => item.workspace_id === workspaceId);
    if (index === -1) return;
    const insertIndex = Math.min(session.workspaces.length, Math.max(0, index + delta));
    if (insertIndex === index) return;
    try {
      await workspaceApi.move(workspaceId, insertIndex);
    } catch (raw) {
      fail(raw, 'workspace.move');
    }
  },

  async nextWorkspace(delta: number): Promise<void> {
    const workspaces = session.workspaces;
    if (workspaces.length === 0) return;
    const index = workspaces.findIndex((item) => item.workspace_id === session.focusedWorkspaceId);
    const next = workspaces[(index + delta + workspaces.length) % workspaces.length];
    if (next) this.focusWorkspace(next.workspace_id);
  },

  async switchWorkspaceNumber(number: number): Promise<void> {
    const workspace = session.workspaces.find((item) => item.number === number);
    if (workspace) this.focusWorkspace(workspace.workspace_id);
  },

  /* ---- Pestañas ---- */

  async newTab(): Promise<void> {
    const workspaceId = session.focusedWorkspaceId;
    if (!workspaceId) return;
    let label: string | null = null;
    if (settings.values.prompt_new_tab_name) {
      label = await ui.prompt({
        title: es.tabs.newTab,
        label: es.workspace.labelLabel,
        placeholder: defaultLabel('tab'),
        submitLabel: es.dialog.create,
      });
      if (label === null) return;
    }
    try {
      await tabApi.create({
        workspace_id: workspaceId,
        cwd: session.focusedPane?.cwd ?? null,
        label,
        focus: true,
      });
    } catch (raw) {
      fail(raw, 'tab.create');
    }
  },

  async renameTab(tabId: string): Promise<void> {
    const tab = session.tabs.find((item) => item.tab_id === tabId);
    const label = await ui.prompt({
      title: es.tabs.rename,
      label: es.workspace.labelLabel,
      value: tab?.label ?? '',
      submitLabel: es.dialog.save,
    });
    if (label === null) return;
    try {
      await tabApi.rename(tabId, label);
    } catch (raw) {
      fail(raw, 'tab.rename');
    }
  },

  async closeTab(tabId: string): Promise<void> {
    const tab = session.tabs.find((item) => item.tab_id === tabId);
    if (settings.values.confirm_close) {
      const accepted = await ui.confirm({
        title: es.tabs.close,
        message: es.tabs.closeConfirm.replace('{label}', tab?.label ?? tabId),
        confirmLabel: es.tabs.close,
        danger: true,
      });
      if (!accepted) return;
    }
    try {
      await tabApi.close(tabId);
    } catch (raw) {
      fail(raw, 'tab.close');
    }
  },

  async focusTab(tabId: string): Promise<void> {
    // El foco local manda en la vista: se marca el tab (y su espacio) ya, y el
    // backend además mueve el foco del server (que es de donde cuelga el árbol).
    const tab = session.tabs.find((item) => item.tab_id === tabId);
    if (tab) ui.focusTabLocally(tabId, tab.workspace_id);
    try {
      await tabApi.focus(tabId);
    } catch (raw) {
      fail(raw, 'tab.focus');
    }
  },

  async nextTab(delta: number): Promise<void> {
    const tabs = session.tabsOfFocusedWorkspace;
    if (tabs.length === 0) return;
    const index = tabs.findIndex((tab) => tab.tab_id === session.focusedTabId);
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) await this.focusTab(next.tab_id);
  },

  async switchTabNumber(number: number): Promise<void> {
    const tab = session.tabsOfFocusedWorkspace.find((item) => item.number === number);
    if (tab) await this.focusTab(tab.tab_id);
  },

  /* ---- Paneles ---- */

  async splitPane(direction: 'right' | 'down', paneId?: string | null): Promise<void> {
    const target = paneId ?? actionTarget().paneId;
    try {
      await paneApi.split({
        direction,
        target_pane_id: target,
        workspace_id: target ? null : session.focusedWorkspaceId,
        cwd: session.focusedPane?.cwd ?? null,
        focus: true,
      });
    } catch (raw) {
      fail(raw, 'pane.split');
    }
  },

  async closePane(paneId: string): Promise<void> {
    const pane = session.panes.find((item) => item.pane_id === paneId);
    const title = pane?.label ?? pane?.title ?? pane?.terminal_title_stripped ?? paneId;
    if (settings.values.confirm_close) {
      const accepted = await ui.confirm({
        title: es.panes.close,
        message: es.panes.closeConfirm.replace('{label}', title),
        confirmLabel: es.panes.close,
        danger: true,
      });
      if (!accepted) return;
    }
    try {
      await paneApi.close(paneId);
    } catch (raw) {
      fail(raw, 'pane.close');
    }
  },

  async toggleZoom(paneId: string): Promise<void> {
    try {
      await paneApi.zoom(paneId, 'toggle');
      await layout.refreshNow();
    } catch (raw) {
      fail(raw, 'pane.zoom');
    }
  },

  async renamePane(paneId: string): Promise<void> {
    const pane = session.panes.find((item) => item.pane_id === paneId);
    const label = await ui.prompt({
      title: es.panes.rename,
      label: es.workspace.labelLabel,
      value: pane?.label ?? '',
      submitLabel: es.dialog.save,
    });
    if (label === null) return;
    try {
      await paneApi.rename(paneId, label);
    } catch (raw) {
      fail(raw, 'pane.rename');
    }
  },

  /** Foco de panel: local por defecto; con sincronización también en herdr. */
  focusPane(paneId: string): void {
    const pane = session.panes.find((item) => item.pane_id === paneId);
    if (pane) {
      ui.focusTabLocally(pane.tab_id, pane.workspace_id);
      ui.focusWorkspaceLocally(pane.workspace_id);
    }
    ui.focusPaneLocally(paneId);
    if (settings.values.sync_focus_with_tui) void paneApi.focus(paneId).catch(() => undefined);
  },

  async focusPaneDirection(direction: PaneDirection): Promise<void> {
    if (settings.values.sync_focus_with_tui) {
      try {
        await paneApi.focusDirection(direction, actionTarget().paneId);
        return;
      } catch (raw) {
        fail(raw, 'pane.focus_direction');
        return;
      }
    }
    const current = actionTarget().paneId;
    if (!current) return;
    const neighbor = neighborPane(layout.tree, current, direction);
    if (neighbor?.paneId) ui.focusPaneLocally(neighbor.paneId);
  },

  /** Orden de lectura del árbol (cycle_pane_next/previous, T3.1 los usará). */
  cyclePane(delta: number): void {
    const panes = (layout.tree ? findPane(layout.tree, '') : null) ?? null;
    void panes;
    const visibleTab = actionTarget().tabId;
    const ids = session.panes
      .filter((pane) => pane.tab_id === visibleTab)
      .map((pane) => pane.pane_id);
    if (ids.length === 0) return;
    const index = ids.indexOf(session.focusedPaneId ?? '');
    const next = ids[(index + delta + ids.length) % ids.length];
    if (next) ui.focusPaneLocally(next);
  },

  lastPane(): void {
    const previous = ui.lastPane();
    if (previous) ui.focusPaneLocally(previous);
  },

  /* ---- Servidor / sesión ---- */

  async startServer(): Promise<void> {
    const started = await session.startServer();
    if (started) {
      ui.notify(es.connection.started.replace('{session}', session.sessionName ?? ''), 'info');
      return;
    }
    const error = session.startError;
    if (!error) return;
    const soft = error.code === 'missing_command' || error.code === 'no_session';
    ui.notify(errorText(error), soft ? 'warn' : 'error');
  },

  /**
   * Cambio de sesión activa (T1.11): NADA de la sesión anterior sobrevive.
   * Los terminales y bridges se sueltan (pool), se vacía el árbol de panes
   * (layout), se limpia el foco local (ui) y el store descarta snapshot,
   * colecciones, foco y epoch antes de reconectar. Sin esto quedaban panes de
   * la sesión vieja en pantalla con terminales en «desconectado».
   */
  async switchSession(name: string): Promise<void> {
    pool.disposeAll();
    layout.reset();
    ui.resetSessionState();
    // Los avisos de agente no se comparan entre sesiones distintas.
    noticeCenter.reset();
    await session.switchTo(name);
  },

  async reloadConfig(): Promise<void> {
    try {
      await serverApi.reloadConfig();
      ok(es.titlebar.reloaded);
    } catch (raw) {
      fail(raw, 'server.reload_config');
    }
  },

  /* ---- Contexto ---- */

  openWorkspaceMenu(event: MouseEvent, workspaceId: string): void {
    // Sin esto el WebView2 abriría su propio menú encima del nuestro.
    event.preventDefault();
    // Un clic no debe subir al `window` que cierra el menú (se cerraría solo).
    event.stopPropagation();
    ui.openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          id: 'focus',
          label: es.panes.focus.replace('panel', 'espacio'),
          run: () => this.focusWorkspace(workspaceId),
        },
        { id: 'rename', label: es.workspace.rename, run: () => this.renameWorkspace(workspaceId) },
        { id: 'up', label: es.workspace.moveUp, run: () => this.moveWorkspace(workspaceId, -1) },
        { id: 'down', label: es.workspace.moveDown, run: () => this.moveWorkspace(workspaceId, 1) },
        {
          id: 'close',
          label: es.workspace.close,
          danger: true,
          run: () => this.closeWorkspace(workspaceId),
        },
      ],
    });
  },

  openTabMenu(event: MouseEvent, tabId: string): void {
    // Sin esto el WebView2 abriría su propio menú encima del nuestro.
    event.preventDefault();
    // Un clic no debe subir al `window` que cierra el menú (se cerraría solo).
    event.stopPropagation();
    ui.openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          id: 'focus',
          label: es.tabs.newTab.replace('Nueva', 'Enfocar'),
          run: () => this.focusTab(tabId),
        },
        { id: 'rename', label: es.tabs.rename, run: () => this.renameTab(tabId) },
        { id: 'close', label: es.tabs.close, danger: true, run: () => this.closeTab(tabId) },
      ],
    });
  },

  /* ---- Agentes (T2.2/T2.3) ---- */

  /**
   * Enfoca un agente (sidebar, paleta o atajos de cola) y **se va con él**: si su
   * panel está en otro espacio o en otra pestaña, la vista tiene que cambiar.
   *
   * El `target` de las acciones de agente es el id del panel (verificado en vivo).
   * La pestaña que manda es la del PROPIO panel (si no, no se vería); el criterio
   * de «recordada o activa» de `focusWorkspace` se usa al cambiar de espacio sin
   * panel concreto.
   */
  focusAgent(paneId: string): void {
    const pane = session.panes.find((item) => item.pane_id === paneId);
    if (pane) {
      ui.focusWorkspaceLocally(pane.workspace_id);
      ui.focusTabLocally(pane.tab_id, pane.workspace_id);
    }
    ui.focusPaneLocally(paneId);
    // `agent.focus` marca el agente como visto en el servidor. Sin sincronía de
    // foco no se toca la TUI, así que un fallo aquí no se le cuenta al usuario.
    const report = settings.values.sync_focus_with_tui;
    void agentApi.focus(paneId).catch((raw: unknown) => {
      if (report) fail(raw, 'agent.focus');
    });
  },

  /** Siguiente/anterior agente en la cola de atención (atajos de la TUI). */
  nextAgent(step: 1 | -1): void {
    // El foco que el usuario ve: el local manda sobre el del snapshot (validado).
    const current = actionTarget().paneId;
    const target = cycleAgent(session.agentsByPriority, current, step);
    if (target) this.focusAgent(target.pane_id);
  },

  /** N-ésimo agente de la cola de atención (`focus_agent: N`). */
  focusAgentNumber(index: number): void {
    const target = agentAtAttentionIndex(session.agentsByPriority, index);
    if (target) this.focusAgent(target.pane_id);
  },

  /**
   * Manda un prompt al agente. `wait` lo rellena el diálogo (`until` + timeout):
   * con espera, el RPC no vuelve hasta que el agente llega a ese estado.
   */
  async promptAgent(
    paneId: string,
    text: string,
    wait: { until: Api.AgentStatus[]; timeout_ms?: number | null } | null = null,
  ): Promise<boolean> {
    const body = text.trim();
    if (body.length === 0) return false;
    try {
      await agentApi.prompt(paneId, body, wait);
      return true;
    } catch (raw) {
      fail(raw, 'agent.prompt');
      return false;
    }
  },

  /** Teclas al agente: Escape y Ctrl+C (los botones del plan). */
  async sendAgentKey(paneId: string, key: AgentKeyName): Promise<void> {
    try {
      await agentApi.sendKeys(paneId, [key]);
    } catch (raw) {
      fail(raw, 'agent.send_keys');
    }
  },

  /** Renombrar el agente (validación del plan; vacío = quitar el nombre). */
  async renameAgent(paneId: string): Promise<void> {
    const agent = session.agents.find((item) => item.pane_id === paneId);
    const value = await ui.prompt({
      title: es.agents.rename,
      label: es.agents.nameLabel,
      value: agent?.name ?? '',
      placeholder: es.agents.namePlaceholder,
      hint: es.agents.nameHint,
      submitLabel: es.dialog.save,
      validate: (raw) => (raw.trim().length === 0 ? null : validateAgentName(raw)),
    });
    if (value === null) return;
    const name = value.trim();
    try {
      await agentApi.rename(paneId, name.length === 0 ? null : name);
    } catch (raw) {
      fail(raw, 'agent.rename');
    }
  },

  /** Transcript del agente (200 líneas, `recent_unwrapped`) en el visor. */
  async showAgentTranscript(paneId: string): Promise<void> {
    const agent = session.agents.find((item) => item.pane_id === paneId);
    const name = agent ? agentLabel(agent) : paneId;
    try {
      const read = await agentApi.read(paneId, TRANSCRIPT_LINES);
      ui.openViewer({
        title: es.agents.transcriptTitle.replace('{name}', name),
        text: read?.text ?? '',
        kind: 'text',
      });
    } catch (raw) {
      fail(raw, 'agent.read');
    }
  },

  /** Espera a que el agente llegue a un estado (timeout por defecto del plan). */
  async waitAgent(paneId: string, until: Api.AgentStatus): Promise<void> {
    const agent = session.agents.find((item) => item.pane_id === paneId);
    const name = agent ? agentLabel(agent) : paneId;
    const state = es.agentStatus[until];
    ui.notify(es.agents.waiting.replace('{name}', name).replace('{state}', state), 'info');
    try {
      await agentApi.wait(paneId, [until], DEFAULT_AGENT_WAIT_MS);
      ok(es.agents.waited.replace('{name}', name).replace('{state}', state));
    } catch (raw) {
      fail(raw, 'agent.wait');
    }
  },

  /** `agent.explain` en el visor, como JSON legible. */
  async explainAgent(paneId: string): Promise<void> {
    const agent = session.agents.find((item) => item.pane_id === paneId);
    try {
      const explain = await agentApi.explain(paneId);
      ui.openViewer({
        title: es.agents.explainTitle.replace('{name}', agent ? agentLabel(agent) : paneId),
        text: prettyJson(explain),
        kind: 'json',
      });
    } catch (raw) {
      fail(raw, 'agent.explain');
    }
  },

  /** Suelta el agente (el backend deja de saber de él en ese panel). */
  async releaseAgent(paneId: string): Promise<void> {
    const agent = session.agents.find((item) => item.pane_id === paneId);
    if (!agent) return;
    const name = agentLabel(agent);
    const confirmed = await ui.confirm({
      title: es.agents.release,
      message: es.agents.releaseConfirm.replace('{name}', name),
      confirmLabel: es.agents.release,
      danger: true,
    });
    if (!confirmed) return;
    try {
      await agentApi.release(paneId, agent.agent ?? name);
      ok(es.agents.released.replace('{name}', name));
    } catch (raw) {
      fail(raw, 'pane.release_agent');
    }
  },

  /** Abre el diálogo de iniciar agente para ese panel (T2.3). */
  openStartAgent(paneId: string, name: string): void {
    ui.openStartAgent(paneId, name);
  },

  /**
   * «Iniciar agente en un split nuevo»: parte el panel enfocado y abre el
   * diálogo apuntando al panel recién creado (que `pane.split` devuelve).
   */
  async startAgentInNewSplit(direction: SplitDirection): Promise<void> {
    const paneId = actionTarget().paneId;
    if (!paneId) return;
    try {
      const created = await paneApi.split({ direction, target_pane_id: paneId, focus: true });
      if (!created) return;
      await layout.refreshNow();
      ui.openStartAgent(created.pane_id, created.pane_id);
    } catch (raw) {
      fail(raw, 'pane.split');
    }
  },

  /**
   * Arranca un agente en el panel y lo reporta con la fuente de la GUI: así
   * aparece en el panel de agentes al momento, sin esperar al detector.
   */
  async startAgent(
    paneId: string,
    form: { kind: string; name: string; args: string[]; timeoutMs: number | null },
  ): Promise<boolean> {
    if (validateAgentName(form.name) !== null) return false;
    try {
      const started = await agentApi.start({
        pane_id: paneId,
        kind: form.kind,
        name: form.name.trim(),
        args: form.args,
        timeout_ms: clampAgentStartTimeout(form.timeoutMs),
      });
      if (!started) return false;
      await agentApi.report(paneId, form.kind, 'working');
      this.focusAgent(paneId);
      ok(
        es.agents.started
          .replace('{name}', form.name.trim())
          .replace('{kind}', form.kind)
          .replace('{argv}', started.argv.join(' ')),
      );
      return true;
    } catch (raw) {
      fail(raw, 'agent.start');
      return false;
    }
  },

  /** Menú contextual de una fila del panel de agentes. */
  openAgentMenu(event: MouseEvent, paneId: string): void {
    event.preventDefault();
    event.stopPropagation();
    const agent = session.agents.find((item) => item.pane_id === paneId);
    if (!agent) return;
    ui.openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { id: 'agent-focus', label: es.agents.focus, run: () => this.focusAgent(paneId) },
        {
          id: 'agent-prompt',
          label: es.agents.prompt,
          run: () => ui.openAgentPrompt(paneId, agentLabel(agent)),
        },
        {
          id: 'agent-escape',
          label: es.agents.sendEscape,
          run: () => this.sendAgentKey(paneId, AGENT_KEY.escape),
        },
        {
          id: 'agent-interrupt',
          label: es.agents.sendInterrupt,
          run: () => this.sendAgentKey(paneId, AGENT_KEY.interrupt),
        },
        { id: 'agent-rename', label: es.agents.rename, run: () => this.renameAgent(paneId) },
        {
          id: 'agent-transcript',
          label: es.agents.transcript,
          run: () => this.showAgentTranscript(paneId),
        },
        {
          id: 'agent-wait-idle',
          label: `${es.agents.wait}: ${es.agentStatus.idle}`,
          run: () => this.waitAgent(paneId, 'idle'),
        },
        {
          id: 'agent-wait-done',
          label: `${es.agents.wait}: ${es.agentStatus.done}`,
          run: () => this.waitAgent(paneId, 'done'),
        },
        { id: 'agent-explain', label: es.agents.explain, run: () => this.explainAgent(paneId) },
        {
          id: 'agent-release',
          label: es.agents.release,
          danger: true,
          run: () => this.releaseAgent(paneId),
        },
      ],
    });
  },

  openPaneMenu(event: MouseEvent, paneId: string): void {
    // Sin esto el WebView2 abriría su propio menú encima del nuestro.
    event.preventDefault();
    // Y sin parar la propagación, el clic izquierdo del botón «…» sube hasta el
    // `window` de ContextMenu —que cierra el menú con cualquier clic— y el menú
    // se abría y se cerraba en el mismo gesto (el botón parecía no hacer nada).
    event.stopPropagation();
    ui.openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          id: 'start-agent',
          label: es.agents.start,
          run: () => this.openStartAgent(paneId, paneId),
        },
        {
          id: 'start-agent-right',
          label: es.agents.startSplit,
          run: () => this.startAgentInNewSplit('right'),
        },
        {
          id: 'split-right',
          label: es.panes.splitRight,
          run: () => this.splitPane('right', paneId),
        },
        { id: 'split-down', label: es.panes.splitDown, run: () => this.splitPane('down', paneId) },
        { id: 'zoom', label: es.panes.zoom, run: () => this.toggleZoom(paneId) },
        { id: 'rename', label: es.panes.rename, run: () => this.renamePane(paneId) },
        { id: 'close', label: es.panes.close, danger: true, run: () => this.closePane(paneId) },
      ],
    });
  },
};

export function toErrorMessage(raw: unknown, method?: string): string {
  return describeApiError(parseApiError(raw), { method, session: session.sessionName ?? '' });
}
