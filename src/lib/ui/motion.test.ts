import { describe, expect, it } from 'vitest';

// `svelte/motion` crea su media query de prefers-reduced-motion AL IMPORTARSE y
// su bucle de animación llama a requestAnimationFrame; en el entorno `node` de
// los unitarios no hay ninguno de los dos. Se instalan shims mínimos antes de
// cargar el módulo (de ahí el import dinámico).
const globals = globalThis as {
  window?: unknown;
  requestAnimationFrame?: unknown;
  cancelAnimationFrame?: unknown;
};
globals.window ??= {
  matchMedia: () => ({
    matches: false,
    media: '',
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
};
if (typeof globals.requestAnimationFrame !== 'function') {
  globals.requestAnimationFrame = (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16) as unknown as number;
  globals.cancelAnimationFrame = (handle: number) => clearTimeout(handle);
}

const {
  createSpring,
  cssTransition,
  DURATIONS,
  EASINGS,
  FRAME_S,
  REFERENCE_SPRING,
  setSpringTarget,
  SPRINGS,
  springFromPhysics,
  springOptions,
} = await import('./motion');

type SpringPreset = (typeof SPRINGS)[keyof typeof SPRINGS];

/**
 * Recurrencia EXACTA de svelte/motion (svelte/src/motion/spring.js: `tick_spring`),
 * copiada aquí para medir los presets sin depender del bucle de rAF. `dt` va
 * normalizado a frames (1 a 60 fps; Svelte acota el tiempo transcurrido a 1/30 s,
 * así que en la práctica dt ∈ [1, 2]).
 *   v = (x - last)/dt ; a = k·(T - x) - d·v ; x += (v + a)·dt
 */
function simulateSpring(
  preset: Pick<SpringPreset, 'stiffness' | 'damping' | 'precision'>,
  {
    dt = 1,
    target = 100,
    maxFrames = 600,
  }: { dt?: number; target?: number; maxFrames?: number } = {},
): { settleMs: number; overshootPct: number; maxAbs: number } {
  let current = 0;
  let last = 0;
  let frames = 0;
  let maxOvershoot = 0;
  let maxAbs = 0;
  for (let index = 0; index < maxFrames; index += 1) {
    const delta = target - current;
    const velocity = (current - last) / dt;
    const acceleration = preset.stiffness * delta - preset.damping * velocity;
    const step = (velocity + acceleration) * dt;
    last = current;
    current += step;
    frames += 1;
    maxAbs = Math.max(maxAbs, Math.abs(current));
    if (current > target) maxOvershoot = Math.max(maxOvershoot, (current - target) / target);
    if (Math.abs(step) < preset.precision && Math.abs(delta) < preset.precision) break;
  }
  return {
    settleMs: Math.round(frames * FRAME_S * 1000),
    overshootPct: Number((maxOvershoot * 100).toFixed(2)),
    maxAbs: Number(maxAbs.toFixed(1)),
  };
}

describe('presets de spring', () => {
  it('todos caben en el rango que acepta la clase Spring (evita el recorte silencioso)', () => {
    for (const [name, preset] of Object.entries(SPRINGS)) {
      expect(preset.stiffness, name).toBeGreaterThan(0);
      expect(preset.stiffness, name).toBeLessThanOrEqual(1);
      expect(preset.damping, name).toBeGreaterThan(0);
      expect(preset.damping, name).toBeLessThanOrEqual(1);
      expect(preset.precision, name).toBeGreaterThan(0);
      expect(preset.physics.mass, name).toBeGreaterThan(0);
    }
  });

  it('card es exactamente el spring 600/50/1 de la referencia', () => {
    const convertido = springFromPhysics(REFERENCE_SPRING);
    expect(convertido.clamped).toBe(false);
    expect(SPRINGS.card.stiffness).toBeCloseTo(convertido.stiffness, 6);
    expect(SPRINGS.card.damping).toBeCloseTo(convertido.damping, 6);
  });

  it('el preset card se asienta rápido y sin rebote', () => {
    const measured = simulateSpring(SPRINGS.card);
    expect(measured.settleMs).toBeLessThan(500);
    expect(measured.overshootPct).toBeLessThan(1);
    // El valor declarado en el preset es el medido (si alguien lo cambia, se entera).
    expect(Math.abs(measured.settleMs - SPRINGS.card.settleMs)).toBeLessThan(60);
  });

  it('todos los presets se asientan en menos de 1 s y con rebote mínimo', () => {
    for (const [name, preset] of Object.entries(SPRINGS)) {
      const measured = simulateSpring(preset);
      expect(measured.settleMs, name).toBeLessThan(1000);
      expect(measured.overshootPct, name).toBeLessThan(3);
      expect(Math.abs(measured.settleMs - preset.settleMs), name).toBeLessThan(60);
    }
  });

  it('ningún preset diverge cuando el frame tarda el doble (dt hasta 2)', () => {
    // Regresión del fallo que tenía el preset original (k = 1, d = 0.2): con dt > 1
    // se desbocaba (rebote del 80-100 %) y oscilaba sin asentarse, así que el panel
    // nunca llegaba a su altura. Svelte acota el paso a 1/30 s → dt máximo 2.
    for (const [name, preset] of Object.entries(SPRINGS)) {
      for (const dt of [1.5, 2]) {
        const measured = simulateSpring(preset, { dt });
        expect(measured.maxAbs, `${name} dt=${dt}`).toBeLessThan(110);
        expect(measured.overshootPct, `${name} dt=${dt}`).toBeLessThan(6);
        expect(measured.settleMs, `${name} dt=${dt}`).toBeLessThan(800);
      }
    }
  });

  it('la conversión desde Framer Motion avisa cuando el recorte cambia la física', () => {
    const reference = springFromPhysics(REFERENCE_SPRING);
    expect(reference.stiffness).toBeCloseTo(600 / 3600, 6);
    expect(reference.damping).toBeCloseTo(50 / 60, 6);
    expect(reference.clamped).toBe(false);

    const small = springFromPhysics({ stiffness: 360, damping: 15, mass: 1 });
    expect(small.clamped).toBe(false);
    expect(small.stiffness).toBeCloseTo(0.1, 6);
    expect(small.damping).toBeCloseTo(0.25, 6);

    // La masa divide la rigidez y la amortiguación.
    const heavy = springFromPhysics({ stiffness: 360, damping: 15, mass: 2 });
    expect(heavy.stiffness).toBeCloseTo(0.05, 6);
    expect(heavy.damping).toBeCloseTo(0.125, 6);

    // Un spring muy rígido no cabe en [0, 1]: la clase lo recortaría.
    const rigido = springFromPhysics({ stiffness: 4000, damping: 50, mass: 1 });
    expect(rigido.clamped).toBe(true);
    expect(rigido.stiffness).toBe(1);
  });

  it('springOptions resuelve por nombre y por preset', () => {
    expect(springOptions('snap')).toEqual({
      stiffness: SPRINGS.snap.stiffness,
      damping: SPRINGS.snap.damping,
      precision: SPRINGS.snap.precision,
    });
    expect(springOptions(SPRINGS.card).damping).toBe(SPRINGS.card.damping);
  });
});

describe('setSpringTarget', () => {
  it('con movimiento reducido salta de golpe al objetivo', () => {
    const spring = createSpring(0, 'card');
    setSpringTarget(spring, 120, true);
    expect(spring.current).toBe(120);
    expect(spring.target).toBe(120);
  });

  it('sin reducción el valor arranca animándose (no salta)', () => {
    const spring = createSpring(0, 'card');
    setSpringTarget(spring, 120, false);
    expect(spring.target).toBe(120);
    expect(spring.current).toBe(0);
  });

  it('acaba llegando al objetivo (bucle de svelte/motion)', async () => {
    const spring = createSpring(0, 'card');
    // `Spring.set()` resuelve cuando el spring se asienta (y entonces el propio
    // algoritmo devuelve el objetivo exacto).
    await setSpringTarget(spring, 60, false);
    expect(spring.current).toBe(60);
  });

  it('pasa por estados intermedios y no se desboca', async () => {
    const spring = createSpring(0, 'card');
    const muestras: number[] = [];
    const animacion = setSpringTarget(spring, 120, false);
    const intervalo = setInterval(() => muestras.push(spring.current), 20);
    await animacion;
    clearInterval(intervalo);
    expect(spring.current).toBe(120);
    expect(Math.max(...muestras)).toBeLessThanOrEqual(120);
    expect(muestras.some((valor) => valor > 0 && valor < 120)).toBe(true);
  });
});

describe('easings y duraciones', () => {
  it('los easings son cubic-bezier válidos', () => {
    for (const [name, value] of Object.entries(EASINGS)) {
      expect(value, name).toMatch(/^cubic-bezier\((-?[\d.]+, ){3}-?[\d.]+\)$/);
    }
  });

  it('cssTransition compone la transición con el preset pedido', () => {
    expect(cssTransition('transform')).toBe(`transform ${DURATIONS.med}ms ${EASINGS.standard}`);
    expect(cssTransition('height', 'out', 'fast')).toBe(
      `height ${DURATIONS.fast}ms ${EASINGS.out}`,
    );
  });
});
