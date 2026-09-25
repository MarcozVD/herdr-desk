// T1.10 — Parser de la sintaxis de atajos de herdr.
//
// Acepta: `ctrl+b`, `prefix+shift+n`, `prefix+1..9`, nombres de puntuación
// (minus, comma, plus, backtick, …) y teclas especiales (enter, tab, esc, left,
// right, up, down, …). Los modificadores son ctrl/shift/alt/cmd/super/meta.

export interface KeyChord {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export interface ParsedBinding {
  /** Requiere haber pulsado antes la tecla de prefix. */
  prefix: boolean;
  chord: KeyChord;
}

const NAMED_KEYS: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  space: ' ',
  spacebar: ' ',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagup: 'PageUp',
  pagedown: 'PageDown',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  minus: '-',
  dash: '-',
  comma: ',',
  plus: '+',
  period: '.',
  dot: '.',
  slash: '/',
  backslash: '\\',
  backtick: '`',
  grave: '`',
  quote: "'",
  semicolon: ';',
  colon: ':',
  ampersand: '&',
  equals: '=',
  underscore: '_',
  exclamation: '!',
  question: '?',
};

export function normalizeKeyName(raw: string): string {
  const lower = raw.toLowerCase();
  if (NAMED_KEYS[lower]) return NAMED_KEYS[lower];
  if (raw.length === 1) return raw;
  if (/^f\d{1,2}$/i.test(raw)) return raw.toUpperCase();
  return raw;
}

/** Tecla física del evento → clave canónica (las letras en minúscula). */
export function normalizeEventKey(eventKey: string): { key: string; shiftConsumedByChar: boolean } {
  if (/^[A-Za-z]$/.test(eventKey))
    return { key: eventKey.toLowerCase(), shiftConsumedByChar: false };
  if (eventKey.length === 1) return { key: eventKey, shiftConsumedByChar: true };
  return { key: eventKey, shiftConsumedByChar: false };
}

export function chordId(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push('ctrl');
  if (chord.shift) parts.push('shift');
  if (chord.alt) parts.push('alt');
  if (chord.meta) parts.push('meta');
  parts.push(chord.key === ' ' ? 'space' : chord.key.toLowerCase());
  return parts.join('+');
}

export function parseChord(raw: string): KeyChord | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const chord: KeyChord = { key: '', ctrl: false, shift: false, alt: false, meta: false };
  const parts = trimmed.split('+');
  for (const partRaw of parts) {
    const part = partRaw.trim();
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') chord.ctrl = true;
    else if (lower === 'shift') chord.shift = true;
    else if (lower === 'alt' || lower === 'option') chord.alt = true;
    else if (lower === 'cmd' || lower === 'command' || lower === 'super' || lower === 'meta')
      chord.meta = true;
    else if (part.length > 0) chord.key = normalizeKeyName(part);
  }
  if (chord.key.length === 0) return null;
  return chord;
}

/** Parsea el valor de un binding: `prefix+c`, `ctrl+alt+n`, `prefix+1..9`. */
export function parseBinding(raw: string): ParsedBinding | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const prefix = /(^|\+)prefix(\+|$)/i.test(trimmed);
  const withoutPrefix = trimmed.replace(/(^|\+)prefix(\+|$)/i, (_match, before: string) =>
    before === '+' ? '+' : '',
  );
  const chord = parseChord(withoutPrefix.replace(/^\+/, ''));
  if (!chord) return null;
  return { prefix, chord };
}

/** Rango indexado: `prefix+1..9` → { prefix: true, key: '1'..'9' }.
 *  Un rango sin prefix ni modificador no vale: herdr siempre exige uno de los dos
 *  para no chocar con la escritura normal. */
export function parseIndexedRange(
  raw: string,
): { prefix: boolean; chord: KeyChord; from: number; to: number } | null {
  const match = raw.trim().match(/^(?:(prefix)\+)?(.*?)(\d)\.\.(\d)$/i);
  if (!match) return null;
  const [, prefixMark, modifiers = '', fromRaw, toRaw] = match;
  if (!prefixMark && modifiers.trim().length === 0) return null;
  const base = `${prefixMark ? 'prefix+' : ''}${modifiers}1`;
  const parsed = parseBinding(base);
  if (!parsed) return null;
  return {
    prefix: parsed.prefix,
    chord: parsed.chord,
    from: Number(fromRaw),
    to: Number(toRaw),
  };
}

export function chordFromEvent(event: KeyboardEvent): KeyChord {
  const { key, shiftConsumedByChar } = normalizeEventKey(event.key);
  return {
    key,
    ctrl: event.ctrlKey,
    shift: shiftConsumedByChar ? false : event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
  };
}

/** Etiqueta legible del atajo, para el cheatsheet y los menús. */
export function bindingLabel(raw: string, prefixKey: string): string {
  const parsed = parseBinding(raw);
  if (!parsed) return raw;
  const title = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
  const parts: string[] = [];
  if (parsed.prefix) parts.push(prefixKey.split('+').map(title).join(' + '));
  if (parsed.chord.ctrl) parts.push('Ctrl');
  if (parsed.chord.shift) parts.push('Shift');
  if (parsed.chord.alt) parts.push('Alt');
  if (parsed.chord.meta) parts.push('Meta');
  const key = parsed.chord.key;
  const pretty: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    Enter: 'Enter',
    Tab: 'Tab',
    ' ': 'Espacio',
    '-': '−',
  };
  parts.push(pretty[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  return parts.join(' + ');
}
