// Tipografía de la terminal: xterm NO resuelve variables CSS, así que el antiguo
// `fontFamily: 'var(--font-mono)'` caía en la fuente mono por defecto del WebView2
// (el token `--font-mono` nunca llegaba a la terminal). Aquí se resuelve una pila
// REAL de familias, con el command `gui_defaults` del backend como fuente
// preferente (la misma que usa la terminal de Windows: Cascadia Code, Cascadia
// Mono o Consolas) y un fallback local para que la app no se rompa si el command
// todavía no existe. La tipografía de la GUI (Geist) no se toca.

import { guiDefaults } from '../herdr/client';

/** Familias de la terminal de Windows, en orden de preferencia. */
export const TERMINAL_FAMILIES = ['Cascadia Code', 'Cascadia Mono', 'Consolas'] as const;
/** Último recurso: la mono por defecto del sistema. */
export const TERMINAL_GENERIC = 'monospace';
/** Tamaño por defecto si el backend no dice otra cosa. */
export const TERMINAL_FONT_SIZE = 13;
/** Interlineado por defecto (el mismo que el del backend: xterm usa 1.0). */
export const TERMINAL_LINE_HEIGHT = 1;

export interface TerminalFont {
  /** Pila CSS lista para xterm (con comillas donde hagan falta). */
  family: string;
  size: number;
  lineHeight: number;
  /** De dónde salió la familia: del backend (`gui_defaults`) o del fallback local. */
  source: 'backend' | 'local';
}

const GENERIC_FAMILIES = new Set([
  'monospace',
  'ui-monospace',
  'serif',
  'sans-serif',
  'cursive',
  'fantasy',
  'system-ui',
  'math',
  'emoji',
  'fangsong',
]);

/** Normaliza un nombre de familia: sin comillas de adorno y citado si lleva espacios. */
function quoteFamily(raw: string): string {
  const name = raw.trim().replace(/^['"]+|['"]+$/g, '');
  if (GENERIC_FAMILIES.has(name.toLowerCase())) return name.toLowerCase();
  return /^[A-Za-z0-9-]+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/**
 * Compone la pila CSS: primero la familia pedida (admite una pila ya compuesta,
 * separada por comas) y después los fallbacks locales, sin repetir ninguna.
 */
export function fontStack(family?: string | null): string {
  const parts: string[] = [];
  const push = (raw: string) => {
    const name = raw.trim();
    if (name.length === 0) return;
    const quoted = quoteFamily(name);
    const key = quoted.toLowerCase();
    if (parts.some((existing) => existing.toLowerCase() === key)) return;
    parts.push(quoted);
  };

  if (typeof family === 'string') {
    for (const part of family.split(',')) push(part);
  }
  for (const fallback of TERMINAL_FAMILIES) push(fallback);
  push(TERMINAL_GENERIC);
  return parts.join(', ');
}

/** Preset local: la pila de la terminal de Windows con el tamaño por defecto. */
export function localTerminalFont(): TerminalFont {
  return {
    family: fontStack(),
    size: TERMINAL_FONT_SIZE,
    lineHeight: TERMINAL_LINE_HEIGHT,
    source: 'local',
  };
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

function firstPositiveNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

/**
 * Interpreta el payload de `gui_defaults`. Tolerante a propósito: el contrato del
 * command aún no está congelado, así que acepta una cadena suelta (la familia) o
 * un objeto con los nombres habituales en snake_case o camelCase, e ignora los
 * valores que no tienen sentido. Devuelve `null` si no hay nada aprovechable.
 */
export function fontFromGuiDefaults(payload: unknown): TerminalFont | null {
  if (payload === null || payload === undefined || payload === '') return null;

  if (typeof payload === 'string') {
    const family = payload.trim();
    if (family.length === 0) return null;
    return {
      family: fontStack(family),
      size: TERMINAL_FONT_SIZE,
      lineHeight: TERMINAL_LINE_HEIGHT,
      source: 'backend',
    };
  }

  if (typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const family = firstString(record, [
    'terminal_font_family',
    'terminalFontFamily',
    'font_family',
    'fontFamily',
    'family',
  ]);
  const size = firstPositiveNumber(record, [
    // El backend publica `terminal_font_size_px`; se aceptan también las
    // variantes sin sufijo por si el contrato cambia.
    'terminal_font_size_px',
    'font_size_px',
    'terminal_font_size',
    'terminalFontSize',
    'font_size',
    'fontSize',
    'size',
  ]);
  const lineHeight = firstPositiveNumber(record, [
    'terminal_line_height',
    'terminalLineHeight',
    'line_height',
    'lineHeight',
  ]);
  if (family === null && size === null && lineHeight === null) return null;

  return {
    family: fontStack(family),
    size: size ?? TERMINAL_FONT_SIZE,
    lineHeight: lineHeight ?? TERMINAL_LINE_HEIGHT,
    source: 'backend',
  };
}

let current: TerminalFont = localTerminalFont();
const listeners = new Set<(font: TerminalFont) => void>();

/** Preset vigente (empieza en el fallback local). */
export function currentTerminalFont(): TerminalFont {
  return current;
}

/** Fija el preset y avisa a quien esté aplicándolo a instancias vivas. */
export function setTerminalFont(font: TerminalFont): void {
  current = font;
  for (const listener of listeners) listener(font);
}

export function subscribeTerminalFont(listener: (font: TerminalFont) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Pide la tipografía al backend (`gui_defaults`) y fija el resultado. Nunca
 * lanza: si el command no existe todavía o falla, se queda el fallback local.
 */
export async function loadTerminalFont(): Promise<TerminalFont> {
  let font = localTerminalFont();
  try {
    const outcome = await guiDefaults();
    if (outcome.ok) font = fontFromGuiDefaults(outcome.value) ?? font;
  } catch {
    // Sin puente IPC (tests, primer arranque) se usa el fallback local.
  }
  setTerminalFont(font);
  return font;
}

/** Opciones de xterm derivadas del preset (familia, tamaño e interlineado juntos). */
export function terminalOptions(font: TerminalFont = current): {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
} {
  return { fontFamily: font.family, fontSize: font.size, lineHeight: font.lineHeight };
}

/**
 * Espera a que el sistema tenga cargadas las fuentes reales. Las celdas de xterm
 * se miden con la fuente que esté disponible en ese momento: si la fuente llega
 * tarde, hay que volver a hacer `fit` para que no se descuadre la rejilla.
 */
export async function whenFontsReady(): Promise<void> {
  const fonts = (globalThis as { document?: { fonts?: { ready?: Promise<unknown> } } }).document
    ?.fonts;
  if (!fonts?.ready) return;
  try {
    await fonts.ready;
  } catch {
    // Sin FontFaceSet (jsdom): nada que esperar.
  }
}
