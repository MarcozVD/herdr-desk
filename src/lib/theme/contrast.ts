// T5.1 — Contraste WCAG 2.1 sobre el cristal. Las capas de glass son semitransparentes
// (`color-mix` de `panel-bg` con alfa), así que su color EFECTIVO depende de lo que haya
// detrás. Aquí está el cálculo real (luminancia relativa + mezcla normal sRGB) para poder
// fijar los pisos de legibilidad del tema claro con números, no a ojo (glass.ts).

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Umbrales de WCAG 2.1 nivel AA. */
export const WCAG_AA_TEXT = 4.5;
export const WCAG_AA_LARGE = 3;

/** `#rgb` o `#rrggbb` → canales 0-255. Devuelve null si no es un hex válido. */
export function parseHexColor(hex: string): Rgb | null {
  const raw = hex.trim().replace(/^#/, '');
  const full = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/** Luminancia relativa WCAG (0 = negro, 1 = blanco). */
export function relativeLuminance(color: Rgb): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** Contraste WCAG entre dos colores opacos (1:1 … 21:1). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Mezcla normal sRGB: `fg` con alfa `alpha` encima de `bg`. */
export function compositeOver(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  const t = Math.min(1, Math.max(0, alpha));
  return {
    r: fg.r * t + bg.r * (1 - t),
    g: fg.g * t + bg.g * (1 - t),
    b: fg.b * t + bg.b * (1 - t),
  };
}

/** Color efectivo de una capa de cristal (`panel-bg` al alfa dado) sobre `backdrop`. */
export function glassSurfaceColor(panelBg: Rgb, alpha: number, backdrop: Rgb): Rgb {
  return compositeOver(panelBg, alpha, backdrop);
}

/** Contraste real de un texto sobre la capa de cristal. */
export function glassTextContrast(text: Rgb, panelBg: Rgb, alpha: number, backdrop: Rgb): number {
  return contrastRatio(text, glassSurfaceColor(panelBg, alpha, backdrop));
}

/**
 * Alfa mínima de la capa para que `text` alcance `target` sobre `backdrop`.
 * El contraste crece con el alfa (el panel claro tapa el fondo oscuro), así que
 * basta una búsqueda binaria.
 */
export function minAlphaForContrast(
  text: Rgb,
  panelBg: Rgb,
  backdrop: Rgb,
  target = WCAG_AA_TEXT,
): number {
  if (glassTextContrast(text, panelBg, 1, backdrop) < target) return 1;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (glassTextContrast(text, panelBg, mid, backdrop) >= target) high = mid;
    else low = mid;
  }
  return high;
}
