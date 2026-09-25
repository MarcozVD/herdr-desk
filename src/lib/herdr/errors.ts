// Mapeo de errores a español (Anexo C del plan). Acepta cualquier cosa que
// devuelva Tauri: `ApiError` de los commands, un string suelto o un Error.

import { es } from '../i18n/es';
import type { ApiError } from './types';

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

export function parseApiError(raw: unknown): ApiError {
  if (isApiError(raw)) return raw;
  if (raw instanceof Error) return { code: 'unknown', message: raw.message };
  if (typeof raw === 'string') return { code: 'unknown', message: raw };
  if (typeof raw === 'object' && raw !== null) {
    const message = (raw as { message?: unknown }).message;
    const code = (raw as { code?: unknown }).code;
    return {
      code: typeof code === 'string' ? code : 'unknown',
      message: typeof message === 'string' ? message : JSON.stringify(raw),
    };
  }
  return { code: 'unknown', message: String(raw) };
}

export interface ErrorContext {
  method?: string;
  session?: string;
  reason?: string;
}

function fill(template: string, values: Record<string, string | number | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ''));
}

/** Mensaje en español para la UI. Nunca devuelve el texto crudo salvo en `unknown`. */
export function describeApiError(raw: unknown, context: ErrorContext = {}): string {
  const error = parseApiError(raw);
  const values = {
    message: error.message,
    method: context.method ?? '',
    session: context.session ?? '',
    reason: context.reason ?? error.message,
  };
  switch (error.code) {
    case 'not_found':
      return es.errors.not_found;
    case 'invalid_params':
      return fill(es.errors.invalid_params, values);
    case 'agent_blocked':
      return es.errors.agent_blocked;
    case 'agent_prompt_stalled':
      return es.errors.agent_prompt_stalled;
    case 'stream_conflict':
      return es.errors.stream_conflict;
    case 'popup_not_open':
      return es.errors.popup_not_open;
    case 'transport':
      return fill(es.errors.transport, values);
    case 'timeout':
      return fill(es.errors.timeout, values);
    case 'bridge_closed':
    case 'bridge_exit':
      return fill(es.errors.bridge_closed, values);
    default:
      // Método desconocido o no soportado por esta versión de herdr: se muestra
      // `message` tal cual detrás del aviso (Anexo C).
      if (context.method && /unsupported|unknown_method|not_supported/i.test(error.code)) {
        return `${fill(es.errors.unsupported, { method: context.method })} (${error.message})`;
      }
      return fill(es.errors.unknown, values);
  }
}
