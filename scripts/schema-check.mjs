#!/usr/bin/env node
// R6 — Guard de deriva del schema de herdr.
//
//   schema/herdr-api.schema.json + schema/VERSION  vs  `herdr api schema --json`
//
// Sale con codigo != 0 si el schema instalado difiere del commiteado, para que
// `pnpm schema:check` (y la puerta T4.7) detecten que herdr cambio el protocolo.
// No arranca ningun server: `api schema` solo imprime el schema empaquetado.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = resolve(root, 'schema/herdr-api.schema.json');
const versionPath = resolve(root, 'schema/VERSION');

/** Entorno del hijo sin las HERDR_* heredadas (D10 del plan). */
function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('HERDR_')) delete env[key];
  }
  return env;
}

function herdrBin() {
  return process.env.HERDR_BIN_PATH || 'herdr';
}

function herdr(args) {
  return execFileSync(herdrBin(), args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    env: childEnv(),
  });
}

/** JSON estable (claves ordenadas) para comparar sin depender del formato. */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fail(message) {
  console.error(`schema-check: ${message}`);
  process.exit(1);
}

let installed;
try {
  installed = JSON.parse(herdr(['api', 'schema', '--json']));
} catch (error) {
  fail(`no se pudo leer el schema instalado (${herdrBin()} api schema --json): ${error.message}`);
}

let committed;
try {
  committed = JSON.parse(readFileSync(schemaPath, 'utf-8'));
} catch (error) {
  fail(`no se pudo leer ${schemaPath}: ${error.message}`);
}

if (stable(installed) !== stable(committed)) {
  const fields = ['$schema', 'protocol', 'schema_version', 'title'];
  const diffs = fields.filter((f) => stable(installed[f]) !== stable(committed[f]));
  const methodsInstalled = (installed.schemas?.request?.oneOf ?? []).length;
  const methodsCommitted = (committed.schemas?.request?.oneOf ?? []).length;
  fail(
    [
      'el schema instalado NO coincide con schema/herdr-api.schema.json.',
      `  instalado: protocol=${installed.protocol} schema_version=${installed.schema_version} metodos=${methodsInstalled}`,
      `  commiteado: protocol=${committed.protocol} schema_version=${committed.schema_version} metodos=${methodsCommitted}`,
      diffs.length ? `  campos distintos: ${diffs.join(', ')}` : '  (los campos raiz coinciden; difieren los $defs)',
      '  Regenera con: herdr api schema --json --output schema/herdr-api.schema.json',
    ].join('\n'),
  );
}

let versionRaw;
try {
  versionRaw = readFileSync(versionPath, 'utf-8').trim();
} catch (error) {
  fail(`no se pudo leer ${versionPath}: ${error.message}`);
}

let cliVersion;
try {
  cliVersion = herdr(['--version']).trim().replace(/^herdr\s+/, '');
} catch (error) {
  fail(`no se pudo leer herdr --version: ${error.message}`);
}
const expectedVersion = `${cliVersion} protocol=${installed.protocol}`;
if (versionRaw !== expectedVersion) {
  fail(
    [
      `schema/VERSION no coincide con la CLI instalada.`,
      `  archivo:    ${versionRaw}`,
      `  instalado:  ${expectedVersion}`,
    ].join('\n'),
  );
}

const methods = (installed.schemas?.request?.oneOf ?? []).length;
console.log(
  `schema-check: OK · protocol=${installed.protocol} schema_version=${installed.schema_version} · ${methods} metodos · ${versionRaw}`,
);
