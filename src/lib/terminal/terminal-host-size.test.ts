// Regresión del fallo «la terminal no se extiende por todo el marco»: el host de
// la terminal era un item flex sin tamaño propio (se dimensionaba por contenido)
// y con padding asimétrico que recortaba la primera columna.
//
// jsdom NO calcula layout (no hay getBoundingClientRect real), así que la
// geometría se fija como CONTRATO de CSS: se leen las hojas del repo y se
// comprueba que el host ocupa el 100×100 del cuerpo del marco, que es item flex
// y que no queda padding que recorte celdas.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const appCss = stripComments(readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf-8'));
const paneFrame = stripComments(
  readFileSync(resolve(process.cwd(), 'src/features/panes/PaneFrame.svelte'), 'utf-8'),
);
const terminalView = stripComments(
  readFileSync(resolve(process.cwd(), 'src/lib/terminal/TerminalView.svelte'), 'utf-8'),
);

/** Quita los comentarios CSS: dentro hay llaves y propiedades que despistan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Extrae las declaraciones del bloque de un selector exacto (`{...}`). */
function ruleBody(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start, `no se encontró la regla ${selector}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('}', start);
  return source.slice(start, end);
}

/** Valor declarado de una propiedad (vacío si no está). */
function declaration(body: string, property: string): string {
  const match = body.match(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+);`));
  return match?.[1]?.trim() ?? '';
}

describe('el host de la terminal ocupa el 100×100 del cuerpo del marco', () => {
  const host = ruleBody(appCss, '.terminal-host');

  it('es item flex que crece y se encoge (flex: 1 1 auto)', () => {
    expect(declaration(host, 'flex')).toBe('1 1 auto');
  });

  it('declara ancho y alto completos', () => {
    expect(declaration(host, 'inline-size')).toBe('100%');
    expect(declaration(host, 'block-size')).toBe('100%');
  });

  it('no lleva padding que recorte celdas', () => {
    expect(declaration(host, 'padding')).toBe('0');
  });

  it('mantiene los mínimos a 0 para poder encogerse con el marco', () => {
    expect(declaration(host, 'min-inline-size')).toBe('0');
    expect(declaration(host, 'min-block-size')).toBe('0');
  });

  it('el cuerpo del marco que lo contiene es un contenedor flex', () => {
    const body = ruleBody(paneFrame, '.pane-frame__body');
    expect(declaration(body, 'display')).toBe('flex');
    expect(declaration(body, 'min-inline-size')).toBe('0');
    expect(declaration(body, 'min-block-size')).toBe('0');
  });

  it('la superficie de xterm llena el host (100% + flex)', () => {
    const surface = ruleBody(terminalView, '.terminal-surface');
    expect(declaration(surface, 'inline-size')).toBe('100%');
    expect(declaration(surface, 'block-size')).toBe('100%');
    expect(declaration(surface, 'flex')).toBe('1 1 auto');
  });

  it('el host es contenedor flex para alinear la terminal con su barra de scroll', () => {
    expect(declaration(host, 'display')).toBe('flex');
  });
});
