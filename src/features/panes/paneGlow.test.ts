// T2.4 — Glow de estado del PaneFrame: contrato de CSS.
//
// Guardarraíl del plan §4: el glow vive en un `::after` con sombra FIJA y solo
// se anima `opacity` (animar `box-shadow` o `filter` obliga a repintar el marco
// entero). Este test fija:
//   - los cinco estados, con los tokens de color de herdr;
//   - que `unknown` no pinta glow (es el estado de un panel SIN agente);
//   - que ni `box-shadow` ni `filter` aparecen en transiciones/animaciones.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(resolve(process.cwd(), 'src/features/panes/PaneFrame.svelte'), 'utf-8');

/** Bloque `<style>` del componente, sin comentarios (los comentarios traen `{}`). */
function styleBlock(): string {
  const start = SOURCE.indexOf('<style>');
  const end = SOURCE.lastIndexOf('</style>');
  return SOURCE.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
}

const STYLE = styleBlock();

/**
 * Cuerpo de la regla cuyo selector (o lista de selectores) incluye `selector`.
 * Con `first` se pide la primera coincidencia; sin él, la última (las reglas
 * específicas van después de las generales).
 */
function rule(selector: string, first = true): string {
  const blocks: string[] = [];
  let index = 0;
  while (index < STYLE.length) {
    const open = STYLE.indexOf('{', index);
    if (open < 0) break;
    const close = STYLE.indexOf('}', open);
    if (close < 0) break;
    blocks.push(STYLE.slice(index, close));
    index = close + 1;
  }
  const found = blocks.filter((block) => block.slice(0, block.indexOf('{')).includes(selector));
  const block = first ? found[0] : found[found.length - 1];
  return block ?? '';
}

describe('glow de estado del panel (T2.4)', () => {
  it('cada estado usa un token de color de herdr', () => {
    expect(rule(".pane-frame[data-status='working']")).toContain('--pane-glow: var(--blue)');
    expect(rule(".pane-frame[data-status='blocked']")).toContain('--pane-glow: var(--yellow)');
    expect(rule(".pane-frame[data-status='done']")).toContain('--pane-glow: var(--green)');
    expect(rule(".pane-frame[data-status='idle']")).toContain('--pane-glow: var(--text-dim)');
  });

  it('`unknown` no pinta glow (encendería todos los paneles sin agente)', () => {
    expect(STYLE).not.toContain("data-status='unknown'");
  });

  it('el glow es una capa `::after` que no intercepta clics y solo anima opacity', () => {
    const after = rule('.pane-frame::after');
    expect(after).toContain('content:');
    expect(after).toContain('pointer-events: none');
    expect(after).toContain('border-radius: inherit');
    expect(after).toContain('box-shadow');
    expect(after).toContain('opacity: 0');
    expect(after).toContain('transition: opacity');
  });

  it('los estados con agente encienden el glow y el marco es el ancla', () => {
    expect(rule('.pane-frame')).toContain('position: relative');
    for (const state of ['working', 'blocked', 'done']) {
      expect(rule(`.pane-frame[data-status='${state}']::after`)).toContain('opacity: 0.75');
    }
    // La regla que enciende el glow es una lista con los tres estados.
    expect(rule(".pane-frame[data-status='blocked']::after")).toContain('opacity: 0.75');
    expect(rule(".pane-frame[data-status='idle']::after")).toContain('opacity: 0.35');
  });

  it('el pulso de `working` anima solo opacity y se apaga con movimiento reducido', () => {
    const keyframes = STYLE.slice(STYLE.indexOf('@keyframes pane-glow-pulse'));
    const body = keyframes.slice(0, keyframes.indexOf('\n  }\n'));
    expect(body).toContain('opacity');
    expect(body).not.toContain('box-shadow');
    expect(body).not.toContain('filter');

    const reduced = STYLE.slice(STYLE.indexOf('prefers-reduced-motion'));
    expect(reduced).toContain('animation: none');
  });

  it('ni `box-shadow` ni `filter` se animan en ninguna regla', () => {
    expect(STYLE).not.toMatch(/transition\s*:[^;]*(box-shadow|filter)/);
    expect(STYLE).not.toMatch(/animation\s*:[^;]*(box-shadow|filter)/);
    // `backdrop-filter` tampoco: el glow no crea una superficie glass.
    expect(STYLE).not.toContain('backdrop-filter');
  });
});
