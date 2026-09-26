// Presets de animación de la UI (§3): un único sitio para springs y easings, para
// que los componentes compartan el mismo «feel» en vez de inventar números.
//
// Unidades de `svelte/motion`: la clase `Spring` integra con un paso `dt`
// NORMALIZADO A FRAMES (dt = 1 a 60 fps; el tiempo transcurrido se acota a 1/30 s,
// así que en la práctica dt ∈ [1, 2]). Su recurrencia es el mismo sistema
// masa-muelle-amortiguador que usan otras librerías, pero con:
//     k_svelte = k·dt²/m        d_svelte = c·dt/m        (dt = 1/60)
// Así el spring 600/50/1 (estilo Framer Motion) es exactamente
// { stiffness: 0.1667, damping: 0.8333 }: rápido (~400 ms) y sin rebote, estable
// aunque el frame tarde el doble. Copiar los números «de catálogo» tal cual
// (k = 600, o incluso k = 1) sale inestable: rebote del 80-100 % y oscilación que
// no se asienta. `motion.test.ts` mide el asentamiento y la estabilidad con dt alto.

import { Spring } from 'svelte/motion';

export interface SpringPhysics {
  stiffness: number;
  damping: number;
  mass: number;
}

export interface SpringPreset {
  /** Rigidez en unidades de svelte/motion. */
  stiffness: number;
  /** Amortiguación (0 = rebota, 1 = sin inercia). */
  damping: number;
  /** Umbral de asentamiento, en unidades de la magnitud animada (px). */
  precision: number;
  /** Física «de catálogo» equivalente, para documentar de dónde sale. */
  physics: SpringPhysics;
  /** Tiempo medido hasta asentarse (ms a dt = 1). Lo fija `motion.test.ts`. */
  settleMs: number;
  /** Rebote máximo medido (%) a dt = 1. */
  overshootPct: number;
}

export type SpringPresetName = 'card' | 'panel' | 'snap';

/** Referencia del encargo: spring 600/50/1 (estilo Framer Motion). */
export const REFERENCE_SPRING: SpringPhysics = { stiffness: 600, damping: 50, mass: 1 };

/** Paso de integración de svelte/motion: 60 fps. */
export const FRAME_S = 1 / 60;

/**
 * Convierte física estilo Framer Motion a las unidades de `svelte/motion`:
 * k_svelte = k·dt²/m y d_svelte = c·dt/m. Devuelve `clamped: true` si la clase
 * Spring recorta el resultado a [0, 1] (springs mucho más rígidos que ~3600).
 */
export function springFromPhysics(
  physics: SpringPhysics,
  dt = FRAME_S,
): { stiffness: number; damping: number; clamped: boolean } {
  const mass = physics.mass > 0 ? physics.mass : 1;
  const stiffness = (physics.stiffness * dt * dt) / mass;
  const damping = (physics.damping * dt) / mass;
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
  return {
    stiffness: clamp01(stiffness),
    damping: clamp01(damping),
    clamped: stiffness !== clamp01(stiffness) || damping !== clamp01(damping),
  };
}

export const SPRINGS: Record<SpringPresetName, SpringPreset> = {
  /** Tarjetas y acordeones que se despliegan: el 600/50/1 de la referencia. */
  card: {
    ...springFromPhysics(REFERENCE_SPRING),
    precision: 0.5,
    physics: REFERENCE_SPRING,
    settleMs: 400,
    overshootPct: 0,
  },
  /** Paneles y cajones: un punto más suaves. */
  panel: {
    ...springFromPhysics({ stiffness: 400, damping: 40, mass: 1 }),
    precision: 0.5,
    physics: { stiffness: 400, damping: 40, mass: 1 },
    settleMs: 467,
    overshootPct: 0,
  },
  /** Micro-interacciones (chips, píldoras): corto y con un pelín de rebote. */
  snap: {
    ...springFromPhysics({ stiffness: 900, damping: 45, mass: 1 }),
    precision: 1,
    physics: { stiffness: 900, damping: 45, mass: 1 },
    settleMs: 200,
    overshootPct: 0,
  },
};

/** Opciones listas para `new Spring(value, options)`. */
export function springOptions(preset: SpringPreset | SpringPresetName): {
  stiffness: number;
  damping: number;
  precision: number;
} {
  const resolved = typeof preset === 'string' ? SPRINGS[preset] : preset;
  return {
    stiffness: resolved.stiffness,
    damping: resolved.damping,
    precision: resolved.precision,
  };
}

/** Crea un `Spring` con el preset dado. */
export function createSpring(
  value: number,
  preset: SpringPreset | SpringPresetName = 'panel',
): Spring<number> {
  return new Spring(value, springOptions(preset));
}

/** ¿El usuario pide menos movimiento? Guarda para entornos sin `matchMedia`. */
export function prefersReducedMotionNow(): boolean {
  if (typeof window === 'undefined') return false;
  const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  return query?.matches ?? false;
}

/**
 * Mueve el spring hacia `target`. Con `reduced` (prefers-reduced-motion) salta
 * de golpe: la animación se desactiva, no se acorta a la mitad.
 * Devuelve la promesa que resuelve al asentarse (útil en tests y encadenados).
 */
export function setSpringTarget(
  spring: Spring<number>,
  target: number,
  reduced: boolean,
): Promise<void> {
  if (reduced) {
    spring.set(target, { instant: true });
    return Promise.resolve();
  }
  return spring.set(target);
}

export const EASINGS = {
  /** Por defecto de la UI (token `--ease`). */
  standard: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  /** Entrada con salida suave (abrir tarjetas, mostrar paneles). */
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** Simétrico: opacidad, giros. */
  inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

export const DURATIONS = {
  fast: 120,
  med: 180,
  slow: 240,
} as const;

/** `motion('transform', 'out', 'med')` → `transform 180ms cubic-bezier(...)`. */
export function cssTransition(
  properties: string,
  easing: keyof typeof EASINGS = 'standard',
  duration: keyof typeof DURATIONS = 'med',
): string {
  return `${properties} ${DURATIONS[duration]}ms ${EASINGS[easing]}`;
}
