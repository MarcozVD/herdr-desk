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
import { isMissingTauriBridge } from '../herdr/errors';
import { es } from '../i18n/es';
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
/**
 * Cada cuánto se comprueba, mientras la sesión está «en línea», que el servidor
 * sigue respondiendo (un `ping` por el IPC). Es la ÚNICA señal fiable de caída
 * del server: un bridge de terminal que se cierra no es una caída.
 */
export const HEARTBEAT_MS = 5000;

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
  /**
   * Error real de la última acción de sesión («Iniciar servidor», conectar…).
   * Se muestra tal cual lo devolvió el backend.
   */
  startError = $state<ApiError | null>(null);
  /** Qué contestó el backend al pedirle la sesión activa (`session_current`). */
  sessionNameError = $state<ApiError | null>(null);

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
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Token de suscripción: sube en cada `connect()`. Los mensajes de un canal
   * anterior (sesión vieja) se descartan aunque lleguen tarde. El backend ya
   * rota la suscripción al cambiar de sesión; esto es la red de seguridad del
   * lado UI para que NUNCA haya dos canales alimentando el store.
   */
  #subToken = 0;
  #connecting = false;
  #stopped = false;

  async bootstrap(): Promise<void> {
    const current = await sessionCurrent();
    if (current.ok) {
      const name = typeof current.value === 'string' ? current.value.trim() : '';
      this.sessionName = name.length > 0 ? name : null;
      this.sessionNameError = null;
    } else {
      // El backend instalado no expone `session_current`: se sigue sin nombre y
      // «Iniciar servidor» pedirá elegir sesión en vez de mandar un nombre vacío.
      this.sessionName = null;
      this.sessionNameError = current.error;
    }
    await this.connect();
    await this.ping();
  }

  /**
   * Nombre con el que se arranca/conecta la sesión. Nunca devuelve cadena vacía:
   * si el bootstrap no lo trajo, se vuelve a preguntar al backend (§5
   * `session_current`) y, si tampoco hay, se pide elegir sesión en la UI.
   */
  async resolveSessionName(): Promise<string | null> {
    const known = this.sessionName?.trim() ?? '';
    if (known.length > 0) return known;
    const current = await sessionCurrent();
    const name = current.ok && typeof current.value === 'string' ? current.value.trim() : '';
    if (name.length === 0) return null;
    this.sessionName = name;
    this.sessionNameError = null;
    return name;
  }

  /** (Re)suscribe al store y arma el watchdog del snapshot. */
  async connect(): Promise<void> {
    if (this.#connecting) return;
    this.#connecting = true;
    this.#clearRetry();
    this.connection = 'connecting';
    // Token nuevo: lo que llegue por un canal anterior se ignora (cambio de
    // sesión). El canal viejo queda inerte aunque el backend tarde en cerrarlo.
    const token = (this.#subToken += 1);
    try {
      await storeSubscribe((message) => {
        if (token !== this.#subToken) return;
        this.apply(message);
      });
      this.retryAttempt = 0;
      this.nextRetryInMs = null;
      this.startServerFailed = false;
      this.#armSnapshotWatchdog();
      this.#armHeartbeat();
      // Un ping por conexión: fija versión/protocolo y alimenta la p50 que
      // muestra la píldora de conexión.
      void this.ping();
    } catch (raw) {
      // Fuera de Tauri (navegador suelto) el invoke no existe: se dice claro.
      this.#goOffline(
        isMissingTauriBridge(raw)
          ? { code: 'no_bridge', message: es.connection.noBridge }
          : parseApiError(raw),
      );
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
      if (this.snapshot !== null) {
        this.connection = 'online';
        this.#armHeartbeat();
      }
      this.refreshLatency();
      return true;
    } catch (raw) {
      // Primer aviso de que el server no está: el latido pasa por aquí.
      this.#goOffline(parseApiError(raw));
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

  /**
   * «Iniciar servidor» (T1.5): pide al backend arrancar la sesión y reintenta.
   * El error que se guarda es el REAL del backend (o el aviso de que el command
   * no existe), nunca un «no disponible» genérico.
   */
  async startServer(): Promise<boolean> {
    const name = await this.resolveSessionName();
    if (name === null) {
      this.startError = { code: 'no_session', message: es.connection.needSession };
      this.startServerFailed = true;
      return false;
    }
    const started = await sessionStart(name);
    if (!started.ok) {
      this.startError =
        started.kind === 'missing'
          ? {
              code: 'missing_command',
              message: es.connection.unavailable.replace('{command}', 'session_start'),
            }
          : started.error;
      this.startServerFailed = true;
      return false;
    }
    this.startError = null;
    this.startServerFailed = false;
    await this.connect();
    return true;
  }

  /** Guarda el error de una acción de sesión (para la franja de reconexión). */
  reportSessionError(error: ApiError | null): void {
    this.startError = error;
  }

  /**
   * Caída REAL de transporte (el servidor dejó de responder). NO se llama desde
   * el cierre de un bridge de terminal: cerrar una terminal —o que su PTY muera—
   * no es una caída del servidor, y tomarlo por tal tumbaba la app entera.
   * Las señales válidas de caída son: el store, el watchdog del snapshot y el
   * `ping` fallando (latido), todas por `#goOffline`.
   */
  noteOutage(reason: string): void {
    this.#goOffline({ code: 'transport', message: reason });
  }

  /**
   * Única puerta a «desconectado»: guarda el error, para el latido y programa el
   * reintento con backoff (el bucle ya existía; antes vivía duplicado en tres
   * sitios y uno de ellos era el cierre de un bridge).
   */
  #goOffline(error: ApiError, options: { retry?: boolean } = {}): void {
    this.#clearHeartbeat();
    if (this.connection === 'offline') return;
    this.connection = 'offline';
    this.lastError = error;
    if (options.retry === false || this.#stopped) return;
    this.retryAttempt = 0;
    this.scheduleRetry();
  }

  /** Latido: mientras estemos «en línea», un ping periódico confirma el server. */
  #armHeartbeat(): void {
    this.#clearHeartbeat();
    if (this.#stopped) return;
    this.#heartbeatTimer = setInterval(() => {
      if (this.connection !== 'online') return;
      void this.#heartbeatTick();
    }, HEARTBEAT_MS);
  }

  /**
   * Un latido: confirma que el server responde (ping) y, si el store no ha
   * empujado nada desde el latido anterior, pide el snapshot por RPC.
   *
   * El canal del store es la vía normal, pero solo empuja cuando el backend
   * refresca SU snapshot. Si eso no ocurre —el kick de la conexión de eventos
   * del backend se dispara al cerrarse la conexión, no en cada evento—, la UI se
   * quedaba CONGELADA: los splits y cierres hechos desde la propia GUI no se
   * veían reflejados (el panel nuevo no aparecía, el cerrado seguía en pantalla)
   * aunque la píldora dijera «en línea». Este catch-up la devuelve al estado
   * real, con un coste de ~1 ms y solo cuando no hay pushes.
   */
  async #heartbeatTick(): Promise<void> {
    const alive = await this.ping();
    if (!alive) return;
    if (this.#recent()) return;
    await this.refreshSnapshot();
  }

  /** ¿Hubo mensajes del store en el último intervalo del latido? */
  #recent(): boolean {
    if (this.lastMessageAt === null) return false;
    return performance.now() - this.lastMessageAt < HEARTBEAT_MS;
  }

  /**
   * Pide `session.snapshot` y aplica el resultado. Lo usan el latido (catch-up)
   * y las acciones de la GUI, que así se ven reflejadas de inmediato sin
   * depender de que el store empuje.
   */
  async refreshSnapshot(): Promise<void> {
    try {
      const result = await call('session.snapshot', {});
      if (result.type !== 'session_snapshot') return;
      this.applySnapshot(result.snapshot);
    } catch {
      // Sin ruido: el siguiente latido lo reintenta.
    }
  }

  #clearHeartbeat(): void {
    if (this.#heartbeatTimer !== null) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
  }

  /**
   * Cambio de sesión activa (T1.11): TODO el estado de la sesión anterior se
   * descarta ANTES de aplicar la nueva — snapshot, colecciones, foco, versión,
   * epoch y reintentos. Sin esto se veían los panes de la sesión vieja con
   * terminales en «desconectado» y los canales antiguos seguían mandando
   * mensajes. La suscripción vieja queda ignorada por el token de `connect`.
   */
  async switchTo(name: string): Promise<void> {
    this.sessionName = name;
    this.reset();
    await this.connect();
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
        // El store del backend también manda el estado de la conexión: es una de
        // las señales válidas de caída (junto al watchdog y al latido).
        if (message.state === 'offline') {
          this.#goOffline({ code: 'store', message: es.connection.offlineDetail });
        } else {
          this.connection = message.state;
          if (message.state === 'online') this.#armHeartbeat();
        }
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
    this.#armHeartbeat();
  }

  stop(): void {
    this.#stopped = true;
    this.#clearRetry();
    this.#clearSnapshotWatchdog();
    this.#clearHeartbeat();
  }

  reset(): void {
    this.stop();
    this.#stopped = false;
    // Invalida la suscripción anterior: lo que llegue por el canal viejo (sesión
    // anterior) se descarta aunque `connect()` tarde en re-suscribir.
    this.#subToken += 1;
    this.snapshot = null;
    this.workspaces = [];
    this.tabs = [];
    this.panes = [];
    this.agents = [];
    this.layouts = [];
    this.connection = 'connecting';
    this.lastError = null;
    this.startError = null;
    this.sessionNameError = null;
    this.retryAttempt = 0;
    this.nextRetryInMs = null;
    this.connectionEpoch = 0;
    this.revision = 0;
    this.rpcLatency = null;
    this.rpcSamples = 0;
    this.startServerFailed = false;
    this.version = null;
    this.protocol = null;
    this.lastMessageAt = null;
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
      this.#goOffline({ code: 'timeout', message: es.connection.offlineDetail });
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
