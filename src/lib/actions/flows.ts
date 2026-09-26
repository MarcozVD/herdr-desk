// T1.9 — Flujos de UI (diálogos + comandos) que usan la sidebar, la tab bar, los
// paneles y el motor de atajos. Cada flujo avisa por toast si herdr responde error.

import { es } from '../i18n/es';
import { paneApi, serverApi, tabApi, workspaceApi } from '../herdr/actions';
import { describeApiError, errorText, parseApiError } from '../herdr/errors';
import { findPane, neighborPane } from '../layout/tree';
import { session } from '../stores/session.svelte';
import { settings } from '../stores/settings.svelte';
import { ui } from '../stores/ui.svelte';
import { layout } from '../stores/layout.svelte';

export type PaneDirection = 'left' | 'right' | 'up' | 'down';

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

  focusWorkspace(workspaceId: string): void {
    // R11: foco local por defecto; con «Sincronizar foco con TUI» además se pide a herdr.
    ui.focusWorkspaceLocally(workspaceId);
    const firstTab = session.tabs.find((tab) => tab.workspace_id === workspaceId);
    if (firstTab) ui.focusPaneLocally(firstTab.tab_id);
    if (settings.values.sync_focus_with_tui)
      void workspaceApi.focus(workspaceId).catch(() => undefined);
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
    const target = paneId ?? session.focusedPaneId;
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
    ui.focusPaneLocally(paneId);
    if (settings.values.sync_focus_with_tui) void paneApi.focus(paneId).catch(() => undefined);
  },

  async focusPaneDirection(direction: PaneDirection): Promise<void> {
    if (settings.values.sync_focus_with_tui) {
      try {
        await paneApi.focusDirection(direction, session.focusedPaneId);
        return;
      } catch (raw) {
        fail(raw, 'pane.focus_direction');
        return;
      }
    }
    const current = session.focusedPaneId;
    if (!current) return;
    const neighbor = neighborPane(layout.tree, current, direction);
    if (neighbor?.paneId) ui.focusPaneLocally(neighbor.paneId);
  },

  /** Orden de lectura del árbol (cycle_pane_next/previous, T3.1 los usará). */
  cyclePane(delta: number): void {
    const panes = (layout.tree ? findPane(layout.tree, '') : null) ?? null;
    void panes;
    const ids = session.panesOfFocusedTab.map((pane) => pane.pane_id);
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

  openPaneMenu(event: MouseEvent, paneId: string): void {
    // Sin esto el WebView2 abriría su propio menú encima del nuestro.
    event.preventDefault();
    ui.openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
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
