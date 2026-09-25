// Arnés de pruebas e2e (solo dev). Usa el mockIPC real de @tauri-apps/api/mocks,
// así que los Channel y el protocolo de invoke son los de producción; encima se
// añaden utilidades para empujar snapshots, árboles de layout y frames desde
// Playwright.
//
// Se activa cuando la página define `window.__HD_HARNESS__` (lo hace
// tests/e2e/harness.ts con addInitScript) y main.ts lo importa en dev.

import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';

import type { Channel } from '@tauri-apps/api/core';

interface HarnessConfig {
  snapshot?: unknown;
  sessionName?: string | null;
  /** false para probar el estado «conectando» sin snapshot inicial. */
  autoSnapshot?: boolean;
  /** Retraso artificial de terminal_open, para probar el buffer de teclas. */
  terminalOpenDelayMs?: number;
  /** Árbol que devuelve layout.export (por defecto: un solo panel, el enfocado). */
  layoutTree?: unknown;
}

export interface RecordedCall {
  cmd: string;
  args: Record<string, unknown>;
}

export interface HarnessApi {
  calls: RecordedCall[];
  callsOf(cmd: string): RecordedCall[];
  callsOfMethod(method: string): RecordedCall[];
  reset(): void;
  pushSnapshot(snapshot: unknown): void;
  pushState(state: 'connecting' | 'online' | 'offline'): void;
  pushFrame(frame: ArrayBuffer, paneId?: string): void;
  pushClosed(reason: string, paneId?: string, seq?: number): void;
  hasBridge(paneId?: string): boolean;
  bridgeCount(): number;
  /** panes con bridge abierto ahora mismo. */
  openPanes(): string[];
  setLayoutTree(tree: unknown): void;
}

type Internals = {
  callbacks: Map<number, (data: { index: number; message: unknown }) => void>;
};

function buildFrame(options: {
  seq: number;
  width: number;
  height: number;
  full: boolean;
  closed: boolean;
  payload: Uint8Array;
}): ArrayBuffer {
  const buffer = new ArrayBuffer(16 + options.payload.length);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(options.seq), true);
  view.setUint16(8, options.width, true);
  view.setUint16(10, options.height, true);
  view.setUint8(12, (options.full ? 1 : 0) | (options.closed ? 2 : 0));
  new Uint8Array(buffer, 16).set(options.payload);
  return buffer;
}

function focusedPaneId(snapshot: unknown): string | null {
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const value = (snapshot as { focused_pane_id?: unknown }).focused_pane_id;
  return typeof value === 'string' ? value : null;
}

/** Respuestas mínimas con la forma que espera el cliente para cada método. */
function defaultResponse(method: string, config: HarnessConfig): unknown {
  switch (method) {
    case 'ping':
      return {
        type: 'pong',
        version: '0.8.0-preview.test',
        protocol: 19,
        capabilities: { live_handoff: false, detached_server_daemon: false },
      };
    case 'layout.export':
      return {
        type: 'layout_export',
        layout: {
          workspace_id: 'w1',
          tab_id: 'w1:t1',
          zoomed: false,
          focused_pane_id: focusedPaneId(config.snapshot) ?? 'w1:p1',
          root: config.layoutTree ?? {
            type: 'pane',
            pane_id: focusedPaneId(config.snapshot) ?? 'w1:p1',
          },
        },
      };
    case 'workspace.create':
      return {
        type: 'workspace_created',
        workspace: {
          workspace_id: 'w-new',
          number: 9,
          label: 'nuevo',
          focused: false,
          pane_count: 1,
          tab_count: 1,
          active_tab_id: 'w-new:t1',
          agent_status: 'unknown',
        },
      };
    case 'tab.create':
      return {
        type: 'tab_created',
        tab: {
          tab_id: 'w1:t9',
          workspace_id: 'w1',
          number: 9,
          label: '9',
          focused: false,
          pane_count: 1,
          agent_status: 'unknown',
        },
        root_pane: {
          pane_id: 'w1:p9',
          terminal_id: 'term_new',
          workspace_id: 'w1',
          tab_id: 'w1:t9',
          focused: false,
          agent_status: 'unknown',
          revision: 0,
        },
      };
    case 'pane.split':
      return {
        type: 'pane_info',
        pane: {
          pane_id: 'w1:p7',
          terminal_id: 'term_split',
          workspace_id: 'w1',
          tab_id: 'w1:t1',
          focused: false,
          agent_status: 'unknown',
          revision: 0,
        },
      };
    case 'pane.read':
      return {
        type: 'pane_read',
        read: {
          pane_id: 'w1:p1',
          workspace_id: 'w1',
          tab_id: 'w1:t1',
          revision: 0,
          source: 'recent_unwrapped',
          format: 'text',
          text: '',
          truncated: false,
        },
      };
    case 'workspace.list':
      return { type: 'workspace_list', workspaces: [] };
    case 'server.reload_config':
      return { type: 'config_reload', status: 'reloaded', diagnostics: [] };
    default:
      return { type: 'ok' };
  }
}

export function installHarness(): void {
  let config = (window.__HD_HARNESS__ ?? {}) as HarnessConfig;
  const calls: RecordedCall[] = [];
  const storeChannels = new Map<string, Channel<unknown>>();
  /** bridgeId → { paneId, channel } de los bridges abiertos. */
  const bridges = new Map<number, { paneId: string; channel: Channel<unknown> }>();
  const channelIndex = new Map<number, number>();
  let bridgeSeq = 1000;

  const internals = (): Internals => window.__TAURI_INTERNALS__ as unknown as Internals;

  function deliver(channel: Channel<unknown>, message: unknown): void {
    const id = (channel as unknown as { id: number }).id;
    const callback = internals().callbacks.get(id);
    if (!callback) return;
    const index = channelIndex.get(id) ?? 0;
    channelIndex.set(id, index + 1);
    callback({ index, message });
  }

  function storeChannel(): Channel<unknown> | undefined {
    return storeChannels.get('store');
  }

  function channelForPane(paneId?: string): Channel<unknown> | undefined {
    if (paneId !== undefined) {
      for (const bridge of bridges.values()) {
        if (bridge.paneId === paneId) return bridge.channel;
      }
      return undefined;
    }
    return bridges.values().next().value?.channel;
  }

  mockWindows('main');
  mockIPC((cmd, args) => {
    const payload = (args ?? {}) as Record<string, unknown>;
    calls.push({ cmd, args: payload });
    switch (cmd) {
      case 'session_current':
        return config.sessionName ?? 'herdr-desk-dev';
      case 'session_list':
        return {
          sessions: [
            {
              name: config.sessionName ?? 'herdr-desk-dev',
              running: true,
              default: false,
              socket_path: 'C:\\fake\\herdr-desk-dev\\herdr.sock',
              session_dir: 'C:\\fake\\herdr-desk-dev',
            },
            {
              name: 'default',
              running: true,
              default: true,
              socket_path: 'C:\\fake\\herdr.sock',
              session_dir: 'C:\\fake',
            },
            {
              name: 'hd-test-x',
              running: false,
              default: false,
              socket_path: 'C:\\fake\\hd-test-x\\herdr.sock',
              session_dir: 'C:\\fake\\hd-test-x',
            },
          ],
        };
      case 'session_connect':
      case 'session_start':
      case 'session_stop':
      case 'session_delete':
        return null;
      case 'plugin:clipboard-manager|read_text':
        return 'pegado';
      case 'plugin:clipboard-manager|write_text':
      case 'plugin:opener|open_url':
        return null;
      case 'events_forward':
        return null;
      case 'herdr_call':
        return defaultResponse(payload.method as string, config);
      case 'store_subscribe': {
        const channel = payload.onMsg as Channel<unknown>;
        storeChannels.set('store', channel);
        if (config.autoSnapshot !== false) {
          queueMicrotask(() => {
            deliver(
              channel,
              JSON.stringify({ type: 'session_snapshot', snapshot: config.snapshot ?? null }),
            );
          });
        }
        return null;
      }
      case 'terminal_open': {
        bridgeSeq += 1;
        const id = bridgeSeq;
        bridges.set(id, {
          paneId: String(payload.paneId),
          channel: payload.onFrame as Channel<unknown>,
        });
        if (config.terminalOpenDelayMs && config.terminalOpenDelayMs > 0) {
          return new Promise((resolve) =>
            setTimeout(() => resolve(id), config.terminalOpenDelayMs),
          );
        }
        return id;
      }
      case 'terminal_close': {
        bridges.delete(Number(payload.bridgeId));
        return null;
      }
      case 'ui_ready':
        return null;
      default:
        return null;
    }
  });

  const api: HarnessApi = {
    calls,
    callsOf(cmd: string) {
      return calls.filter((call) => call.cmd === cmd);
    },
    callsOfMethod(method: string) {
      return calls.filter(
        (call) => call.cmd === 'herdr_call' && (call.args as { method?: string }).method === method,
      );
    },
    reset() {
      calls.length = 0;
    },
    pushSnapshot(snapshot: unknown) {
      const channel = storeChannel();
      if (!channel) throw new Error('store_subscribe no se llamó todavía');
      deliver(channel, JSON.stringify({ type: 'session_snapshot', snapshot }));
    },
    pushState(state) {
      const channel = storeChannel();
      if (!channel) throw new Error('store_subscribe no se llamó todavía');
      deliver(channel, JSON.stringify({ state }));
    },
    pushFrame(frame: ArrayBuffer, paneId?: string) {
      const channel = channelForPane(paneId);
      if (!channel) throw new Error(`sin bridge abierto${paneId ? ` para ${paneId}` : ''}`);
      deliver(channel, frame);
    },
    pushClosed(reason: string, paneId?: string, seq = 0) {
      const channel = channelForPane(paneId);
      if (!channel) throw new Error(`sin bridge abierto${paneId ? ` para ${paneId}` : ''}`);
      deliver(
        channel,
        buildFrame({
          seq,
          width: 0,
          height: 0,
          full: false,
          closed: true,
          payload: new TextEncoder().encode(reason),
        }),
      );
    },
    hasBridge(paneId?: string) {
      return channelForPane(paneId) !== undefined;
    },
    bridgeCount() {
      return bridges.size;
    },
    openPanes() {
      return [...bridges.values()].map((bridge) => bridge.paneId);
    },
    setLayoutTree(tree: unknown) {
      config = { ...config, layoutTree: tree };
    },
  };

  window.__HD_TEST__ = api;
}

declare global {
  interface Window {
    __HD_TEST__?: HarnessApi;
    __TAURI_INTERNALS__?: unknown;
  }
}
