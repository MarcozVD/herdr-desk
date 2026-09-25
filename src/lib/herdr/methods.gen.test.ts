// T1.2: el codegen no puede quedarse atrás respecto al schema instalado. Si herdr
// añade o quita un método, este test falla y hay que regenerar (`pnpm gen`).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { METHOD_NAMES, RESPONSE_TYPE_NAMES } from './methods.gen';

const schemaPath = resolve(process.cwd(), 'schema/herdr-api.schema.json');
const typesPath = resolve(process.cwd(), 'src/lib/herdr/types.gen.ts');

interface RequestAlternative {
  properties?: {
    method?: { const?: string };
    params?: { $ref?: string };
  };
}

interface ResponseAlternative {
  properties?: {
    type?: { const?: string };
  };
}

interface HerdrSchema {
  protocol: number;
  schemas: Record<
    string,
    {
      $defs?: Record<string, unknown>;
      oneOf?: unknown[];
    }
  >;
}

const schema = JSON.parse(readFileSync(schemaPath, 'utf-8')) as HerdrSchema;
const typesSource = readFileSync(typesPath, 'utf-8');

const requestAlternatives = (schema.schemas.request?.oneOf ?? []) as RequestAlternative[];
const responseAlternatives = ((
  schema.schemas.success_response?.$defs?.ResponseResult as { oneOf?: unknown[] } | undefined
)?.oneOf ?? []) as ResponseAlternative[];

const schemaMethods = requestAlternatives.map(
  (alternative) => alternative.properties?.method?.const,
);
const schemaParamsDefs = requestAlternatives.map((alternative) =>
  alternative.properties?.params?.$ref?.split('/').pop(),
);
const schemaResponseTypes = responseAlternatives.map(
  (alternative) => alternative.properties?.type?.const,
);

/** El tipo está declarado en types.gen.ts (type o interface). */
function declaredInTypes(name: string): boolean {
  return new RegExp(`export (type|interface) ${name}\\b`).test(typesSource);
}

/** json-schema-to-typescript emite los tipos en PascalCase. */
function pascalCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');
}

describe('methods.gen vs schema instalado', () => {
  it('el schema trae 90 métodos', () => {
    expect(schemaMethods).toHaveLength(90);
    expect(schema.protocol).toBe(19);
  });

  it('METHOD_NAMES coincide exactamente con el schema', () => {
    expect([...METHOD_NAMES].sort()).toEqual([...schemaMethods].sort() as string[]);
    expect(new Set(METHOD_NAMES).size).toBe(METHOD_NAMES.length);
  });

  it('cada método tiene su tipo de params declarado', () => {
    const missing = schemaParamsDefs.filter((name) => !name || !declaredInTypes(name));
    expect(missing).toEqual([]);
  });

  it('las 57 variantes de respuesta tienen tipo y nombre en runtime', () => {
    expect(schemaResponseTypes).toHaveLength(57);
    expect([...RESPONSE_TYPE_NAMES].sort()).toEqual([...schemaResponseTypes].sort() as string[]);
    const missing = schemaResponseTypes
      .map((typeName) => `Response${pascalCase(typeName ?? '')}`)
      .filter((name) => !declaredInTypes(name));
    expect(missing).toEqual([]);
  });

  it('los defs con el mismo nombre entre schemas no se duplican con sufijo', () => {
    // El dedupe compara refs por nombre: si esto falla, es que dos defs del mismo
    // nombre difieren de verdad y el codegen añadió un sufijo (documentarlo).
    const suffixed = Object.keys(schema.schemas).flatMap((schemaName) =>
      Object.keys(schema.schemas[schemaName]?.$defs ?? {}).map((name) => `${name}_${schemaName}`),
    );
    const present = suffixed.filter((name) => declaredInTypes(name));
    expect(present).toEqual([]);
  });
});
