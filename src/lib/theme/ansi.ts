// T3.7 — Paleta ANSI-16 para xterm a partir de los tokens del tema.
//
// herdr NO define colores ANSI por tema: su terminal hereda los del terminal
// exterior (secuencias OSC 10/11/4). Aquí se derivan de los 16 tokens del tema
// activo para que la terminal de la GUI sea coherente; los «bright» aclaran
// hacia el color de texto del tema. Fuente de los tokens: herdr@d78e3d3b5126
// (src/app/state.rs, Apache-2.0), transcripto en themes.ts.

import type { ThemeTokens } from './themes';

export interface AnsiPalette {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

function parseHex(color: string): [number, number, number] | null {
  const hex = color.trim().replace(/^#/, '');
  if (hex.length === 3) {
    const r = Number.parseInt(hex[0] + hex[0], 16);
    const g = Number.parseInt(hex[1] + hex[1], 16);
    const b = Number.parseInt(hex[2] + hex[2], 16);
    return [r, g, b];
  }
  if (hex.length === 6) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return [r, g, b];
  }
  return null;
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

/** Mezcla `a` hacia `b` (t=0 → a, t=1 → b). Devuelve `a` si no son hex. */
export function mix(a: string, b: string, t: number): string {
  const left = parseHex(a);
  const right = parseHex(b);
  if (!left || !right) return a;
  return toHex([
    left[0] + (right[0] - left[0]) * t,
    left[1] + (right[1] - left[1]) * t,
    left[2] + (right[2] - left[2]) * t,
  ]);
}

/** ANSI-16 derivado de los tokens del tema. */
export function ansiPalette(tokens: ThemeTokens): AnsiPalette {
  const bright = (color: string): string => mix(color, tokens.text, 0.25);
  return {
    black: tokens.surfaceDim,
    red: tokens.red,
    green: tokens.green,
    yellow: tokens.yellow,
    blue: tokens.blue,
    magenta: tokens.mauve,
    cyan: tokens.teal,
    white: tokens.text,
    brightBlack: tokens.overlay0,
    brightRed: bright(tokens.red),
    brightGreen: bright(tokens.green),
    brightYellow: bright(tokens.yellow),
    brightBlue: bright(tokens.blue),
    brightMagenta: bright(tokens.mauve),
    brightCyan: bright(tokens.teal),
    brightWhite: bright(tokens.text),
  };
}

/** Variables CSS (`--ansi-*`) que lee el pool para el tema de xterm. */
export const ANSI_VARS: ReadonlyArray<[keyof AnsiPalette, string]> = [
  ['black', '--ansi-black'],
  ['red', '--ansi-red'],
  ['green', '--ansi-green'],
  ['yellow', '--ansi-yellow'],
  ['blue', '--ansi-blue'],
  ['magenta', '--ansi-magenta'],
  ['cyan', '--ansi-cyan'],
  ['white', '--ansi-white'],
  ['brightBlack', '--ansi-bright-black'],
  ['brightRed', '--ansi-bright-red'],
  ['brightGreen', '--ansi-bright-green'],
  ['brightYellow', '--ansi-bright-yellow'],
  ['brightBlue', '--ansi-bright-blue'],
  ['brightMagenta', '--ansi-bright-magenta'],
  ['brightCyan', '--ansi-bright-cyan'],
  ['brightWhite', '--ansi-bright-white'],
];
