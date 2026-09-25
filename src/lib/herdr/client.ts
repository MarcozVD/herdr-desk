// Cliente del IPC de herdr-desk (§5 del plan). No habla con herdr directamente:
// todo pasa por los commands de src-tauri.

import { Channel, invoke } from '@tauri-apps/api/core';

import { parseApiError } from './errors';
import type {
  ApiError,
  PingResult,
  SessionSnapshot,
  SessionSnapshotEnvelope,
  ConnectionState,
} from './types';

/** Mensaje que llega por el Channel de `store_subscribe`. */
export type StoreMessage =
  | { kind: 'snapshot'; snapshot: SessionSnapshot }
  | { kind: 'state'; state: ConnectionState }
  | { kind: 'unknown'; value: unknown };

type RawStoreMessage = ArrayBuffer | Uint8Array | string | unknown;

function toText(raw: RawStoreMessage): string | null {
  if (typeof raw === 'string') return raw;
  if (raw instanceof ArrayBuffer) return new TextDecoder().decode(raw);
  if (raw instanceof Uint8Array) return new TextDecoder().decode(raw);
  return null;
}

function looksLikeSnapshot(value: unknown): value is SessionSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { workspaces?: unknown }).workspaces) &&
    Array.isArray((value as { panes?: unknown }).panes)
  );
}

/**
 * Normaliza lo que manda el backend. El contrato dice `Json(snapshot crudo) |
 * Json(estado)`; se toleran las dos formas (con y sin envoltorio `{type,
 * snapshot}`) para no romper si el backend elige una.
 */
export function normalizeStoreMessage(raw: RawStoreMessage): StoreMessage {
  let value: unknown = raw;
  const text = toText(raw);
  if (text !== null) {
    try {
      value = JSON.parse(text);
    } catch {
      return { kind: 'unknown', value: raw };
    }
  }
  if (typeof value === 'object' && value !== null) {
    const envelope = value as Partial<SessionSnapshotEnvelope> & { snapshot?: unknown };
    if (envelope.type === 'session_snapshot' && looksLikeSnapshot(envelope.snapshot)) {
      return { kind: 'snapshot', snapshot: envelope.snapshot };
    }
    if (looksLikeSnapshot(value)) return { kind: 'snapshot', snapshot: value };
    const state = (value as { state?: unknown }).state;
    if (state === 'connecting' || state === 'online' || state === 'offline') {
      return { kind: 'state', state };
    }
  }
  return { kind: 'unknown', value };
}

/** `herdr_call`: genérico, 0,3–0,5 ms contra el named pipe de herdr. */
export async function herdrCall<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  try {
    return (await invoke('herdr_call', { method, params })) as T;
  } catch (raw) {
    throw parseApiError(raw);
  }
}

export async function ping(): Promise<PingResult> {
  return herdrCall<PingResult>('ping');
}

/** Suscripción al store del backend (snapshot crudo + estado de conexión). */
export async function storeSubscribe(onMessage: (message: StoreMessage) => void): Promise<void> {
  const channel = new Channel<ArrayBuffer | string>();
  channel.onmessage = (raw) => onMessage(normalizeStoreMessage(raw));
  try {
    await invoke('store_subscribe', { onMsg: channel });
  } catch (raw) {
    throw parseApiError(raw);
  }
}

/**
 * Sesión activa del backend. El contrato §5 no expone un getter (`session_connect`
 * solo cambia de sesión), así que se intenta y si el command no existe se
 * devuelve null: la UI muestra «sesión» a secas. Anotado como hueco del §5.
 */
export async function sessionCurrent(): Promise<string | null> {
  try {
    const value = await invoke<string | null>('session_current');
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function isApiErrorLike(error: unknown): error is ApiError {
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}

/* ---- Terminal (bridges) ---- */

export async function terminalOpen(
  paneId: string,
  cols: number,
  rows: number,
  onFrame: (frame: ArrayBuffer) => void,
): Promise<number> {
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = (frame) => {
    if (frame instanceof ArrayBuffer) onFrame(frame);
    else if (ArrayBuffer.isView(frame)) {
      const view = frame as unknown as Uint8Array;
      onFrame(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer);
    } else if (typeof frame === 'string') {
      onFrame(new TextEncoder().encode(frame).buffer as ArrayBuffer);
    }
  };
  try {
    return await invoke<number>('terminal_open', { paneId, cols, rows, onFrame: channel });
  } catch (raw) {
    throw parseApiError(raw);
  }
}

export async function terminalInput(bridgeId: number, data: string): Promise<void> {
  await invoke('terminal_input', { bridgeId, data });
}

export async function terminalInputBytes(bridgeId: number, base64: string): Promise<void> {
  await invoke('terminal_input_bytes', { bridgeId, b64: base64 });
}

export async function terminalResize(bridgeId: number, cols: number, rows: number): Promise<void> {
  await invoke('terminal_resize', { bridgeId, cols, rows });
}

export async function terminalScroll(
  bridgeId: number,
  direction: 'up' | 'down',
  lines: number,
): Promise<void> {
  await invoke('terminal_scroll', { bridgeId, direction, lines });
}

export async function terminalClose(bridgeId: number): Promise<void> {
  await invoke('terminal_close', { bridgeId });
}

/** `ui_ready`: el frontend avisa del primer render y el backend hace window.show(). */
export async function uiReady(): Promise<void> {
  await invoke('ui_ready');
}
