#!/usr/bin/env node
// T1.2 — Codegen TS desde el schema instalado de herdr.
//
//   schema/herdr-api.schema.json  ->  src/lib/herdr/types.gen.ts
//                                     src/lib/herdr/methods.gen.ts
//
// Pasos:
//   1. Sube los `$defs` de los 5 schemas a un `definitions` raíz. Los defs con el
//      mismo nombre se deduplican comparando su JSON con los `$ref` normalizados a
//      nombre de def (si no, `PaneInfo` de `event` y de `success_response` parecen
//      distintos solo porque la ruta del `$ref` cambia). Si el contenido difiere de
//      verdad, se le pone sufijo con el nombre del schema.
//   2. Reescribe todos los `$ref` (#/schemas/<S>/$defs/<N> -> #/definitions/<final>).
//   3. Crea un def sintético por cada variante de `ResponseResult` (`Response_<type>`),
//      para poder nombrar la unión y mapear `type` -> tipo.
//   4. Compila con json-schema-to-typescript y formatea con el prettier del repo, así
//      `pnpm format:check` no se queja del archivo generado.
//   5. Escribe `methods.gen.ts` con `MethodParams` (90 entradas), `MethodName` y
//      `ResponseByType` / `ResponseResult`.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from 'json-schema-to-typescript';
import prettier from 'prettier';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = resolve(root, 'schema/herdr-api.schema.json');
const versionPath = resolve(root, 'schema/VERSION');
const typesPath = resolve(root, 'src/lib/herdr/types.gen.ts');
const methodsPath = resolve(root, 'src/lib/herdr/methods.gen.ts');

const SCHEMA_ORDER = ['error_response', 'event', 'request', 'subscription_event', 'success_response'];
const REF_PREFIX = '#/schemas/';

const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
let schemaVersion = 'desconocida';
try {
  schemaVersion = readFileSync(versionPath, 'utf-8').trim();
} catch {
  // Sin schema/VERSION se sigue: el encabezado queda con lo que traiga el schema.
}

/** JSON estable para comparar defs. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      // Los $ref se comparan por nombre de def: dos defs que solo difieren en la
      // ruta del $ref son el mismo tipo.
      if (key === '$ref' && typeof value[key] === 'string') {
        out.$ref = `def:${value[key].split('/').pop()}`;
        continue;
      }
      out[key] = canonical(value[key]);
    }
    return out;
  }
  return value;
}

function canonicalKey(value) {
  return JSON.stringify(canonical(value));
}

function refName(ref) {
  return ref.split('/').pop();
}

/** 1+2: sube los defs y reescribe refs. */
function collectDefinitions() {
  /** @type {Map<string, { body: unknown, key: string }>} */
  const defs = new Map();
  /** @type {Map<string, string>}  `<schema>/<name>` -> nombre final */
  const mapping = new Map();
  const suffixed = [];

  const register = (schemaName, name, body) => {
    const key = canonicalKey(body);
    const existing = defs.get(name);
    let finalName = name;
    if (existing && existing.key !== key) {
      finalName = `${name}_${schemaName}`;
      let attempt = 2;
      while (defs.has(finalName) && defs.get(finalName).key !== key) {
        finalName = `${name}_${schemaName}${attempt}`;
        attempt += 1;
      }
      suffixed.push({ name, schema: schemaName, finalName });
    }
    if (!defs.has(finalName)) defs.set(finalName, { body, key });
    mapping.set(`${schemaName}/${name}`, finalName);
  };

  for (const schemaName of SCHEMA_ORDER) {
    const source = schema.schemas[schemaName];
    for (const [name, body] of Object.entries(source.$defs ?? {})) {
      register(schemaName, name, body);
    }
  }

  const resolveRef = (ref) => {
    if (!ref.startsWith(REF_PREFIX)) return ref;
    const [, , schemaName, , defName] = ref.split('/');
    const finalName = mapping.get(`${schemaName}/${defName}`);
    if (!finalName) throw new Error(`referencia sin destino: ${ref}`);
    return `#/definitions/${finalName}`;
  };

  const rewrite = (node) => {
    if (Array.isArray(node)) return node.map(rewrite);
    if (node && typeof node === 'object') {
      const out = {};
      for (const [key, value] of Object.entries(node)) {
        out[key] = key === '$ref' && typeof value === 'string' ? resolveRef(value) : rewrite(value);
      }
      return out;
    }
    return node;
  };

  for (const [name, entry] of defs) {
    defs.set(name, { body: rewrite(entry.body), key: entry.key });
  }

  return { defs, rewrite, suffixed };
}

/** json-schema-to-typescript nombra los tipos en PascalCase: el nombre sintético
 *  tiene que salir igual que el que emitirá el compilador. */
function pascalCase(value) {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');
}

/** 3: defs sintéticos por variante de ResponseResult. */
function responseVariants() {
  const responseResult = schema.schemas.success_response.$defs.ResponseResult;
  const variants = [];
  for (const variant of responseResult.oneOf ?? []) {
    const typeName = variant.properties?.type?.const;
    if (typeof typeName !== 'string') throw new Error('variante de ResponseResult sin `type`');
    const name = `Response${pascalCase(typeName)}`;
    variants.push({ typeName, name, body: variant });
  }
  return variants;
}

function methodEntries() {
  const entries = [];
  for (const alternative of schema.schemas.request.oneOf ?? []) {
    const method = alternative.properties?.method?.const;
    const params = alternative.properties?.params;
    if (typeof method !== 'string') throw new Error('método sin const');
    const ref = params?.$ref;
    if (typeof ref !== 'string') throw new Error(`método ${method} sin $ref de params`);
    entries.push({ method, paramsRef: ref });
  }
  return entries;
}

function banner(title, extra = '') {
  return [
    `/* eslint-disable */`,
    `/**`,
    ` * ${title} — GENERADO por scripts/gen-types.mjs. NO EDITAR A MANO.`,
    ` * Origen: schema/herdr-api.schema.json (${schemaVersion})`,
    ` * Regenerar: pnpm gen  (o: node scripts/gen-types.mjs)`,
    extra,
    ` */`,
  ].join('\n');
}

async function format(code) {
  const config = (await prettier.resolveConfig(typesPath)) ?? {};
  delete config.plugins;
  return prettier.format(code, { ...config, parser: 'typescript' });
}

async function main() {
  const { defs, rewrite, suffixed } = collectDefinitions();
  const variants = responseVariants();
  const methods = methodEntries();

  for (const variant of variants) {
    if (defs.has(variant.name)) {
      throw new Error(`nombre sintético repetido: ${variant.name}`);
    }
    defs.set(variant.name, { body: rewrite(variant.body), key: variant.name });
  }

  const definitions = {};
  for (const name of [...defs.keys()].sort()) {
    definitions[name] = defs.get(name).body;
  }

  const rootSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'HerdrApiSchema',
    type: 'object',
    additionalProperties: false,
    definitions,
    properties: Object.fromEntries(
      Object.keys(definitions).map((name) => [name, { $ref: `#/definitions/${name}` }]),
    ),
  };

  const raw = await compile(rootSchema, 'HerdrApiSchema', {
    bannerComment: '',
    additionalProperties: false,
    declareExternallyReferenced: true,
    enableConstEnums: true,
    format: false,
    ignoreMinAndMaxItems: true,
    unknownAny: true,
  });

  const typesCode = await format(
    `${banner('Tipos del API de herdr', ' * Métodos y params: src/lib/herdr/methods.gen.ts')}\n${raw.replace(/\n+$/, '')}\n`,
  );
  writeFileSync(typesPath, typesCode, 'utf-8');

  const methodLines = methods
    .map(({ method, paramsRef }) => `  '${method}': Api.${paramsRef.split('/').pop()};`)
    .join('\n');
  const methodNameLines = methods.map(({ method }) => `  '${method}',`).join('\n');
  const responseLines = variants.map(({ typeName, name }) => `  ${typeName}: Api.${name};`).join('\n');
  const responseNameLines = variants.map(({ typeName }) => `  '${typeName}',`).join('\n');
  const union = variants.map((variant) => `Api.${variant.name}`).join('\n  | ');

  const methodsCode = await format(`${banner(
    'Métodos y respuestas del API de herdr',
    [
      ` * ${methods.length} métodos · ${variants.length} tipos de respuesta`,
      ` * Los tipos referenciados viven en src/lib/herdr/types.gen.ts (se re-exportan aquí).`,
    ].join('\n'),
  )}
import type * as Api from './types.gen';

export * from './types.gen';

/** Params de cada uno de los ${methods.length} métodos del API. */
export interface MethodParams {
${methodLines}
}

export type MethodName = keyof MethodParams;

/** Nombres de método en runtime (tests de cobertura, paleta y consola del API). */
export const METHOD_NAMES = [
${methodNameLines}
] as const satisfies readonly MethodName[];

/** Tipo de resultado según el campo \`type\` de la respuesta. */
export interface ResponseByType {
${responseLines}
}

export type ResponseTypeName = keyof ResponseByType;

/** Nombres de tipo de respuesta en runtime. */
export const RESPONSE_TYPE_NAMES = [
${responseNameLines}
] as const satisfies readonly ResponseTypeName[];

/** Unión de todas las respuestas posibles. */
export type ResponseResult =
  | ${union};

export type { Api };
`);

  writeFileSync(methodsPath, methodsCode, 'utf-8');

  const counts = {
    defs: Object.keys(definitions).length,
    sintéticos: variants.length,
    métodos: methods.length,
    conflictos: suffixed.length,
  };
  console.log(
    `gen-types: ${counts.métodos} métodos, ${counts.defs} defs (${counts.sintéticos} sintéticos), ${counts.conflictos} conflictos de nombre`,
  );
  for (const item of suffixed) {
    console.log(`  conflicto: ${item.name} (${item.schema}) -> ${item.finalName}`);
  }
  console.log(`  escrito: ${typesPath}`);
  console.log(`  escrito: ${methodsPath}`);
}

main().catch((error) => {
  console.error(`gen-types falló: ${error.message}`);
  process.exit(1);
});
