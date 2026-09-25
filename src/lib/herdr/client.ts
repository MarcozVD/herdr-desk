// Cliente del IPC de herdr-desk (§5 del plan) sobre los tipos generados del
// schema instalado. Nada de esto habla con herdr directamente: todo pasa por los
// commands de src-tauri.
//
//   call('pane.list', {})                       -> ResponseResult (unión)
//   callFor('ping', {}, 'pong')                 -> estrecha al tipo de respuesta
//   callFor('workspace.list', {}, 'workspace_list') -> Api.WorkspaceList

import { Channel, invoke } from '@tauri-apps/api/core';

import { parseApiError } from './errors';
import type { ApiError } from './errors';
import type {
  MethodName,
  MethodParams,
  ResponseByType,
  ResponseResult,
  ResponseTypeName,
} from './methods.gen';
import type * as Api from './types.gen';
import type { ConnectionState, SessionInfo, StoreMessage } from './types';

export type { Api };

/* ---- Latencia del RPC (píldora de conexión del titlebar, T1.6) ---- */

const LATENCY_WINDOW = 32;
const latencies: number[] = [];

/** Anota una llamada medida (ms). Ventana deslizante de 32 muestras. */
export function recordLatency(ms: number): void {
  latencies.push(ms);
  if (latencies.length > LATENCY_WINDOW) latencies.shift();
}

export function latencySamples(): number {
  return latencies.length;
}

/** p50 de las últimas llamadas, o null si todavía no hay muestras. */
export function latencyP50(): number | null {
  if (latencies.length === 0) return null;
  const sorted = [...latencies].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10;
}

export function resetLatency(): void {
  latencies.length = 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Genérico: `herdr_call(method, params)`, 0,3–0,5 ms contra el named pipe. */
export async function call<M extends MethodName>(
  method: M,
  params: MethodParams[M],
): Promise<ResponseResult> {
  const started = performance.now();
  try {
    return (await invoke('herdr_call', { method, params })) as ResponseResult;
  } catch (raw) {
    throw parseApiError(raw);
  } finally {
    recordLatency(performance.now() - started);
  }
}

/**
 * Igual que `call`, pero exige el `type` de la respuesta. Si herdr responde otra
 * cosa (por ejemplo `ok` cuando se esperaba `workspace_list`), lanza
 * `invalid_params` en vez de devolver un objeto con la forma equivocada.
 */
export async function callFor<M extends MethodName, T extends ResponseTypeName>(
  method: M,
  params: MethodParams[M],
  expected: T,
): Promise<ResponseByType[T]> {
  const result = await call(method, params);
  const actual = isRecord(result) ? (result as { type?: unknown }).type : undefined;
  if (actual !== expected) {
    const error: ApiError = {
      code: 'invalid_params',
      message: `respuesta inesperada de ${method}: ${String(actual)} (se esperaba ${expected})`,
    };
    throw error;
  }
  return result as ResponseByType[T];
}

/* ---- Store (snapshot + estado de conexión) ---- */

function toText(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (raw instanceof ArrayBuffer) return new TextDecoder().decode(raw);
  if (raw instanceof Uint8Array) return new TextDecoder().decode(raw);
  return null;
}

function looksLikeSnapshot(value: unknown): value is Api.SessionSnapshot {
  return (
    isRecord(value) &&
    Array.isArray((value as { workspaces?: unknown }).workspaces) &&
    Array.isArray((value as { panes?: unknown }).panes) &&
    typeof (value as { protocol?: unknown }).protocol === 'number'
  );
}

/**
 * Normaliza los mensajes de `store_subscribe`. El backend manda el snapshot crudo
 * del core (sin envoltorio `{type, snapshot}`); se toleran además el envoltorio y
 * los mensajes de estado para no romper si el backend cambia de forma.
 */
export function normalizeStoreMessage(raw: unknown): StoreMessage {
  let value: unknown = raw;
  const text = toText(raw);
  if (text !== null) {
    try {
      value = JSON.parse(text);
    } catch {
      return { kind: 'unknown', value: raw };
    }
  }
  if (isRecord(value)) {
    const envelope = value as { type?: unknown; snapshot?: unknown; state?: unknown };
    if (envelope.type === 'session_snapshot' && looksLikeSnapshot(envelope.snapshot)) {
      return { kind: 'snapshot', snapshot: envelope.snapshot };
    }
    if (looksLikeSnapshot(value)) return { kind: 'snapshot', snapshot: value };
    if (
      envelope.state === 'connecting' ||
      envelope.state === 'online' ||
      envelope.state === 'offline'
    ) {
      return { kind: 'state', state: envelope.state as ConnectionState };
    }
  }
  return { kind: 'unknown', value };
}

export async function storeSubscribe(onMessage: (message: StoreMessage) => void): Promise<void> {
  const channel = new Channel<ArrayBuffer | string>();
  channel.onmessage = (raw) => onMessage(normalizeStoreMessage(raw));
  try {
    await invoke('store_subscribe', { onMsg: channel });
  } catch (raw) {
    throw parseApiError(raw);
  }
}

/* ---- Sesiones ---- */

/** `session list --json` (CLI). El backend lo corre con CREATE_NO_WINDOW. */
export async function sessionList(): Promise<SessionInfo[]> {
  try {
    const result = await invoke<{ sessions?: SessionInfo[] } | null>('session_list');
    return result?.sessions ?? [];
  } catch (raw) {
    throw parseApiError(raw);
  }
}

/**
 * Commands del §5 que el backend todavía no expone (sesión activa, conectar,
 * arrancar, parar y borrar). Se intentan y devuelven null si el command no existe,
 * para que la UI lo muestre como «no disponible» en vez de romper. Hueco del §5
 * anotado en el informe de F1.
 */
/** Command del §5 que puede no existir todavía en el backend: devuelve ok=false
 *  en vez de reventar (y sin confundir «no existe» con «devolvió null»). */
async function optionalCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<{ ok: boolean; value: T | null }> {
  try {
    const value = (await invoke<T>(command, args)) ?? null;
    return { ok: true, value };
  } catch {
    return { ok: false, value: null };
  }
}

export async function sessionCurrent(): Promise<string | null> {
  const result = await optionalCommand<string | null>('session_current');
  return typeof result.value === 'string' && result.value.length > 0 ? result.value : null;
}

export async function sessionConnect(name: string): Promise<boolean> {
  return (await optionalCommand<null>('session_connect', { name })).ok;
}

export async function sessionStart(name: string): Promise<boolean> {
  return (await optionalCommand<null>('session_start', { name })).ok;
}

export async function sessionStop(name: string): Promise<boolean> {
  return (await optionalCommand<null>('session_stop', { name })).ok;
}

export async function sessionDelete(name: string): Promise<boolean> {
  return (await optionalCommand<null>('session_delete', { name })).ok;
}

/* ---- Terminal (bridges) ---- */

function toFrameBuffer(frame: unknown): ArrayBuffer | null {
  if (frame instanceof ArrayBuffer) return frame;
  if (ArrayBuffer.isView(frame)) {
    const view = frame as Uint8Array;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  }
  if (typeof frame === 'string') return new TextEncoder().encode(frame).buffer as ArrayBuffer;
  return null;
}

export async function terminalOpen(
  paneId: string,
  cols: number,
  rows: number,
  onFrame: (frame: ArrayBuffer) => void,
): Promise<number> {
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = (frame) => {
    const buffer = toFrameBuffer(frame);
    if (buffer) onFrame(buffer);
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
