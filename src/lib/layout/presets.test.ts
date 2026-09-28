// T3.3 — Presets de layout: validación y nombres.

import { describe, expect, it } from 'vitest';

import { isLayoutNode, presetNames, sanitizePresetName, withoutPreset } from './presets';

describe('isLayoutNode', () => {
  it('acepta hojas pane y splits anidados', () => {
    expect(isLayoutNode({ type: 'pane', cwd: 'C:/x' })).toBe(true);
    expect(
      isLayoutNode({
        type: 'split',
        direction: 'right',
        ratio: 0.5,
        first: { type: 'pane' },
        second: {
          type: 'split',
          direction: 'down',
          ratio: 0.3,
          first: { type: 'pane' },
          second: { type: 'pane' },
        },
      }),
    ).toBe(true);
  });

  it('rechaza formas inválidas', () => {
    expect(isLayoutNode(null)).toBe(false);
    expect(isLayoutNode({ type: 'split' })).toBe(false);
    expect(
      isLayoutNode({ type: 'split', direction: 'diagonal', ratio: 0.5, first: {}, second: {} }),
    ).toBe(false);
    expect(
      isLayoutNode({
        type: 'split',
        direction: 'right',
        ratio: 2,
        first: { type: 'pane' },
        second: { type: 'pane' },
      }),
    ).toBe(false);
    expect(
      isLayoutNode({ type: 'split', direction: 'right', ratio: 0.5, first: { type: 'pane' } }),
    ).toBe(false);
  });
});

describe('sanitizePresetName', () => {
  it('acepta nombres razonables y recorta', () => {
    expect(sanitizePresetName('  mi-layout  ')).toBe('mi-layout');
    expect(sanitizePresetName('dev 2')).toBe('dev 2');
    expect(sanitizePresetName('a.b_c-d')).toBe('a.b_c-d');
  });

  it('rechaza vacíos, largos y caracteres raros', () => {
    expect(sanitizePresetName('')).toBeNull();
    expect(sanitizePresetName('   ')).toBeNull();
    expect(sanitizePresetName('a'.repeat(41))).toBeNull();
    expect(sanitizePresetName('../evil')).toBeNull();
    expect(sanitizePresetName('-empieza-con-guion')).toBeNull();
  });
});

describe('presetNames / withoutPreset', () => {
  it('ordena y quita sin mutar', () => {
    const presets = { zeta: {}, alfa: {}, 'beta 2': {} };
    expect(presetNames(presets)).toEqual(['alfa', 'beta 2', 'zeta']);
    const next = withoutPreset(presets, 'alfa');
    expect(Object.keys(next)).toEqual(['zeta', 'beta 2']);
    expect(Object.keys(presets)).toHaveLength(3);
  });
});
