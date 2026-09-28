// T3.7 — Temas en vivo: resuelve el tema de herdr (`[theme]` de config.toml,
// con `auto_switch` según la apariencia del sistema) y lo aplica como variables
// CSS + ANSI del terminal. Los valores de las 18 paletas están transcriptos en
// themes.ts desde herdr@d78e3d3b5126 (Apache-2.0).

import type { UiSettings } from '../stores/settings.svelte';
import { ANSI_VARS, ansiPalette } from './ansi';
import {
  LIGHT_THEMES,
  THEME_NAMES,
  THEME_TOKENS,
  type ThemeName,
  type ThemeTokens,
} from './themes';

/** Colores con nombre que acepta herdr (config/theme.rs) → CSS. */
const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  red: '#ff0000',
  green: '#00ff00',
  yellow: '#ffff00',
  blue: '#0000ff',
  magenta: '#ff00ff',
  purple: '#ff00ff',
  cyan: '#00ffff',
  white: '#ffffff',
  gray: '#808080',
  grey: '#808080',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  lightred: '#ff8080',
  lightgreen: '#80ff80',
  lightyellow: '#ffff80',
  lightblue: '#8080ff',
  lightmagenta: '#ff80ff',
  lightcyan: '#80ffff',
};

/** Acepta lo mismo que `parse_color` de herdr: #rgb/#rrggbb, rgb() y nombres. */
export function parseCssColor(raw: string): string | null {
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (value.length === 0) return null;
  if (lower === 'reset' || lower === 'default' || lower === 'none' || lower === 'transparent') {
    return null;
  }
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)) return value;
  if (/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i.test(value)) return value;
  return NAMED_COLORS[lower] ?? null;
}

export function isThemeName(name: string): name is ThemeName {
  return (THEME_NAMES as readonly string[]).includes(name);
}

/** Tema efectivo: `auto_switch` elige dark/light según la apariencia del host. */
export function resolveThemeName(values: UiSettings, dark: boolean): ThemeName {
  const candidate = values.theme_auto_switch
    ? dark
      ? values.theme_dark_name
      : values.theme_light_name
    : values.theme_name;
  return isThemeName(candidate) ? candidate : 'catppuccin';
}

const TOKEN_BY_CONFIG: Record<string, keyof ThemeTokens> = {
  accent: 'accent',
  panel_bg: 'panelBg',
  surface0: 'surface0',
  surface1: 'surface1',
  surface_dim: 'surfaceDim',
  overlay0: 'overlay0',
  overlay1: 'overlay1',
  text: 'text',
  subtext0: 'subtext0',
  mauve: 'mauve',
  green: 'green',
  yellow: 'yellow',
  red: 'red',
  blue: 'blue',
  teal: 'teal',
  peach: 'peach',
};

/** Tokens del tema con los `[theme.custom]` de config.toml superpuestos. */
export function themeTokensFor(values: UiSettings, dark: boolean): ThemeTokens {
  const base = THEME_TOKENS[resolveThemeName(values, dark)];
  const custom = values.theme_custom;
  if (!custom || Object.keys(custom).length === 0) return base;
  const next: ThemeTokens = { ...base };
  for (const [key, raw] of Object.entries(custom)) {
    const token = TOKEN_BY_CONFIG[key];
    if (!token) continue;
    const color = parseCssColor(raw);
    if (color) next[token] = color;
  }
  return next;
}

/** Apariencia del host (prefers-color-scheme). Sin matchMedia, oscuro. */
export function prefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Escribe la paleta como variables CSS (las consume tokens.css) y la ANSI que
 * lee el pool para xterm. Devuelve el nombre del tema aplicado.
 *
 * `ui.accent` (legacy de herdr) manda si no es "cyan" y `[theme.custom]` no
 * trae acento propio, igual que en herdr.
 */
export function applyThemeToDocument(values: UiSettings, dark = prefersDark()): ThemeName {
  const name = resolveThemeName(values, dark);
  const tokens = { ...themeTokensFor(values, dark) };
  if (!values.theme_custom?.accent && values.accent !== 'cyan') {
    const legacy = parseCssColor(values.accent);
    if (legacy) tokens.accent = legacy;
  }

  const root = document.documentElement;
  const set = (cssVar: string, value: string): void => root.style.setProperty(cssVar, value);

  set('--accent', tokens.accent);
  set('--panel-bg', tokens.panelBg);
  set('--sidebar-bg', tokens.surfaceDim);
  set('--active-row-bg', tokens.surface0);
  set('--selection-bg', tokens.surface1);
  set('--surface-dim', tokens.surfaceDim);
  set('--text', tokens.text);
  set('--text-dim', tokens.overlay1);
  set('--mauve', tokens.mauve);
  set('--green', tokens.green);
  set('--yellow', tokens.yellow);
  set('--red', tokens.red);
  set('--blue', tokens.blue);
  set('--teal', tokens.teal);
  set('--indigo', tokens.overlay0);
  set('--peach', tokens.peach);
  set('--panel-bg-solid', tokens.panelBg);
  set('--pane-header-bg', tokens.surfaceDim);

  const ansi = ansiPalette(tokens);
  for (const [key, cssVar] of ANSI_VARS) set(cssVar, ansi[key]);

  root.dataset.theme = LIGHT_THEMES.has(name) ? 'light' : 'dark';
  root.dataset.themeName = name;
  return name;
}
