// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { applyGlassLevel, clampGlassLevel, glassAlphas } from './glass';

describe('nivel de cristal', () => {
  it('acota a 1..100 y redondea', () => {
    expect(clampGlassLevel(0)).toBe(1);
    expect(clampGlassLevel(250)).toBe(100);
    expect(clampGlassLevel(42.6)).toBe(43);
    expect(clampGlassLevel(Number.NaN)).toBe(60);
  });

  it('más nivel = menos opacidad (oscuro)', () => {
    const low = glassAlphas(1, false);
    const high = glassAlphas(100, false);
    expect(low.surface).toBeGreaterThan(high.surface);
    expect(low.overlay).toBeGreaterThan(high.overlay);
    expect(low.tint).toBeGreaterThan(high.tint);
    expect(high.surface).toBeCloseTo(0.12);
  });

  it('el tema claro nunca baja de su piso de legibilidad', () => {
    const light = glassAlphas(100, true);
    expect(light.surface).toBeGreaterThanOrEqual(0.85);
    expect(light.overlay).toBeGreaterThanOrEqual(0.89);
    expect(light.elevated).toBeGreaterThanOrEqual(0.93);
    expect(light.tint).toBeGreaterThanOrEqual(150);
    // con poco cristal manda el valor propio, no el piso
    expect(glassAlphas(1, true).surface).toBe(glassAlphas(1, false).surface);
  });

  it('escribe las variables en :root', () => {
    const root = document.createElement('html');
    applyGlassLevel(root, 100, false);
    expect(root.style.getPropertyValue('--glass-alpha-surface')).toBe('0.12');
    expect(root.dataset.glassLevel).toBe('100');
  });
});
