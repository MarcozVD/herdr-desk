// Estado efímero de la UI: qué está abierto, foco local (R11), toasts y menús
// contextuales. Las preferencias persistentes viven en settings.svelte.ts.

import { es } from '../i18n/es';
import { settings } from './settings.svelte';

export interface ToastMessage {
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'error';
}

export interface ContextMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  run: () => void | Promise<void>;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Exige escribir este texto para confirmar (borrados destructivos). */
  requireText?: string;
  danger?: boolean;
}

export interface PromptRequest {
  title: string;
  label: string;
  value?: string;
  placeholder?: string;
  hint?: string;
  submitLabel?: string;
  /** Devuelve el mensaje de error, o null si el valor es válido. */
  validate?: (value: string) => string | null;
}

export interface WorkspaceFormRequest {
  title: string;
  labelValue?: string;
  cwdValue?: string;
}

interface PendingConfirm extends ConfirmRequest {
  resolve: (value: boolean) => void;
}

interface PendingPrompt extends PromptRequest {
  resolve: (value: string | null) => void;
}

interface PendingWorkspaceForm extends WorkspaceFormRequest {
  resolve: (value: { label: string; cwd: string } | null) => void;
}

class UiStore {
  sidebarCollapsed = $state(settings.values.sidebar_start_collapsed);
  paletteOpen = $state(false);
  /** Sube en cada apertura: la paleta se monta de cero (consulta limpia). */
  paletteSession = $state(0);
  helpOpen = $state(false);
  sessionsOpen = $state(false);
  /** Modo prefix activo (T1.10). */
  prefixActive = $state(false);
  /** Chip con el último atajo resuelto, para feedback visual. */
  lastAction = $state<string | null>(null);

  /** Foco local: lo que la GUI considera enfocado (no toca herdr, R11). */
  localFocusedWorkspaceId = $state<string | null>(null);
  localFocusedTabId = $state<string | null>(null);
  localFocusedPaneId = $state<string | null>(null);
  /**
   * Último tab visitado de cada espacio. Al volver a un espacio se muestra el
   * que estabas viendo, no siempre el primero.
   */
  tabByWorkspace = $state<Record<string, string>>({});
  /** Historial de paneles para `last_pane` (T3.1 lo usará). */
  paneHistory = $state<string[]>([]);

  /** Visor de texto/JSON (transcript del agente, `agent.explain`…). */
  viewer = $state<{ title: string; text: string; kind: 'text' | 'json' } | null>(null);
  /** Panel al que se le va a mandar un prompt (T2.2). */
  agentPromptTarget = $state<{ paneId: string; name: string } | null>(null);
  /** Panel en el que se va a arrancar un agente (T2.3). */
  startAgentTarget = $state<{ paneId: string; name: string } | null>(null);

  toasts = $state<ToastMessage[]>([]);
  contextMenu = $state<ContextMenuState | null>(null);
  pendingConfirm = $state<PendingConfirm | null>(null);
  pendingPrompt = $state<PendingPrompt | null>(null);
  pendingWorkspaceForm = $state<PendingWorkspaceForm | null>(null);

  #toastId = 0;
  #toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  setSidebarCollapsed(value: boolean): void {
    this.sidebarCollapsed = value;
  }

  openPalette(): void {
    if (!this.paletteOpen) this.paletteSession += 1;
    this.paletteOpen = true;
  }

  closePalette(): void {
    this.paletteOpen = false;
  }

  togglePalette(): void {
    if (!this.paletteOpen) this.paletteSession += 1;
    this.paletteOpen = !this.paletteOpen;
  }

  toggleHelp(): void {
    this.helpOpen = !this.helpOpen;
  }

  openSessions(): void {
    this.sessionsOpen = true;
  }

  closeSessions(): void {
    this.sessionsOpen = false;
  }

  focusWorkspaceLocally(workspaceId: string): void {
    this.localFocusedWorkspaceId = workspaceId;
  }

  focusTabLocally(tabId: string | null, workspaceId?: string): void {
    this.localFocusedTabId = tabId;
    if (tabId && workspaceId)
      this.tabByWorkspace = { ...this.tabByWorkspace, [workspaceId]: tabId };
  }

  clearLocalTab(): void {
    this.localFocusedTabId = null;
  }

  /** Recuerda el tab de un espacio sin cambiar el foco (al pintar el árbol). */
  rememberTab(workspaceId: string, tabId: string): void {
    if (this.tabByWorkspace[workspaceId] === tabId) return;
    this.tabByWorkspace = { ...this.tabByWorkspace, [workspaceId]: tabId };
  }

  /**
   * Panel y tab a los que apuntan las acciones de la GUI. Manda el foco local,
   * pero SOLO si ese id sigue existiendo de verdad: un id viejo (o un tab
   * guardado por error como panel) no puede silenciar la acción; en ese caso se
   * usa el del servidor.
   */
  actionTarget(input: {
    server: { paneId: string | null; tabId: string | null; workspaceId: string | null };
    panes: readonly string[];
    tabs: readonly string[];
    workspaces: readonly string[];
  }): { paneId: string | null; tabId: string | null; workspaceId: string | null } {
    const pick = (local: string | null, known: readonly string[], fallback: string | null) =>
      local !== null && known.includes(local) ? local : fallback;
    return {
      paneId: pick(this.localFocusedPaneId, input.panes, input.server.paneId),
      tabId: pick(this.localFocusedTabId, input.tabs, input.server.tabId),
      workspaceId: pick(this.localFocusedWorkspaceId, input.workspaces, input.server.workspaceId),
    };
  }

  focusPaneLocally(paneId: string): void {
    if (this.localFocusedPaneId && this.localFocusedPaneId !== paneId) {
      this.paneHistory = [
        this.localFocusedPaneId,
        ...this.paneHistory.filter((id) => id !== paneId),
      ].slice(0, 20);
    }
    this.localFocusedPaneId = paneId;
  }

  lastPane(): string | null {
    return this.paneHistory.find((id) => id !== this.localFocusedPaneId) ?? null;
  }

  /**
   * Cambio de sesión: el foco local y el historial apuntan a panes y espacios de
   * la sesión anterior (ids que ya no existen). Se limpian para que el snapshot
   * nuevo marque el foco real, sin panes «activos» fantasma.
   */
  resetSessionState(): void {
    this.localFocusedWorkspaceId = null;
    this.localFocusedTabId = null;
    this.localFocusedPaneId = null;
    this.paneHistory = [];
    this.tabByWorkspace = {};
    // Un visor o un diálogo abiertos apuntan a la sesión vieja: se cierran.
    this.viewer = null;
    this.agentPromptTarget = null;
    this.startAgentTarget = null;
  }

  notify(text: string, kind: ToastMessage['kind'] = 'info'): void {
    const id = (this.#toastId += 1);
    this.toasts = [...this.toasts, { id, text, kind }];
    const timer = setTimeout(() => this.dismissToast(id), settings.values.toast_ms);
    this.#toastTimers.set(id, timer);
  }

  openViewer(view: { title: string; text: string; kind?: 'text' | 'json' }): void {
    this.viewer = { title: view.title, text: view.text, kind: view.kind ?? 'text' };
  }

  closeViewer(): void {
    this.viewer = null;
  }

  openAgentPrompt(paneId: string, name: string): void {
    this.agentPromptTarget = { paneId, name };
  }

  closeAgentPrompt(): void {
    this.agentPromptTarget = null;
  }

  openStartAgent(paneId: string, name: string): void {
    this.startAgentTarget = { paneId, name };
  }

  closeStartAgent(): void {
    this.startAgentTarget = null;
  }

  dismissToast(id: number): void {
    const timer = this.#toastTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#toastTimers.delete(id);
    }
    this.toasts = this.toasts.filter((toast) => toast.id !== id);
  }

  /** Confirmación con promesa (patrón del skill: un solo diálogo montado). */
  confirm(request: ConfirmRequest): Promise<boolean> {
    return new Promise((resolve) => {
      this.pendingConfirm = { ...request, resolve };
    });
  }

  resolveConfirm(value: boolean): void {
    const pending = this.pendingConfirm;
    this.pendingConfirm = null;
    pending?.resolve(value);
  }

  /** Petición de un solo campo (renombrar, nueva pestaña, nueva sesión). */
  prompt(request: PromptRequest): Promise<string | null> {
    return new Promise((resolve) => {
      this.pendingPrompt = { ...request, resolve };
    });
  }

  resolvePrompt(value: string | null): void {
    const pending = this.pendingPrompt;
    this.pendingPrompt = null;
    pending?.resolve(value);
  }

  /** Formulario de dos campos del alta de espacio (label + cwd). */
  workspaceForm(request: WorkspaceFormRequest): Promise<{ label: string; cwd: string } | null> {
    return new Promise((resolve) => {
      this.pendingWorkspaceForm = { ...request, resolve };
    });
  }

  resolveWorkspaceForm(value: { label: string; cwd: string } | null): void {
    const pending = this.pendingWorkspaceForm;
    this.pendingWorkspaceForm = null;
    pending?.resolve(value);
  }

  openContextMenu(state: ContextMenuState): void {
    this.contextMenu = state;
  }

  closeContextMenu(): void {
    this.contextMenu = null;
  }

  statusLabel(status: keyof typeof es.agentStatus): string {
    return es.agentStatus[status];
  }
}

export const ui = new UiStore();
