// Store de sesión (runas de Svelte 5). El snapshot se guarda con `$state.raw`:
// no se proxya un JSON de ~7 KB y la identidad se reemplaza entera por refresco
// coalescido del backend (el backend solo manda snapshots nuevos si cambiaron).

import { parseApiError } from '../herdr/errors';
import { herdrCall, ping as pingCall, sessionCurrent, storeSubscribe } from '../herdr/client';
import type { StoreMessage } from '../herdr/client';
import type {
  AgentInfo,
  ApiError,
  ConnectionState,
  PaneInfo,
  SessionSnapshot,
  WorkspaceInfo,
} from '../herdr/types';
import {
  agentsOf,
  focusedPaneIdOf,
  focusedPaneOf,
  focusedWorkspaceOf,
  sortAgentsByPriority,
  workspacesOf,
} from './snapshot';

class SessionStore {
  snapshot = $state.raw<SessionSnapshot | null>(null);
  connection = $state<ConnectionState>('connecting');
  lastError = $state<ApiError | null>(null);
  latencyMs = $state<number | null>(null);
  protocol = $state<number | null>(null);
  version = $state<string | null>(null);
  sessionName = $state<string | null>(null);
  /** performance.now() del último mensaje aplicado: mide evento -> UI. */
  lastMessageAt = $state<number | null>(null);
  /** Sube con cada snapshot aplicado (para tests y para el refresco de vistas). */
  revision = $state(0);

  workspaces = $derived<WorkspaceInfo[]>(workspacesOf(this.snapshot));
  agents = $derived<AgentInfo[]>(sortAgentsByPriority(agentsOf(this.snapshot)));
  focusedWorkspace = $derived<WorkspaceInfo | null>(focusedWorkspaceOf(this.snapshot));
  focusedPaneId = $derived<string | null>(focusedPaneIdOf(this.snapshot));
  focusedPane = $derived<PaneInfo | null>(focusedPaneOf(this.snapshot));

  async bootstrap(): Promise<void> {
    this.sessionName = await sessionCurrent();
    await this.connect();
    await this.ping();
  }

  async connect(): Promise<void> {
    this.connection = 'connecting';
    try {
      await storeSubscribe((message) => this.apply(message));
      if (this.connection === 'connecting') this.connection = 'online';
    } catch (raw) {
      this.lastError = parseApiError(raw);
      this.connection = 'offline';
    }
  }

  /** ping: versión y protocolo del server + latencia del roundtrip por el IPC. */
  async ping(): Promise<void> {
    const started = performance.now();
    try {
      const pong = await pingCall();
      this.latencyMs = Math.round((performance.now() - started) * 10) / 10;
      this.protocol = pong.protocol;
      this.version = pong.version;
      if (this.connection !== 'online') this.connection = 'online';
    } catch (raw) {
      this.lastError = parseApiError(raw);
      this.connection = 'offline';
    }
  }

  /** R11: solo se llama cuando el usuario activa «Sincronizar foco con TUI». */
  async focusWorkspace(workspaceId: string): Promise<void> {
    await herdrCall('workspace.focus', { workspace_id: workspaceId });
  }

  async focusPane(paneId: string): Promise<void> {
    await herdrCall('pane.focus', { pane_id: paneId });
  }

  apply(message: StoreMessage): void {
    this.lastMessageAt = performance.now();
    switch (message.kind) {
      case 'snapshot':
        this.snapshot = message.snapshot;
        this.connection = 'online';
        this.revision += 1;
        break;
      case 'state':
        this.connection = message.state;
        break;
      default:
        break;
    }
  }

  reset(): void {
    this.snapshot = null;
    this.connection = 'connecting';
    this.lastError = null;
    this.latencyMs = null;
    this.revision = 0;
  }
}

export const session = new SessionStore();
