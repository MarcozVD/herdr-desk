// T2.2/T2.3 — Piezas puras de las acciones de agente: validación del nombre,
// opciones de espera, teclas normalizadas y la búsqueda del visor.
//
// Sin runas ni DOM: la lógica que se puede probar en vitest vive aquí y las
// pantallas (menú del panel, diálogos y visor) solo pintan.

import type { AgentInfo, AgentStatus } from '../herdr/types';

/** Validación del nombre de agente del plan: `[a-z][a-z0-9_-]{0,31}`. */
export const AGENT_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

/** Teclas que usa T2.2 (`esc` es el nombre canónico de Escape en herdr). */
export const AGENT_KEY = {
  escape: 'esc',
  interrupt: 'ctrl+c',
} as const;

export type AgentKeyName = (typeof AGENT_KEY)[keyof typeof AGENT_KEY];

/** Líneas que se piden al transcript del agente (como la TUI). */
export const TRANSCRIPT_LINES = 200;

/** Timeout por defecto de `agent.wait` (ms). */
export const DEFAULT_AGENT_WAIT_MS = 30_000;

/** Mínimo y máximo que acepta `agent.start` para `timeout_ms`. */
export const AGENT_START_TIMEOUT_MIN_MS = 3000;
export const AGENT_START_TIMEOUT_MAX_MS = 300_000;
export const DEFAULT_AGENT_START_TIMEOUT_MS = 30_000;

/** Estados a los que se puede esperar con `agent.wait` (los del plan). */
export const AGENT_WAIT_CHOICES: readonly AgentStatus[] = [
  'idle',
  'working',
  'blocked',
  'done',
  'unknown',
];

/** Error del nombre de agente en español, o `null` si vale. */
export function validateAgentName(value: string): string | null {
  const name = value.trim();
  if (name.length === 0) return 'Escribe un nombre.';
  if (!AGENT_NAME_PATTERN.test(name)) {
    return 'El nombre va en minúsculas: letras, números, «-» y «_» (máx. 32), empezando por letra.';
  }
  return null;
}

/** Timeout de `agent.start` acotado al rango que acepta el backend. */
export function clampAgentStartTimeout(value: number | null | undefined): number {
  const ms = Math.trunc(value ?? DEFAULT_AGENT_START_TIMEOUT_MS);
  if (!Number.isFinite(ms)) return DEFAULT_AGENT_START_TIMEOUT_MS;
  return Math.min(AGENT_START_TIMEOUT_MAX_MS, Math.max(AGENT_START_TIMEOUT_MIN_MS + 1, ms));
}

/** ¿El timeout es válido para `agent.start`? (`3000 < t ≤ 300000`). */
export function validAgentStartTimeout(value: number | null | undefined): boolean {
  const ms = Math.trunc(value ?? 0);
  return ms > AGENT_START_TIMEOUT_MIN_MS && ms <= AGENT_START_TIMEOUT_MAX_MS;
}

/** Nombre con el que arrancar un agente cuando el usuario no escribe ninguno. */
export function defaultAgentName(kind: string, taken: readonly string[]): string {
  // El nombre tiene que pasar la validación del plan: se sanea y se acota a 32.
  const base = (
    kind
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .replace(/^[^a-z]+/, '') || 'agente'
  ).slice(0, 32);
  if (!taken.includes(base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return base;
}

/**
 * Argumentos extra del arranque: separados por espacios, agrupando con comillas
 * (`--flag "valor con espacios"`) y sin comillas sueltas en el resultado.
 */
export function parseAgentArgs(text: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) args.push(current);
      current = '';
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (started) args.push(current);
  return args;
}

export interface ViewerSegment {
  text: string;
  hit: boolean;
}

/**
 * Parte un texto en segmentos para el visor: los tramos que coinciden con la
 * búsqueda van marcados. Búsqueda insensible a mayúsculas y sin expresiones
 * regulares (el usuario escribe texto, no patrones).
 */
export function splitByQuery(text: string, query: string): ViewerSegment[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [{ text, hit: false }];
  const haystack = text.toLowerCase();
  const segments: ViewerSegment[] = [];
  let index = 0;
  while (index < text.length) {
    const found = haystack.indexOf(needle, index);
    if (found < 0) {
      segments.push({ text: text.slice(index), hit: false });
      break;
    }
    if (found > index) segments.push({ text: text.slice(index, found), hit: false });
    segments.push({ text: text.slice(found, found + needle.length), hit: true });
    index = found + needle.length;
  }
  return segments;
}

/** Cuántas coincidencias hay (para el «N coincidencias» del visor). */
export function countMatches(text: string, query: string): number {
  return splitByQuery(text, query).filter((segment) => segment.hit).length;
}

/** JSON legible para el visor (`agent.explain`). */
export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Nombre visible del agente para los textos de las acciones. */
export function agentLabel(agent: AgentInfo): string {
  return agent.display_agent ?? agent.name ?? agent.agent ?? agent.pane_id;
}

/**
 * Agente que toca al pulsar el atajo de «N-ésimo agente»: el orden es el de
 * atención (`blocked > done > working > idle > unknown`), el mismo que la TUI
 * usa para `previous_agent` / `next_agent` / `focus_agent` (Anexo B del plan).
 * Índice 1-based; fuera de rango devuelve `null`.
 */
export function agentAtAttentionIndex(
  ordered: readonly AgentInfo[],
  index: number,
): AgentInfo | null {
  if (index < 1 || index > ordered.length) return null;
  return ordered[index - 1] ?? null;
}

/** Siguiente/anterior agente en la cola de atención, en ciclo. */
export function cycleAgent(
  ordered: readonly AgentInfo[],
  currentPaneId: string | null,
  step: 1 | -1,
): AgentInfo | null {
  if (ordered.length === 0) return null;
  const current = ordered.findIndex((agent) => agent.pane_id === currentPaneId);
  if (current < 0) return step > 0 ? (ordered[0] ?? null) : (ordered[ordered.length - 1] ?? null);
  const next = (current + step + ordered.length) % ordered.length;
  return ordered[next] ?? null;
}
