// T1.4 + T1.5 — Store de sesión con runas de Svelte 5.
//
// - El snapshot crudo se guarda con `$state.raw` (no se proxya el JSON de ~7 KB).
// - Las colecciones se reconciliar por id (`reconcileById`): los objetos que siguen
//   existiendo conservan su identidad y se mutan en sitio, así la UI no remonta.
// - La conexión tiene máquina de estados (connecting/online/offline) con reintento
//   y backoff exponencial 250 ms → 5 s. Al volver se resuscribe y se sube
//   `connectionEpoch`, que es la señal para que el pool de terminales reabra los
//   bridges visibles.

import {
  call,
  latencyP50,
  latencySamples,
  sessionCurrent,
  sessionStart,
  storeSubscribe,
} from '../herdr/client';
import { parseApiError } from '../herdr/errors';
import type { ApiError } from '../herdr/errors';
import type {
  AgentInfo,
  ConnectionState,
  PaneInfo,
  PaneLayoutSnapshot,
  SessionSnapshot,
  StoreMessage,
  TabInfo,
  WorkspaceInfo,
} from '../herdr/types';
import { reconcileById } from './reconcile';
import { sortAgentsByPriority } from './snapshot';

export const BACKOFF_BASE_MS = 250;
export const BACKOFF_MAX_MS = 5000;
/** Si el backend acepta la suscripción pero no manda snapshot en este plazo, se
 *  considera caído (el server cerró la conexión sin avisar). */
export const SNAPSHOT_TIMEOUT_MS = 2500;

export function backoffDelayMs(attempt: number): number {
  const raw = BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(BACKOFF_MAX_MS, raw);
}

class SessionStore {
  /** Snapshot crudo del backend (fuente de verdad del refresco). */
  snapshot = $state.raw<SessionSnapshot | null>(null);
  /** Colecciones reconciliadas en sitio. */
  workspaces = $state<WorkspaceInfo[]>([]);
  tabs = $state<TabInfo[]>([]);
  panes = $state<PaneInfo[]>([]);
  agents = $state<AgentInfo[]>([]);
  layouts = $state<PaneLayoutSnapshot[]>([]);

  connection = $state<ConnectionState>('connecting');
  lastError = $state<ApiError | null>(null);
  /** Intentos de reconexión fallidos seguidos. */
  retryAttempt = $state(0);
  /** ms hasta el próximo intento (para el contador de la UI), null si no hay. */
  nextRetryInMs = $state<number | null>(null);
  /** Sube en cada (re)conexión correcta: el pool reabre bridges al cambiar. */
  connectionEpoch = $state(0);

  version = $state<string | null>(null);
  protocol = $state<number | null>(null);
  sessionName = $state<string | null>(null);
  /** performance.now() del último mensaje aplicado: mide evento -> UI. */
  lastMessageAt = $state<number | null>(null);
  /** Sube con cada snapshot aplicado. */
  revision = $state(0);
  /** p50 de las últimas llamadas RPC. */
  rpcLatency = $state<number | null>(null);
  rpcSamples = $state(0);
  /** Última acción de reconexión, para mensajes de la UI. */
  startServerFailed = $state(false);

  focusedWorkspaceId = $state<string | null>(null);
  focusedTabId = $state<string | null>(null);
  focusedPaneId = $state<string | null>(null);

  focusedWorkspace = $derived<WorkspaceInfo | null>(
    this.workspaces.find((workspace) => workspace.workspace_id === this.focusedWorkspaceId) ?? null,
  );
  focusedTab = $derived<TabInfo | null>(
    this.tabs.find((tab) => tab.tab_id === this.focusedTabId) ?? null,
  );
  focusedPane = $derived<PaneInfo | null>(
    this.panes.find((pane) => pane.pane_id === this.focusedPaneId) ?? null,
  );
  tabsOfFocusedWorkspace = $derived<TabInfo[]>(
    this.tabs.filter((tab) => tab.workspace_id === this.focusedWorkspaceId),
  );
  panesOfFocusedTab = $derived<PaneInfo[]>(
    this.panes.filter((pane) => pane.tab_id === this.focusedTabId),
  );
  agentsByPriority = $derived<AgentInfo[]>(sortAgentsByPriority(this.agents));
  online = $derived(this.connection === 'online');

  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  #connecting = false;
  #stopped = false;

  async bootstrap(): Promise<void> {
    this.sessionName = await sessionCurrent();
    await this.connect();
    await this.ping();
  }

  /** (Re)suscribe al store y arma el watchdog del snapshot. */
  async connect(): Promise<void> {
    if (this.#connecting) return;
    this.#connecting = true;
    this.#clearRetry();
    this.connection = 'connecting';
    try {
      await storeSubscribe((message) => this.apply(message));
      this.retryAttempt = 0;
      this.nextRetryInMs = null;
      this.startServerFailed = false;
      this.#armSnapshotWatchdog();
      // Un ping por conexión: fija versión/protocolo y alimenta la p50 que
      // muestra la píldora de conexión.
      void this.ping();
    } catch (raw) {
      this.lastError = parseApiError(raw);
      this.connection = 'offline';
      this.scheduleRetry();
    } finally {
      this.#connecting = false;
    }
    this.refreshLatency();
  }

  /** ping: versión, protocolo y latencia del roundtrip por el IPC. */
  async ping(): Promise<boolean> {
    try {
      const result = await call('ping', {});
      if (result.type !== 'pong') return false;
      this.protocol = result.protocol;
      this.version = result.version;
      // El ping solo confirma que el IPC responde; la sesión se da por «en línea»
      // cuando llega un snapshot (sin datos la UI no sirve para nada).
      if (this.snapshot !== null) this.connection = 'online';
      this.refreshLatency();
      return true;
    } catch (raw) {
      this.lastError = parseApiError(raw);
      this.connection = 'offline';
      this.refreshLatency();
      return false;
    }
  }

  refreshLatency(): void {
    this.rpcLatency = latencyP50();
    this.rpcSamples = latencySamples();
  }

  /** Reintento con backoff (250 ms → 5 s). Se cancela al reconectar. */
  scheduleRetry(): void {
    if (this.#stopped) return;
    this.retryAttempt += 1;
    const delay = backoffDelayMs(this.retryAttempt);
    this.nextRetryInMs = delay;
    this.#clearRetry();
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.nextRetryInMs = null;
      void this.connect();
    }, delay);
  }

  /** «Iniciar servidor» (T1.5): pide al backend arrancar la sesión y reintenta. */
  async startServer(): Promise<boolean> {
    const name = this.sessionName ?? '';
    const started = name.length > 0 ? await sessionStart(name) : false;
    this.startServerFailed = !started;
    await this.connect();
    return started;
  }

  /** Cambia de sesión activa (T1.11): el backend decide y la UI reconecta. */
  async setSessionName(name: string): Promise<void> {
    this.sessionName = name;
  }

  /** R11: solo se llama cuando el usuario activa «Sincronizar foco con TUI». */
  async focusWorkspace(workspaceId: string): Promise<void> {
    await call('workspace.focus', { workspace_id: workspaceId });
  }

  async focusPane(paneId: string): Promise<void> {
    await call('pane.focus', { pane_id: paneId });
  }

  apply(message: StoreMessage): void {
    this.lastMessageAt = performance.now();
    switch (message.kind) {
      case 'snapshot':
        this.applySnapshot(message.snapshot);
        break;
      case 'state':
        this.connection = message.state;
        break;
      default:
        break;
    }
    this.refreshLatency();
  }

  /** Reconciliación por id de todas las colecciones del snapshot. */
  applySnapshot(snapshot: SessionSnapshot): void {
    this.#clearSnapshotWatchdog();
    this.snapshot = snapshot;
    this.workspaces = reconcileById({
      current: this.workspaces,
      next: snapshot.workspaces,
      key: (workspace) => workspace.workspace_id,
    }).items;
    this.tabs = reconcileById({
      current: this.tabs,
      next: snapshot.tabs,
      key: (tab) => tab.tab_id,
    }).items;
    this.panes = reconcileById({
      current: this.panes,
      next: snapshot.panes,
      key: (pane) => pane.pane_id,
    }).items;
    this.agents = reconcileById({
      current: this.agents,
      next: snapshot.agents,
      key: (agent) => agent.pane_id,
    }).items;
    this.layouts = reconcileById({
      current: this.layouts,
      next: snapshot.layouts,
      key: (layout) => layout.tab_id,
    }).items;

    this.focusedWorkspaceId = this.#resolveFocus(
      snapshot.focused_workspace_id,
      snapshot.workspaces.map((workspace) => workspace.workspace_id),
      snapshot.workspaces.find((workspace) => workspace.focused)?.workspace_id,
    );
    this.focusedTabId = this.#resolveFocus(
      snapshot.focused_tab_id,
      snapshot.tabs.map((tab) => tab.tab_id),
      snapshot.tabs.find((tab) => tab.focused)?.tab_id,
    );
    this.focusedPaneId = this.#resolveFocus(
      snapshot.focused_pane_id,
      snapshot.panes.map((pane) => pane.pane_id),
      snapshot.panes.find((pane) => pane.focused)?.pane_id,
    );

    if (this.connection !== 'online') {
      this.connection = 'online';
      this.connectionEpoch += 1;
    } else if (this.revision === 0) {
      this.connectionEpoch += 1;
    }
    this.protocol = snapshot.protocol;
    this.version = snapshot.version;
    this.revision += 1;
  }

  stop(): void {
    this.#stopped = true;
    this.#clearRetry();
    this.#clearSnapshotWatchdog();
  }

  reset(): void {
    this.stop();
    this.#stopped = false;
    this.snapshot = null;
    this.workspaces = [];
    this.tabs = [];
    this.panes = [];
    this.agents = [];
    this.layouts = [];
    this.connection = 'connecting';
    this.lastError = null;
    this.retryAttempt = 0;
    this.nextRetryInMs = null;
    this.connectionEpoch = 0;
    this.revision = 0;
    this.rpcLatency = null;
    this.rpcSamples = 0;
    this.focusedWorkspaceId = null;
    this.focusedTabId = null;
    this.focusedPaneId = null;
  }

  #resolveFocus(
    id: string | null | undefined,
    known: string[],
    fallback: string | undefined,
  ): string | null {
    if (id && known.includes(id)) return id;
    return fallback ?? null;
  }

  #armSnapshotWatchdog(): void {
    this.#clearSnapshotWatchdog();
    this.#snapshotTimer = setTimeout(() => {
      this.#snapshotTimer = null;
      if (this.connection === 'online' && this.revision > 0) return;
      this.connection = 'offline';
      this.scheduleRetry();
    }, SNAPSHOT_TIMEOUT_MS);
  }

  #clearSnapshotWatchdog(): void {
    if (this.#snapshotTimer !== null) {
      clearTimeout(this.#snapshotTimer);
      this.#snapshotTimer = null;
    }
  }

  #clearRetry(): void {
    if (this.#retryTimer !== null) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
      this.nextRetryInMs = null;
    }
  }
}

export const session = new SessionStore();
