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
  /**
   * Árbol por tab (`layout.export`), como el servidor real: cada tab tiene su
   * propio árbol. Tiene prioridad sobre `layoutTree`.
   */
  layoutTrees?: Record<string, unknown>;
  /** `session_start` falla: 'missing' (command inexistente) o un ApiError real. */
  sessionStartError?: 'missing' | { code: string; message: string };
  /** `session_current` no está registrado en el backend. */
  sessionCurrentMissing?: boolean;
  /** Respuesta del command `agent_kinds` (T2.3). */
  agentKinds?: { kinds: string[]; reason: string | null; cached: boolean };
  /** El PRIMER `terminal_open` de cada panel no manda frames (canal muerto). */
  staleBridgeFirstOpen?: boolean | null;
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

/** Motivos de cierre que significan «se cayó el servidor» (igual que el pool). */
const OUTAGE = /server is shut|shutting down|error de transporte|os error|connection refused/i;

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
function defaultResponse(method: string, config: HarnessConfig, params?: unknown): unknown {
  switch (method) {
    case 'ping':
      return {
        type: 'pong',
        version: '0.8.0-preview.test',
        protocol: 19,
        capabilities: { live_handoff: false, detached_server_daemon: false },
      };
    case 'layout.export': {
      const requested = (params as { tab_id?: string } | undefined)?.tab_id ?? 'w1:t1';
      const snapshot = (config.snapshot ?? {}) as {
        tabs?: Array<{ tab_id: string; workspace_id: string }>;
        layouts?: Array<{ tab_id: string; zoomed?: boolean }>;
      };
      const workspaceId =
        snapshot.tabs?.find((tab) => tab.tab_id === requested)?.workspace_id ?? 'w1';
      const zoomed = snapshot.layouts?.find((item) => item.tab_id === requested)?.zoomed ?? false;
      return {
        type: 'layout_export',
        layout: {
          workspace_id: workspaceId,
          tab_id: requested,
          zoomed,
          focused_pane_id: focusedPaneId(config.snapshot) ?? 'w1:p1',
          root: config.layoutTrees?.[requested] ??
            config.layoutTree ?? {
              type: 'pane',
              pane_id: focusedPaneId(config.snapshot) ?? 'w1:p1',
            },
        },
      };
    }
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
    case 'agent.start':
      return {
        type: 'agent_started',
        agent: {
          pane_id: String(
            (config.snapshot as { panes?: Array<{ pane_id: string }> })?.panes?.[0]?.pane_id ??
              'w1:p1',
          ),
          terminal_id: 'term_65c51d72380f41',
          workspace_id: 'w1',
          tab_id: 'w1:t1',
          focused: true,
          agent_status: 'working',
          revision: 0,
        },
        argv: ['claude'],
      };
    case 'agent.read':
      return {
        type: 'pane_read',
        read: {
          pane_id: 'w1:p1',
          workspace_id: 'w1',
          tab_id: 'w1:t1',
          revision: 0,
          source: 'recent_unwrapped',
          format: 'text',
          text: 'hola desde el transcript\n' + 'segunda linea del agente',
          truncated: false,
        },
      };
    case 'agent.explain':
      return {
        type: 'agent_explain',
        explain: { matched_rule: 'hd-bot', manifest_source: 'builtin', reason: 'nombre' },
      };
    case 'agent.wait':
      return {
        type: 'agent_info',
        agent: {
          pane_id: 'w1:p1',
          terminal_id: 'term_65c51d72380f41',
          workspace_id: 'w1',
          tab_id: 'w1:t1',
          focused: true,
          agent_status: 'idle',
          revision: 0,
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
  /**
   * Texto que el «servidor» tiene pintado en cada panel. Como el herdr real, se
   * reenvía ENTERO (`full`) al enganchar un bridge nuevo o al hacer resize: es lo
   * que repinta un panel cuya vista se acaba de montar.
   */
  const screens = new Map<string, string>();
  /**
   * Bridges cuyo canal está muerto (el servidor les manda frames pero a un canal
   * que ya nadie lee): no reciben NI el viewport inicial NI las respuestas a un
   * resize. Así se reproduce el bug real del canal viejo del backend.
   */
  const deadBridges = new Set<number>();
  let frameSeq = 0;
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

  /** Frame `full` con el texto que el server tiene pintado en ese panel. */
  function serverFrame(paneId: string): ArrayBuffer {
    frameSeq += 1;
    return buildFrame({
      seq: frameSeq,
      width: 80,
      height: 24,
      full: true,
      closed: false,
      payload: new TextEncoder().encode(screens.get(paneId) ?? ''),
    });
  }

  function paneOfChannel(channel: Channel<unknown>): string | undefined {
    for (const bridge of bridges.values()) {
      if (bridge.channel === channel) return bridge.paneId;
    }
    return undefined;
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
      // T2.4 — overlay del icono con el conteo de agentes bloqueados.
      case 'taskbar_overlay':
        return { count: payload.count ?? null, applied: true };
      // T2.3 — tipos de agente del CLI (el backend los saca de `agent start --help`).
      case 'agent_kinds':
        return (
          config.agentKinds ?? {
            kinds: ['claude', 'opencode', 'aider'],
            reason: null,
            cached: !payload.refresh,
          }
        );
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
      case 'session_current':
        if (config.sessionCurrentMissing) throw 'Command session_current not found';
        return config.sessionName ?? 'herdr-desk-dev';
      case 'session_start':
        if (config.sessionStartError === 'missing') throw 'Command session_start not found';
        if (config.sessionStartError) throw config.sessionStartError;
        return null;
      case 'session_connect':
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
        return defaultResponse(payload.method as string, config, payload.params);
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
        const paneId = String(payload.paneId);
        const previous = [...bridges.values()].filter((bridge) => bridge.paneId === paneId).length;
        bridges.set(id, { paneId, channel: payload.onFrame as Channel<unknown> });
        // Un panel cuya PRIMERA apertura no manda frames simula el canal muerto
        // que deja el backend al recargarse la webview (bug real medido).
        const stale = Boolean(config.staleBridgeFirstOpen) && previous === 0;
        if (stale) deadBridges.add(id);
        if (!stale) {
          // Al enganchar un bridge, el server manda el viewport completo: así un
          // panel cuya vista acaba de montarse se repinta entero.
          const frame = serverFrame(paneId);
          queueMicrotask(() => deliver(payload.onFrame as Channel<unknown>, frame));
        }
        if (config.terminalOpenDelayMs && config.terminalOpenDelayMs > 0) {
          return new Promise((resolve) =>
            setTimeout(() => resolve(id), config.terminalOpenDelayMs),
          );
        }
        return id;
      }
      case 'terminal_resize': {
        // El server rehace el viewport y manda un `full` (medido con la sonda
        // contra herdr real: resize -> frame full). Si el canal del bridge está
        // muerto, los frames se pierden, como en el bug real.
        const bridgeId = Number(payload.bridgeId);
        const bridge = bridges.get(bridgeId);
        if (bridge && !deadBridges.has(bridgeId)) {
          queueMicrotask(() => deliver(bridge.channel, serverFrame(bridge.paneId)));
        }
        return null;
      }
      case 'terminal_release': {
        // Suelta el bridge SIN matar el panel: el siguiente terminal_open
        // engancha uno nuevo (y recibe el viewport completo).
        const released = Number(payload.bridgeId);
        bridges.delete(released);
        deadBridges.delete(released);
        return null;
      }
      case 'terminal_close': {
        const closed = Number(payload.bridgeId);
        bridges.delete(closed);
        deadBridges.delete(closed);
        return null;
      }
      case 'ui_ready':
        return null;
      case 'gui_defaults':
        // Mismo payload que el backend (src-tauri/src/commands/system.rs).
        return {
          terminal_font_family: 'Cascadia Code',
          terminal_font_size_px: 13,
          terminal_line_height: 1,
        };
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
      const bytes = new Uint8Array(frame);
      // Un frame `full` deja el «viewport» del server con ese texto: al volver a
      // enganchar el bridge (o al hacer resize) se reenvía entero.
      if (bytes.length >= 16 && (bytes[12] & 1) === 1) {
        const target = paneId ?? paneOfChannel(channel);
        if (target) screens.set(target, new TextDecoder().decode(bytes.subarray(16)));
      }
      deliver(channel, frame);
    },
    pushClosed(reason: string, paneId?: string, seq = 0) {
      const channel = channelForPane(paneId);
      if (!channel) throw new Error(`sin bridge abierto${paneId ? ` para ${paneId}` : ''}`);
      // Caída del server: ese bridge ya no manda nada más (ni responde a un
      // resize). El pool tendrá que pedir uno nuevo pasado el grace.
      if (OUTAGE.test(reason)) {
        for (const [id, bridge] of bridges) {
          if (bridge.channel === channel) deadBridges.add(id);
        }
      }
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
