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
 * Resultado de un command del §5. Distingue tres casos que antes se confundían
 * en un solo `false`:
 *   - `ok: true`            → el command existe y respondió (aunque devuelva null).
 *   - `kind: 'missing'`     → el backend instalado no registra ese command.
 *   - `kind: 'error'`       → el command existe y falló: se muestra SU mensaje.
 */
export type CommandOutcome<T> =
  { ok: true; value: T | null } | { ok: false; kind: 'missing' | 'error'; error: ApiError };

/**
 * Tauri rechaza con `Command <nombre> not found` (p. ej. «Command session_start
 * not found»), `Command not found` a secas o «…not allowed. Command not found»
 * para plugins. Cualquier otra cosa es un error real y se muestra su mensaje.
 */
const MISSING_COMMAND_PATTERN =
  /command(\s+\S+)?\s+not\s+found|command\s+not\s+allowed|plugin\s+not\s+found|unknown command/i;

/** Tauri rechaza con «Command not found» cuando el command no está registrado. */
export function classifyCommandError(raw: unknown): { kind: 'missing' | 'error'; error: ApiError } {
  if (typeof raw === 'string') {
    if (MISSING_COMMAND_PATTERN.test(raw)) {
      return { kind: 'missing', error: { code: 'missing_command', message: raw } };
    }
    // «invalid args `name` for command `x`»: contrato roto por el cliente.
    if (/^invalid args/i.test(raw)) {
      return { kind: 'error', error: { code: 'invalid_args', message: raw } };
    }
    return { kind: 'error', error: { code: 'unknown', message: raw } };
  }
  return { kind: 'error', error: parseApiError(raw) };
}

async function optionalCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<CommandOutcome<T>> {
  try {
    const value = (await invoke<T>(command, args)) ?? null;
    return { ok: true, value };
  } catch (raw) {
    return { ok: false, ...classifyCommandError(raw) };
  }
}

export async function sessionCurrent(): Promise<CommandOutcome<string>> {
  return optionalCommand<string>('session_current');
}

export async function sessionConnect(name: string): Promise<CommandOutcome<null>> {
  return optionalCommand<null>('session_connect', { name });
}

export async function sessionStart(name: string): Promise<CommandOutcome<null>> {
  return optionalCommand<null>('session_start', { name });
}

export async function sessionStop(name: string): Promise<CommandOutcome<null>> {
  return optionalCommand<null>('session_stop', { name });
}

export async function sessionDelete(name: string): Promise<CommandOutcome<null>> {
  return optionalCommand<null>('session_delete', { name });
}

/* ---- Barra de tareas (T2.4) ---- */

/** Overlay del icono en la barra de tareas con el conteo de bloqueados (o sin
 *  overlay con `null`). Command `taskbar_overlay` del backend. */
export async function taskbarOverlay(
  count: number | null,
): Promise<CommandOutcome<{ count: number | null; applied: boolean }>> {
  return optionalCommand('taskbar_overlay', { count });
}

/* ---- Agentes: tipos para el diálogo de arranque (T2.3) ---- */

/** Lo que devuelve el command `agent_kinds`: los tipos que acepta
 *  `herdr agent start` (leídos de su ayuda), el motivo cuando no hay lista y si
 *  venían de la caché del backend. */
export interface AgentKindsResult {
  kinds: string[];
  reason: string | null;
  cached: boolean;
}

/** Tipos de agente del CLI, con caché en el backend (`refresh` la salta). */
export async function agentKinds(refresh = false): Promise<CommandOutcome<AgentKindsResult>> {
  return optionalCommand<AgentKindsResult>('agent_kinds', { refresh });
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

/**
 * `terminal_release`: suelta el bridge SIN matar el panel (envía
 * `terminal.release` al server y deja el pane vivo). Es lo contrario de
 * `terminal_close`, que además cierra la sesión del panel y su proceso termina
 * con razón `user_close`.
 *
 * Devuelve `false` mientras el command no exista en el backend (está en camino):
 * así el pool puede degradar sin romper nada.
 */
export async function terminalRelease(bridgeId: number): Promise<boolean> {
  try {
    await invoke('terminal_release', { bridgeId });
    return true;
  } catch (raw) {
    const { kind } = classifyCommandError(raw);
    if (kind === 'missing') return false;
    throw raw;
  }
}

/** `ui_ready`: el frontend avisa del primer render y el backend hace window.show(). */
export async function uiReady(): Promise<void> {
  await invoke('ui_ready');
}

/**
 * `gui_defaults`: defaults de la GUI resueltos por el backend para esta máquina
 * (familia de la fuente de la terminal, tamaño por defecto…). Es un command en
 * curso: si aún no está registrado devuelve `kind: 'missing'` y el consumidor
 * aplica su fallback local (`lib/terminal/font.ts`). El payload se interpreta de
 * forma tolerante porque el contrato todavía no está congelado.
 */
export async function guiDefaults(): Promise<CommandOutcome<unknown>> {
  return optionalCommand<unknown>('gui_defaults');
}
