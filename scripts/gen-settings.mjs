#!/usr/bin/env node
// T3.5 — Codegen de la configuracion por defecto de herdr.
//
//   `herdr --default-config`  ->  src/lib/settings/settings.gen.ts
//
// Parsea el TOML anotado (casi todo comentado) en secciones con claves, valor,
// tipo, `active` y descripcion; mismo contrato que `parse_default_config` del
// backend (src-tauri/src/commands/config.rs). El formulario de ajustes usa el
// command `config_default` en runtime; este archivo deja los tipos y una copia
// estatica (fallback y tests).
//
// Uso:
//   node scripts/gen-settings.mjs                      # lee herdr --default-config
//   node scripts/gen-settings.mjs --input <file.toml>  # fuente alternativa (tests)
//   node scripts/gen-settings.mjs --out <file.ts>

/**
 * @typedef {object} SettingsKeySpec
 * @property {string} key
 * @property {string | null} value
 * @property {boolean} active
 * @property {'string' | 'boolean' | 'integer' | 'float' | 'array' | 'toml'} type
 * @property {string} description
 *
 * @typedef {object} SettingsSectionSpec
 * @property {string} path
 * @property {boolean} tableArray
 * @property {string} description
 * @property {SettingsKeySpec[]} keys
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import prettier from 'prettier';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultOut = resolve(root, 'src/lib/settings/settings.gen.ts');

function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('HERDR_')) delete env[key];
  }
  return env;
}

/**
 * Separa `clave = valor` (tras quitar un `# ` inicial si lo hubiera).
 * @param {string} src
 * @returns {{ key: string, value: string } | null}
 */
function splitKv(src) {
  const text = src.trimStart();
  let end = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (/[A-Za-z0-9_-]/.test(c)) end = i + 1;
    else break;
  }
  if (end === 0) return null;
  const key = text.slice(0, end);
  const rest = text.slice(end).trimStart();
  if (!rest.startsWith('=')) return null;
  return { key, value: rest.slice(1).trimStart() };
}

/**
 * Separa un comentario final ` # ...` fuera de comillas. Devuelve [valor, comentario].
 * @param {string} value
 * @returns {[string, string]}
 */
function stripTrailingComment(value) {
  let inDouble = false;
  let inSingle = false;
  let escaped = false;
  let prevSpace = false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (escaped) {
      escaped = false;
    } else if (c === '\\' && inDouble) {
      escaped = true;
    } else if (c === '"' && inDouble) {
      inDouble = false;
    } else if (c === '"' && !inSingle) {
      inDouble = true;
    } else if (c === "'" && inSingle) {
      inSingle = false;
    } else if (c === "'" && !inDouble) {
      inSingle = true;
    } else if (c === '#' && !inDouble && !inSingle && prevSpace) {
      return [value.slice(0, i).trimEnd(), value.slice(i + 1).trim()];
    }
    prevSpace = /\s/.test(c);
  }
  return [value.trimEnd(), ''];
}

/**
 * Tipo inferido del valor TOML (orientativo para el formulario).
 * @param {string | null | undefined} value
 * @returns {'string' | 'boolean' | 'integer' | 'float' | 'array' | 'toml'}
 */
function inferType(value) {
  if (value === null || value === undefined) return 'toml';
  const v = value.trim();
  if (v.startsWith('"') || v.startsWith("'")) return 'string';
  if (v === 'true' || v === 'false') return 'boolean';
  if (/^-?\d+$/.test(v)) return 'integer';
  if (/^-?\d+\.\d+([eE][+-]?\d+)?$/.test(v)) return 'float';
  if (v.startsWith('[')) return 'array';
  return 'toml';
}

/**
 * Parsea la salida de `herdr --default-config`. Mismo contrato que el backend:
 * secciones (incluida la raiz con path ""), `table_array` para [[...]],
 * descripciones de los comentarios previos y comentario final, claves activas
 * (sin comentar) y comentadas, valor canonico o null.
 * @param {string} text
 * @returns {SettingsSectionSpec[]}
 */
export function parseDefaultConfig(text) {
  /** @type {SettingsSectionSpec[]} */
  const sections = [{ path: '', tableArray: false, description: '', keys: [] }];
  let current = 0;
  /** @type {string[]} */
  let pending = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trimStart();
    if (trimmed === '') {
      pending = [];
      continue;
    }
    // cabecera de seccion, activa o comentada
    const commented = trimmed.startsWith('#');
    const headerSrc = commented ? trimmed.replace(/^#\s*/, '') : trimmed;
    if (headerSrc.startsWith('[')) {
      const tableArray = headerSrc.startsWith('[[');
      const path = headerSrc.replace(/^\[+/, '').replace(/\]+$/, '').trim();
      sections.push({
        path,
        tableArray,
        description: pending.join('\n'),
        keys: [],
      });
      pending = [];
      current = sections.length - 1;
      continue;
    }
    // clave, activa o comentada
    const kv = splitKv(headerSrc);
    if (kv) {
      const [rawValue, trailing] = stripTrailingComment(kv.value);
      if (rawValue !== '') {
        let description = pending.join('\n');
        if (trailing) description = description ? `${description}\n${trailing}` : trailing;
        sections[current].keys.push({
          key: kv.key,
          value: rawValue,
          active: !commented,
          type: inferType(rawValue),
          description,
        });
        pending = [];
        continue;
      }
    }
    // prosa: descripcion pendiente para la proxima clave/seccion
    pending.push(commented ? trimmed.replace(/^#\s*/, '') : trimmed);
  }

  return sections.filter((section) => section.path !== '' || section.keys.length > 0);
}

/**
 * @param {string} version
 * @param {number} sections
 * @param {number} keys
 * @returns {string}
 */
function banner(version, sections, keys) {
  return [
    '/* eslint-disable */',
    '/**',
    ' * Configuracion por defecto de herdr — GENERADO por scripts/gen-settings.mjs.',
    ' * NO EDITAR A MANO. Regenerar: pnpm gen',
    ` * Origen: \`herdr --default-config\` (${version})`,
    ` * ${sections} secciones · ${keys} claves`,
    ' */',
  ].join('\n');
}

/**
 * @param {SettingsSectionSpec[]} sections
 * @returns {string}
 */
function serialize(sections) {
  /** @param {string} s */
  const q = (s) => JSON.stringify(s);
  const typeUnion = "export type SettingsValueType = 'string' | 'boolean' | 'integer' | 'float' | 'array' | 'toml';";
  const keyInterface = [
    'export interface SettingsKeySpec {',
    '  key: string;',
    '  value: string | null;',
    '  active: boolean;',
    '  type: SettingsValueType;',
    '  description: string;',
    '}',
  ].join('\n');
  const sectionInterface = [
    'export interface SettingsSectionSpec {',
    '  path: string;',
    '  tableArray: boolean;',
    '  description: string;',
    '  keys: SettingsKeySpec[];',
    '}',
  ].join('\n');
  const body = sections
    .map((section) => {
      const keys = section.keys
        .map(
          (key) =>
            `    { key: ${q(key.key)}, value: ${key.value === null ? 'null' : q(key.value)}, active: ${key.active}, type: ${q(key.type)}, description: ${q(key.description)} },`,
        )
        .join('\n');
      return [
        '  {',
        `    path: ${q(section.path)},`,
        `    tableArray: ${section.tableArray},`,
        `    description: ${q(section.description)},`,
        `    keys: [`,
        keys,
        '    ],',
        '  },',
      ]
        .filter((l) => l !== '')
        .join('\n');
    })
    .join('\n');
  return `${typeUnion}\n\n${keyInterface}\n\n${sectionInterface}\n\nexport const SETTINGS_SECTIONS: SettingsSectionSpec[] = [\n${body}\n];\n`;
}

/**
 * @param {string} code
 * @param {string} outPath
 * @returns {Promise<string>}
 */
async function format(code, outPath) {
  const config = (await prettier.resolveConfig(outPath)) ?? {};
  delete config.plugins;
  return prettier.format(code, { ...config, parser: 'typescript' });
}

/**
 * @param {string} name
 * @returns {string | undefined}
 */
function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const input = argValue('--input');
  const out = argValue('--out') ?? defaultOut;

  let text;
  let version = 'fuente alternativa';
  if (input) {
    text = readFileSync(resolve(root, input), 'utf-8');
  } else {
    const bin = process.env.HERDR_BIN_PATH || 'herdr';
    text = execFileSync(bin, ['--default-config'], {
      encoding: 'utf8',
      windowsHide: true,
      env: childEnv(),
    });
    try {
      version = execFileSync(bin, ['--version'], {
        encoding: 'utf8',
        windowsHide: true,
        env: childEnv(),
      })
        .trim()
        .replace(/^herdr\s+/, '');
    } catch {
      // sin version: el banner queda igualmente valido
    }
  }

  const sections = parseDefaultConfig(text);
  const keys = sections.reduce((total, section) => total + section.keys.length, 0);
  const code = await format(
    `${banner(version, sections.length, keys)}\n${serialize(sections)}`,
    out,
  );
  writeFileSync(out, code, 'utf-8');
  console.log(`gen-settings: ${sections.length} secciones, ${keys} claves, ${version}`);
  console.log(`  escrito: ${out}`);
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`gen-settings falló: ${error.message}`);
    process.exit(1);
  });
}
