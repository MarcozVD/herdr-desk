// T3.5 — Contrato de datos de la configuración y utilidades TOML.
//
// Los tipos de payload espejan los structs Serialize del backend
// (src-tauri/src/commands/config.rs y gui_settings.rs). El formulario usa
// `config_default` en runtime y, si el command no está, la copia generada
// `settings.gen.ts` con el mismo contrato.

import type { SettingsKeySpec, SettingsSectionSpec, SettingsValueType } from './settings.gen';

export type { SettingsKeySpec, SettingsSectionSpec, SettingsValueType };

export interface ConfigDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

/** Clave del `--default-config` tal cual la serializa el backend. */
export interface ConfigDefaultKey {
  key: string;
  value: string | null;
  active: boolean;
  description: string;
}

export interface ConfigDefaultSection {
  path: string;
  table_array: boolean;
  description: string;
  keys: ConfigDefaultKey[];
}

export interface ConfigDefaultPayload {
  sections: ConfigDefaultSection[];
}

/** Clave activa de config.toml con su origen. */
export interface ConfigEntry {
  path: string;
  value: string;
  origin: 'file' | 'default';
  description: string | null;
  in_defaults: boolean;
}

export interface ConfigRead {
  path: string;
  exists: boolean;
  diagnostics: ConfigDiagnostic[];
  entries: ConfigEntry[];
}

export interface ConfigChange {
  path: string;
  /** Valor en TOML; `null` quita la clave (vuelve al default del server). */
  value: string | null;
}

export interface ConfigReloadOutcome {
  status: string;
  diagnostics: string[];
  skipped: boolean;
  error: string | null;
}

export interface ConfigWriteResult {
  applied: number;
  rejected: boolean;
  backup: string | null;
  reload: ConfigReloadOutcome | null;
  rolled_back: boolean;
  diagnostics: ConfigDiagnostic[];
}

export interface ConfigResetKeyResult {
  output: { exit_code: number; stdout: string; stderr: string };
  reload: ConfigReloadOutcome | null;
}

/** Los ajustes de la GUI son un objeto JSON plano (clave → valor). */
export type GuiSettingsValues = Record<string, unknown>;

export interface GuiSettingsWrite {
  path: string;
  written: number;
}

/**
 * `herdr config check` sale en texto (sin --json). El backend classifya
 * parse_error → error (bloquea) y unknown_* → warning (el server lo ignora).
 */
export function hasBlockingError(diagnostics: readonly ConfigDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

/** El command pudo faltar (backend viejo): degrada a la copia generada. */
export function payloadToSections(payload: ConfigDefaultPayload): SettingsSectionSpec[] {
  return payload.sections.map((section) => ({
    path: section.path,
    tableArray: section.table_array,
    description: section.description,
    keys: section.keys.map((key) => ({
      key: key.key,
      value: key.value,
      active: key.active,
      type: inferTomlType(key.value),
      description: key.description,
    })),
  }));
}

/** Tipo del valor TOML para elegir el editor del formulario. */
export function inferTomlType(value: string | null): SettingsValueType {
  if (value === null) return 'toml';
  const text = value.trim();
  if (text.startsWith('"') || text.startsWith("'")) return 'string';
  if (text === 'true' || text === 'false') return 'boolean';
  if (/^-?\d+$/.test(text)) return 'integer';
  if (/^-?\d+\.\d+([eE][+-]?\d+)?$/.test(text)) return 'float';
  if (text.startsWith('[')) return 'array';
  return 'toml';
}

const INT_RE = /^-?\d+$/;
const FLOAT_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * Valor TOML simple → JS. Strings (básicos y literales), números, booleanos y
 * arrays inline (JSON-compatible en la práctica; se reintenta normalizando
 * comillas simples). `null` = no interpretable (se edita en crudo).
 */
/**
 * Tabla inline TOML → JSON (`{ hd-bot = [["a"]] }` → `{"hd-bot":[["a"]]}`).
 * Suficiente para los valores de config que son tablas de arrays de strings.
 */
function tomlInlineTableToJson(text: string): string {
  let out = '';
  let i = 0;
  let inString: string | null = null;
  let escaped = false;
  while (i < text.length) {
    const c = text[i];
    if (inString !== null) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\' && inString === '"') escaped = true;
      else if (c === inString) inString = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '=') {
      out += ':';
      i += 1;
      continue;
    }
    if (c === '{') {
      out += '{';
      i += 1;
      while (text[i] === ' ') i += 1;
      let key = '';
      while (i < text.length && /[A-Za-z0-9_.-]/.test(text[i])) {
        key += text[i];
        i += 1;
      }
      if (key.length > 0) out += JSON.stringify(key);
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

export function parseTomlValue(
  raw: string,
): string | number | boolean | unknown[] | Record<string, unknown> | null {
  const text = raw.trim();
  if (text.length === 0) return null;
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try {
      return JSON.parse(text) as string;
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) {
    return text.slice(1, -1);
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (INT_RE.test(text) || FLOAT_RE.test(text)) return Number(text);
  if (text.startsWith('[')) {
    try {
      return JSON.parse(text) as unknown[];
    } catch {
      try {
        return JSON.parse(text.replace(/'/g, '"')) as unknown[];
      } catch {
        return null;
      }
    }
  }
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      try {
        return JSON.parse(tomlInlineTableToJson(text)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Serializa un escalar JS a TOML (para `config_write`). */
export function toTomlScalar(value: string | number | boolean): string {
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

/** Texto editable del formulario para un valor TOML, según su tipo. */
export function displayValue(type: SettingsValueType, tomlText: string | null): string {
  const raw = tomlText ?? '';
  const parsed = parseTomlValue(raw);
  switch (type) {
    case 'string':
      return typeof parsed === 'string' ? parsed : raw.replace(/^["']|["']$/g, '');
    case 'boolean':
      return parsed === true ? 'true' : parsed === false ? 'false' : '';
    case 'integer':
    case 'float':
      return typeof parsed === 'number' ? String(parsed) : raw;
    default:
      return raw;
  }
}

/**
 * Texto del formulario → valor TOML para `config_write`.
 * Un input vacío en números/arrays quita la clave (`null` = vuelve al default);
 * los strings vacíos sí se escriben (`""`).
 */
export function serializeValue(type: SettingsValueType, input: string): string | null {
  const text = input.trim();
  switch (type) {
    case 'string':
      return toTomlScalar(input);
    case 'boolean':
      return text === 'true' ? 'true' : text === 'false' ? 'false' : null;
    case 'integer':
    case 'float':
      return text.length === 0 ? null : text;
    default:
      return text.length === 0 ? null : input;
  }
}

/** Secciones donde la app solo lee (p. ej. `remote`): no se ofrecen editores. */
export function isReadOnlySection(path: string): boolean {
  const head = path.split('.')[0];
  return head === 'remote';
}

/** Ruta completa de una clave de una sección. */
export function sectionKeyPath(sectionPath: string, key: string): string {
  return sectionPath.length === 0 ? key : `${sectionPath}.${key}`;
}

/**
 * Quita claves repetidas por ruta completa (defensa: una entrada mal formada
 * del codegen rompería el `{#each}` con clave del formulario).
 */
export function dedupeSections(sections: readonly SettingsSectionSpec[]): SettingsSectionSpec[] {
  return sections.map((section) => {
    const seen = new Set<string>();
    const keys = section.keys.filter((key) => {
      const path = sectionKeyPath(section.path, key.key);
      if (seen.has(path)) return false;
      seen.add(path);
      return true;
    });
    return keys.length === section.keys.length ? section : { ...section, keys };
  });
}

/** Índice path → entrada de `config_read` para pintar valores efectivos. */
export function entriesByPath(entries: readonly ConfigEntry[]): Map<string, ConfigEntry> {
  return new Map(entries.map((entry) => [entry.path, entry]));
}
