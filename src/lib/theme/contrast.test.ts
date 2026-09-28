import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  compositeOver,
  contrastRatio,
  glassTextContrast,
  minAlphaForContrast,
  parseHexColor,
  relativeLuminance,
  WCAG_AA_TEXT,
  type Rgb,
} from './contrast';
import { glassAlphas, GLASS_LEVEL_MAX, GLASS_LEVEL_MIN } from './glass';
import { THEME_TOKENS } from './themes';

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

function cssColor(name: string): Rgb {
  const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
  const light = css.split("html[data-theme='light']")[1];
  const match = light?.match(new RegExp(`${name}:\\s*(#[0-9a-f]{3,8})`, 'i'));
  const color = match ? parseHexColor(match[1]) : null;
  if (!color) throw new Error(`no se pudo leer ${name} de tokens.css`);
  return color;
}

describe('contraste WCAG', () => {
  it('la escala de luminancia y contraste coincide con los valores conocidos', () => {
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 5);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5);
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
    expect(contrastRatio(parseHexColor('#777777')!, WHITE)).toBeCloseTo(4.48, 2);
  });

  it('compone alfa en sRGB (extremos y mezcla)', () => {
    expect(compositeOver(WHITE, 0, BLACK)).toEqual(BLACK);
    expect(compositeOver(WHITE, 1, BLACK)).toEqual(WHITE);
    expect(compositeOver(WHITE, 0.5, BLACK)).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
  });

  it('minAlphaForContrast encuentra el umbral exacto', () => {
    const alpha = minAlphaForContrast(WHITE, BLACK, BLACK, WCAG_AA_TEXT);
    expect(alpha).toBeLessThan(0.001);
    const gray = parseHexColor('#333333')!;
    const needed = minAlphaForContrast(gray, WHITE, BLACK, WCAG_AA_TEXT);
    expect(needed).toBeGreaterThan(0.5);
    expect(needed).toBeLessThan(0.7);
    expect(glassTextContrast(gray, WHITE, needed, BLACK)).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
    expect(glassTextContrast(gray, WHITE, Math.max(0, needed - 0.01), BLACK)).toBeLessThan(
      WCAG_AA_TEXT,
    );
    // Si ni la capa opaca llega (p. ej. gris medio sobre blanco), no hay alfa posible.
    expect(minAlphaForContrast(parseHexColor('#777777')!, WHITE, BLACK, WCAG_AA_TEXT)).toBe(1);
  });
});

describe('pisos del cristal claro (T5.1)', () => {
  const panel = cssColor('--panel-bg');
  const text = cssColor('--text');
  const textDim = cssColor('--text-dim');

  it('los tokens de respaldo del tema claro se leen de tokens.css', () => {
    expect(panel).toEqual({ r: 244, g: 244, b: 248 });
    expect(text).toEqual({ r: 27, g: 27, b: 35 });
    expect(textDim).toEqual({ r: 85, g: 85, b: 106 });
  });

  it('el texto oscuro pide alfa ≥ 0.55 y el atenuado ≥ 0.83 sobre negro', () => {
    expect(minAlphaForContrast(text, panel, BLACK)).toBeGreaterThan(0.5);
    expect(minAlphaForContrast(text, panel, BLACK)).toBeLessThanOrEqual(0.55);
    expect(minAlphaForContrast(textDim, panel, BLACK)).toBeGreaterThan(0.8);
    expect(minAlphaForContrast(textDim, panel, BLACK)).toBeLessThanOrEqual(0.85);
  });

  it('con cualquier nivel de cristal, texto y atenuado superan AA en las tres capas', () => {
    for (let level = GLASS_LEVEL_MIN; level <= GLASS_LEVEL_MAX; level++) {
      const { surface, overlay, elevated } = glassAlphas(level, true);
      for (const [alpha, name] of [
        [surface, 'surface'],
        [overlay, 'overlay'],
        [elevated, 'elevated'],
      ] as const) {
        expect(
          glassTextContrast(text, panel, alpha, BLACK),
          `texto en ${name} con nivel ${level}`,
        ).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
        expect(
          glassTextContrast(textDim, panel, alpha, BLACK),
          `texto atenuado en ${name} con nivel ${level}`,
        ).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      }
    }
  });

  it('los pisos conservan el orden de opacidad entre capas', () => {
    for (let level = GLASS_LEVEL_MIN; level <= GLASS_LEVEL_MAX; level++) {
      const { surface, overlay, elevated } = glassAlphas(level, true);
      expect(surface).toBeLessThanOrEqual(overlay);
      expect(overlay).toBeLessThanOrEqual(elevated);
    }
  });

  it('el tema claro elegido por defecto (catppuccin-latte) supera AA sobre negro', () => {
    const latte = THEME_TOKENS['catppuccin-latte'];
    const lattePanel = parseHexColor(latte.panelBg)!;
    const latteText = parseHexColor(latte.text)!;
    const { surface } = glassAlphas(GLASS_LEVEL_MAX, true);
    expect(glassTextContrast(latteText, lattePanel, surface, BLACK)).toBeGreaterThanOrEqual(
      WCAG_AA_TEXT,
    );
  });

  it('el cristal oscuro sigue siendo transparente (los pisos son solo del claro)', () => {
    const dark = glassAlphas(GLASS_LEVEL_MAX, false);
    const light = glassAlphas(GLASS_LEVEL_MAX, true);
    expect(dark.surface).toBeLessThan(light.surface);
    expect(dark.overlay).toBeLessThan(light.overlay);
    expect(dark.elevated).toBeLessThan(light.elevated);
  });
});
