// Nivel de cristal (1-100) → opacidades de las capas y del tinte del acrílico.
// 1 = casi sólido, 100 = lo más transparente. En tema claro hay un mínimo de
// opacidad: el texto oscuro sobre lo que hay detrás (a menudo oscuro) dejaba de
// leerse, así que el claro nunca baja de esos pisos.
//
// T5.1 — Los pisos ya no son «a ojo»: salen del contraste WCAG real
// (`contrast.ts`, con `minAlphaForContrast`) sobre los tokens claros de
// tokens.css (texto #1b1b23, texto atenuado #55556a, panel #f4f4f8) contra el
// peor fondo posible, negro (ni Mica ni el tinte del acrílico detrás):
//   - texto    → alfa ≥ 0.535 (4.5:1)
//   - atenuado → alfa ≥ 0.833 (4.5:1)
// El piso de `surface` es 0.85 (margen sobre 0.833) y overlay/elevated suben
// conservando el orden de opacidad (cada capa tapa más que la anterior).
// `contrast.test.ts` lo verifica para todos los niveles 1-100.
// Nota: los temas de herdr sustituyen `--text`/`--text-dim` por los tokens de su
// paleta; algunas paletas claras (p. ej. solarized-light) no llegan a AA ni con
// la capa opaca. Es un límite de la paleta, no del piso; el piso garantiza el
// color de respaldo de la GUI.

export const GLASS_LEVEL_MIN = 1;
export const GLASS_LEVEL_MAX = 100;
export const GLASS_LEVEL_DEFAULT = 60;

export interface GlassAlphas {
  surface: number;
  overlay: number;
  elevated: number;
  /** Alpha (0-255) del tinte que Windows pone sobre el acrílico. */
  tint: number;
}

const DARK = {
  surface: [0.9, 0.12],
  overlay: [0.95, 0.32],
  elevated: [0.97, 0.55],
  tint: [220, 20],
} as const;

/** Pisos del tema claro (legibilidad del texto oscuro). Ver la cabecera. */
const LIGHT_FLOOR = { surface: 0.85, overlay: 0.89, elevated: 0.93, tint: 150 } as const;

export function clampGlassLevel(level: number): number {
  if (!Number.isFinite(level)) return GLASS_LEVEL_DEFAULT;
  return Math.min(GLASS_LEVEL_MAX, Math.max(GLASS_LEVEL_MIN, Math.round(level)));
}

const lerp = ([from, to]: readonly [number, number], t: number): number => from + (to - from) * t;
const round2 = (n: number): number => Math.round(n * 100) / 100;

export function glassAlphas(level: number, light: boolean): GlassAlphas {
  const t = (clampGlassLevel(level) - GLASS_LEVEL_MIN) / (GLASS_LEVEL_MAX - GLASS_LEVEL_MIN);
  let surface = lerp(DARK.surface, t);
  let overlay = lerp(DARK.overlay, t);
  let elevated = lerp(DARK.elevated, t);
  let tint = lerp(DARK.tint, t);
  if (light) {
    surface = Math.max(surface, LIGHT_FLOOR.surface);
    overlay = Math.max(overlay, LIGHT_FLOOR.overlay);
    elevated = Math.max(elevated, LIGHT_FLOOR.elevated);
    tint = Math.max(tint, LIGHT_FLOOR.tint);
  }
  return {
    surface: round2(surface),
    overlay: round2(overlay),
    elevated: round2(elevated),
    tint: Math.round(tint),
  };
}

/** Escribe las opacidades como variables CSS en `:root` (ganan a tokens.css). */
export function applyGlassLevel(root: HTMLElement, level: number, light: boolean): GlassAlphas {
  const a = glassAlphas(level, light);
  root.style.setProperty('--glass-alpha-surface', String(a.surface));
  root.style.setProperty('--glass-alpha-overlay', String(a.overlay));
  root.style.setProperty('--glass-alpha-elevated', String(a.elevated));
  root.dataset.glassLevel = String(clampGlassLevel(level));
  return a;
}
