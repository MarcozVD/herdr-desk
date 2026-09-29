// Tipos locales del frontend: lo que NO viene del schema de herdr. Los tipos del
// protocolo son generados (types.gen.ts / methods.gen.ts) y se re-exportan aquí
// para que el resto del código tenga un único punto de importación.

export type {
  AgentInfo,
  AgentStatus,
  PaneInfo,
  PaneLayoutPane,
  PaneLayoutRect,
  PaneLayoutSnapshot,
  PaneLayoutSplit,
  PaneScrollInfo,
  SessionSnapshot,
  TabInfo,
  WorkspaceInfo,
  WorkspaceWorktreeInfo,
} from './types.gen';

import type { SessionSnapshot } from './types.gen';

export type ConnectionState = 'connecting' | 'online' | 'offline';

/** `session list --json` del CLI (crates/herdr-core/src/cli.rs, CliSessionInfo). */
export interface SessionInfo {
  name: string;
  running: boolean;
  default: boolean;
  socket_path: string;
  session_dir: string;
}

/**
 * C1 — Compatibilidad cliente/servidor (crates/herdr-core/src/cli.rs,
 * `ServerCompat`). `private_protocol_compatible: false` = los bridges serán
 * rechazados: la UI muestra el banner de reinicio y no reintenta.
 */
export interface ServerCompat {
  running: boolean;
  server_version: string | null;
  client_version: string | null;
  private_protocol_compatible: boolean | null;
  restart_needed: boolean;
  server_protocol: number | null;
  client_protocol: number | null;
  server_binary_stale: boolean;
}

/** Respuesta de `session_connect` / `session_restart` (C1). */
export interface SessionConnected {
  session: string;
  compat: ServerCompat | null;
}

/** Mensaje que llega por el Channel de `store_subscribe`. */
export type StoreMessage =
  | { kind: 'snapshot'; snapshot: SessionSnapshot }
  | { kind: 'state'; state: ConnectionState }
  | { kind: 'unknown'; value: unknown };
