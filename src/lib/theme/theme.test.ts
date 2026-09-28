// @vitest-environment jsdom
// T3.7 — Temas: paletas transcriptas, resolución con auto_switch, overrides
// [theme.custom], ANSI derivado y escritura de variables CSS.

import { describe, expect, it } from 'vitest';

import { UI_SETTINGS_DEFAULTS, type UiSettings } from '../stores/settings.svelte';
import { ansiPalette, mix } from './ansi';
import { applyThemeToDocument, parseCssColor, resolveThemeName, themeTokensFor } from './apply';
import { THEME_NAMES, THEME_TOKENS } from './themes';

function values(overrides: Partial<UiSettings> = {}): UiSettings {
  return { ...UI_SETTINGS_DEFAULTS, ...overrides };
}

describe('paletas transcriptas', () => {
  it('están los 18 temas y todos los tokens son hex', () => {
    expect(THEME_NAMES.length).toBe(18);
    for (const name of THEME_NAMES) {
      const tokens = THEME_TOKENS[name];
      for (const [token, color] of Object.entries(tokens)) {
        expect(color, `${name}.${token}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    expect(THEME_TOKENS.catppuccin.accent).toBe('#89b4fa');
    expect(THEME_TOKENS.dracula.text).toBe('#f8f8f2');
  });
});

describe('resolveThemeName', () => {
  it('usa el tema manual si no hay auto_switch', () => {
    expect(resolveThemeName(values({ theme_name: 'dracula' }), false)).toBe('dracula');
  });

  it('con auto_switch elige dark_name o light_name', () => {
    const config = values({
      theme_auto_switch: true,
      theme_dark_name: 'tokyo-night',
      theme_light_name: 'tokyo-night-day',
    });
    expect(resolveThemeName(config, true)).toBe('tokyo-night');
    expect(resolveThemeName(config, false)).toBe('tokyo-night-day');
  });

  it('un nombre desconocido cae a catppuccin', () => {
    expect(resolveThemeName(values({ theme_name: 'nope' }), true)).toBe('catppuccin');
  });
});

describe('themeTokensFor', () => {
  it('aplica los overrides de [theme.custom]', () => {
    const tokens = themeTokensFor(
      values({ theme_custom: { accent: '#ff0000', panel_bg: 'rgb(1, 2, 3)', red: 'reset' } }),
      true,
    );
    expect(tokens.accent).toBe('#ff0000');
    expect(tokens.panelBg).toBe('rgb(1, 2, 3)');
    expect(tokens.red).toBe(THEME_TOKENS.catppuccin.red);
  });
});

describe('parseCssColor', () => {
  it('acepta hex, rgb y nombres; ignora reset', () => {
    expect(parseCssColor('#abc')).toBe('#abc');
    expect(parseCssColor('#AABBCC')).toBe('#AABBCC');
    expect(parseCssColor('rgb(10, 20, 30)')).toBe('rgb(10, 20, 30)');
    expect(parseCssColor('cyan')).toBe('#00ffff');
    expect(parseCssColor('reset')).toBeNull();
    expect(parseCssColor('lo-que-sea')).toBeNull();
  });
});

describe('ansiPalette', () => {
  it('deriva las 16 claves y aclara los bright', () => {
    const ansi = ansiPalette(THEME_TOKENS.catppuccin);
    expect(Object.keys(ansi).length).toBe(16);
    expect(ansi.red).toBe(THEME_TOKENS.catppuccin.red);
    expect(ansi.black).toBe(THEME_TOKENS.catppuccin.surfaceDim);
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('applyThemeToDocument', () => {
  it('escribe la paleta y marca dark/light', () => {
    const dark = applyThemeToDocument(values({ theme_name: 'dracula' }), true);
    expect(dark).toBe('dracula');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themeName).toBe('dracula');
    expect(document.documentElement.style.getPropertyValue('--panel-bg')).toBe(
      THEME_TOKENS.dracula.panelBg,
    );
    expect(document.documentElement.style.getPropertyValue('--ansi-red')).toBe(
      THEME_TOKENS.dracula.red,
    );

    const light = applyThemeToDocument(values({ theme_name: 'catppuccin-latte' }), false);
    expect(light).toBe('catppuccin-latte');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('ui.accent legacy manda si no hay theme.custom.accent', () => {
    applyThemeToDocument(values({ theme_name: 'catppuccin', accent: 'blue' }), true);
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#0000ff');
    applyThemeToDocument(
      values({ theme_name: 'catppuccin', accent: 'blue', theme_custom: { accent: '#123456' } }),
      true,
    );
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#123456');
  });
});
