// Arnés de pruebas e2e (solo dev). Usa el mockIPC real de @tauri-apps/api/mocks,
// así que los Channel y el protocolo de invoke son los de producción; encima se
// añaden utilidades para empujar snapshots y frames desde Playwright.
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
}

export interface RecordedCall {
  cmd: string;
  args: Record<string, unknown>;
}

export interface HarnessApi {
  calls: RecordedCall[];
  callsOf(cmd: string): RecordedCall[];
  reset(): void;
  pushSnapshot(snapshot: unknown): void;
  pushState(state: 'connecting' | 'online' | 'offline'): void;
  pushFrame(frame: ArrayBuffer): void;
  pushClosed(reason: string, seq?: number): void;
  hasBridge(): boolean;
  bridgeCount(): number;
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

export function installHarness(): void {
  const config = (window.__HD_HARNESS__ ?? {}) as HarnessConfig;
  const calls: RecordedCall[] = [];
  const channels = new Map<string, Channel<unknown>>();
  const channelIndex = new Map<number, number>();
  let bridgeSeq = 1000;
  let bridgeOpen = false;

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
    return channels.get('store');
  }

  function terminalChannel(): Channel<unknown> | undefined {
    return channels.get('terminal');
  }

  mockWindows('main');
  mockIPC((cmd, args) => {
    const payload = (args ?? {}) as Record<string, unknown>;
    calls.push({ cmd, args: payload });
    switch (cmd) {
      case 'session_current':
        return config.sessionName ?? 'herdr-desk-dev';
      case 'herdr_call': {
        const method = payload.method as string | undefined;
        if (method === 'ping') {
          return {
            type: 'pong',
            version: '0.8.0-preview.test',
            protocol: 19,
            capabilities: { live_handoff: false, detached_server_daemon: false },
          };
        }
        return { type: 'ok' };
      }
      case 'store_subscribe': {
        const channel = payload.onMsg as Channel<unknown>;
        channels.set('store', channel);
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
        channels.set('terminal', payload.onFrame as Channel<unknown>);
        bridgeOpen = true;
        bridgeSeq += 1;
        const id = bridgeSeq;
        if (config.terminalOpenDelayMs && config.terminalOpenDelayMs > 0) {
          return new Promise((resolve) =>
            setTimeout(() => resolve(id), config.terminalOpenDelayMs),
          );
        }
        return id;
      }
      case 'terminal_close': {
        bridgeOpen = false;
        channels.delete('terminal');
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
    pushFrame(frame: ArrayBuffer) {
      const channel = terminalChannel();
      if (!channel) throw new Error('terminal_open no se llamó todavía');
      deliver(channel, frame);
    },
    pushClosed(reason: string, seq = 0) {
      const channel = terminalChannel();
      if (!channel) throw new Error('terminal_open no se llamó todavía');
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
    hasBridge() {
      return bridgeOpen && channels.has('terminal');
    },
    bridgeCount() {
      return bridgeOpen ? 1 : 0;
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
