// @vitest-environment jsdom
// El componente se monta de verdad (mount + flushSync), sin dependencias de
// testing añadidas: jsdom no trae matchMedia ni ResizeObserver, así que aquí se
// instalan stubs mínimos ANTES de importar el componente (svelte/motion crea la
// media query de prefers-reduced-motion al cargarse).

import { flushSync, mount, unmount, type Component } from 'svelte';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

/** Altura falsa que devuelve `clientHeight` para los contenidos. */
const FAKE_CONTENT_HEIGHT = 120;

let reducedMotion = false;
const mediaQueries: StubMediaQueryList[] = [];

/** MediaQueryList mínima: un EventTarget real, como el del navegador. */
class StubMediaQueryList extends EventTarget {
  readonly #query: string;
  constructor(query: string) {
    super();
    this.#query = query;
    mediaQueries.push(this);
  }
  get matches(): boolean {
    return this.#query.includes('prefers-reduced-motion') ? reducedMotion : false;
  }
  get media(): string {
    return this.#query;
  }
}

function installBrowserStubs(): void {
  window.matchMedia = ((query: string) =>
    new StubMediaQueryList(query)) as unknown as typeof window.matchMedia;

  const seen = new WeakSet<Element>();
  class StubResizeObserver {
    #callback: (entries: unknown[]) => void;
    constructor(callback: (entries: unknown[]) => void) {
      this.#callback = callback;
    }
    observe(target: Element): void {
      // Svelte solo usa el observer como señal. Un ResizeObserver real avisa
      // fuera del ciclo actual, así que aquí también (si no, se reentra en el
      // efecto que registra la medición).
      if (seen.has(target)) return;
      seen.add(target);
      setTimeout(
        () => this.#callback([{ target, contentRect: { height: FAKE_CONTENT_HEIGHT } }]),
        0,
      );
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;

  // El rAF de jsdom no dispara de forma puntual entre tests y los Spring se
  // quedan congelados en 0. Se sustituye por uno determinista basado en timers
  // (Svelte llama a `requestAnimationFrame` en cada tick, así que basta con
  // reemplazar el global).
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(
      () => callback(performance.now()),
      16,
    ) as unknown as number) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((handle: number) =>
    clearTimeout(handle)) as typeof cancelAnimationFrame;

  // `bind:clientHeight` lee `element.clientHeight`: se simula la altura medida.
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains('csa__content') ? FAKE_CONTENT_HEIGHT : 0;
    },
  });
}

installBrowserStubs();

const module_ = await import('./CardSplitAccordion.svelte');
type ComponentModule = {
  default: Component<Record<string, unknown>>;
  itemChrome: (
    index: number,
    total: number,
    openIndex: number,
  ) => {
    borderTop: number;
    borderBottom: number;
    radius: { tl: number; tr: number; br: number; bl: number };
    marginBlock: number;
  };
  DEFAULT_ITEMS: Array<{ id: number | string; title: string; content: string }>;
};
const CardSplitAccordion = (module_ as unknown as ComponentModule).default;
const { itemChrome, DEFAULT_ITEMS } = module_ as unknown as ComponentModule;

let instance: Record<string, unknown> | null = null;
let target: HTMLElement | null = null;

async function mountAccordion(props: Record<string, unknown> = {}): Promise<void> {
  target = document.createElement('div');
  document.body.append(target);
  instance = mount(CardSplitAccordion, {
    target,
    props: { items: DEFAULT_ITEMS, ...props },
  }) as unknown as Record<string, unknown>;
  flushSync();
  // La altura llega por ResizeObserver (asíncrono): deja pasar un turno.
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

function setReducedMotion(value: boolean): void {
  reducedMotion = value;
  // Evento real (cancelable: false, como el del navegador) para que Svelte no
  // intente propagarlo por su sistema de delegación.
  for (const query of mediaQueries) query.dispatchEvent(new Event('change'));
  flushSync();
}

function triggers(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[data-testid="csa-trigger"]')];
}

function panels(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-testid="csa-panel"]')];
}

function expanded(): boolean[] {
  return triggers().map((trigger) => trigger.getAttribute('aria-expanded') === 'true');
}

function click(element: HTMLElement): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  flushSync();
}

function key(element: HTMLElement, keyToSend: string): void {
  element.dispatchEvent(new KeyboardEvent('keydown', { key: keyToSend, bubbles: true }));
  flushSync();
}

beforeAll(() => {
  reducedMotion = false;
});

afterEach(() => {
  if (instance) unmount(instance as never);
  instance = null;
  target?.remove();
  target = null;
  document.body.innerHTML = '';
});

describe('entorno', () => {
  it('el shim de rAF mueve un Spring en jsdom', async () => {
    const { createSpring, setSpringTarget } = await import('./motion');
    const spring = createSpring(0, 'card');
    await setSpringTarget(spring, 60, false);
    expect(spring.current).toBe(60);
  });
});

describe('CardSplitAccordion', () => {
  it('pinta un botón por item y arranca con todo cerrado', async () => {
    await mountAccordion();
    expect(triggers()).toHaveLength(5);
    expect(expanded()).toEqual([false, false, false, false, false]);
    expect(panels()).toHaveLength(5);
    for (const panel of panels()) {
      expect(panel.getAttribute('aria-hidden')).toBe('true');
      expect(panel.style.height).toBe('0px');
    }
    expect(document.querySelector('[data-testid="card-split-accordion"]')).not.toBeNull();
  });

  it('el clic abre el item y solo uno queda abierto', async () => {
    await mountAccordion();
    click(triggers()[1] as HTMLButtonElement);
    expect(expanded()).toEqual([false, true, false, false, false]);
    expect(panels()[1]?.getAttribute('aria-hidden')).toBe('false');
    expect(panels()[1]?.dataset.open).toBe('true');

    click(triggers()[3] as HTMLButtonElement);
    expect(expanded()).toEqual([false, false, false, true, false]);
    expect(panels()[1]?.getAttribute('aria-hidden')).toBe('true');
  });

  it('el clic en el item abierto lo vuelve a cerrar', async () => {
    const changes: Array<string | number | null> = [];
    await mountAccordion({ onOpenChange: (id: string | number | null) => changes.push(id) });
    click(triggers()[0] as HTMLButtonElement);
    expect(expanded()[0]).toBe(true);
    click(triggers()[0] as HTMLButtonElement);
    expect(expanded()[0]).toBe(false);
    expect(changes).toEqual([1, null]);
  });

  it('cada cabecera apunta a su panel y el panel es una region etiquetada', async () => {
    await mountAccordion();
    const headers = triggers();
    const bodies = panels();
    headers.forEach((header, index) => {
      const body = bodies[index] as HTMLElement;
      expect(header.getAttribute('aria-controls')).toBe(body.id);
      expect(body.getAttribute('aria-labelledby')).toBe(header.id);
      expect(body.getAttribute('role')).toBe('region');
      expect(header.tagName).toBe('BUTTON');
      expect(header.getAttribute('type')).toBe('button');
    });
  });

  it('respeta el openId que le pasan por props', async () => {
    await mountAccordion({ openId: 3 });
    expect(expanded()).toEqual([false, false, true, false, false]);
    expect(panels()[2]?.dataset.open).toBe('true');
  });

  it('navega entre cabeceras con las flechas, Home y End', async () => {
    await mountAccordion();
    const headers = triggers();
    headers[0]?.focus();
    expect(document.activeElement).toBe(headers[0]);

    key(headers[0] as HTMLButtonElement, 'ArrowDown');
    expect(document.activeElement).toBe(headers[1]);
    key(headers[1] as HTMLButtonElement, 'ArrowDown');
    expect(document.activeElement).toBe(headers[2]);
    key(headers[2] as HTMLButtonElement, 'ArrowUp');
    expect(document.activeElement).toBe(headers[1]);
    key(headers[1] as HTMLButtonElement, 'End');
    expect(document.activeElement).toBe(headers[4]);
    key(headers[4] as HTMLButtonElement, 'ArrowDown');
    expect(document.activeElement).toBe(headers[0]);
    key(headers[0] as HTMLButtonElement, 'ArrowUp');
    expect(document.activeElement).toBe(headers[4]);
    key(headers[4] as HTMLButtonElement, 'Home');
    expect(document.activeElement).toBe(headers[0]);
  });

  it('el foco de teclado no abre el item (el botón nativo activa con Enter/Espacio)', async () => {
    await mountAccordion();
    const header = triggers()[2] as HTMLButtonElement;
    header.focus();
    key(header, 'Tab');
    expect(expanded()).toEqual([false, false, false, false, false]);
  });

  it('el primer item usa un SVG inline y el resto iconos de lucide', async () => {
    await mountAccordion();
    expect(document.querySelectorAll('[data-testid="csa-icon-inline"]')).toHaveLength(1);
    const first = triggers()[0] as HTMLButtonElement;
    expect(first.querySelector('[data-testid="csa-icon-inline"]')).not.toBeNull();
    expect(first.querySelectorAll('svg')).toHaveLength(2); // icono + chevron
    expect(triggers()[1]?.querySelector('svg')).not.toBeNull();
  });

  it('sin movimiento reducido la altura se anima hacia la medida', async () => {
    await mountAccordion();
    click(triggers()[0] as HTMLButtonElement);
    const heightNow = () => Number.parseFloat((panels()[0] as HTMLElement).style.height);
    // El bucle de rAF de jsdom no es puntual: se espera a ver un valor intermedio.
    const deadline = Date.now() + 1500;
    while ((heightNow() <= 0 || heightNow() >= FAKE_CONTENT_HEIGHT) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 16));
      flushSync();
    }
    const midway = heightNow();
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(FAKE_CONTENT_HEIGHT);

    // Y acaba asentándose en la altura medida (el algoritmo devuelve el objetivo).
    while (heightNow() !== FAKE_CONTENT_HEIGHT && Date.now() < deadline + 2000) {
      await new Promise((resolve) => setTimeout(resolve, 16));
      flushSync();
    }
    expect(heightNow()).toBe(FAKE_CONTENT_HEIGHT);
  });

  it('con prefers-reduced-motion el panel salta abierto sin animar', async () => {
    await mountAccordion();
    setReducedMotion(true);
    click(triggers()[0] as HTMLButtonElement);
    expect((panels()[0] as HTMLElement).style.height).toBe(`${FAKE_CONTENT_HEIGHT}px`);
    click(triggers()[0] as HTMLButtonElement);
    expect((panels()[0] as HTMLElement).style.height).toBe('0px');
  });
});

describe('itemChrome (geometría «split» del original)', () => {
  it('sin nada abierto: bordes solo en los extremos y esquinas de la lista', () => {
    expect(itemChrome(0, 3, -1).borderTop).toBe(1);
    expect(itemChrome(1, 3, -1).borderTop).toBe(0);
    expect(itemChrome(2, 3, -1).borderBottom).toBe(1);
    expect(itemChrome(1, 3, -1).radius).toEqual({ tl: 0, tr: 0, br: 0, bl: 0 });
    expect(itemChrome(0, 3, -1).radius).toEqual({ tl: 20, tr: 20, br: 0, bl: 0 });
    expect(itemChrome(2, 3, -1).radius).toEqual({ tl: 0, tr: 0, br: 20, bl: 20 });
    expect(itemChrome(0, 3, -1).marginBlock).toBe(0);
  });

  it('con el del medio abierto: la abierta se redondea y los vecinos se ajustan', () => {
    // 5 items, abierto el 2 → los vecinos 1 y 3 no son extremos, así que solo
    // redondean el lado que da a la tarjeta abierta.
    const before = itemChrome(1, 5, 2);
    const open = itemChrome(2, 5, 2);
    const after = itemChrome(3, 5, 2);

    expect(before.borderTop).toBe(0);
    expect(before.borderBottom).toBe(1);
    expect(before.radius).toEqual({ tl: 0, tr: 0, br: 20, bl: 20 });

    expect(open.radius).toEqual({ tl: 20, tr: 20, br: 20, bl: 20 });
    expect(open.marginBlock).toBe(10);
    expect(open.borderTop).toBe(1);
    expect(open.borderBottom).toBe(1);

    expect(after.borderTop).toBe(1);
    expect(after.borderBottom).toBe(0);
    expect(after.radius).toEqual({ tl: 20, tr: 20, br: 0, bl: 0 });
  });

  it('un vecino que además es extremo queda «solo» y se redondea entero', () => {
    // Abierto el del medio de tres: el 0 es primero y va antes del abierto.
    expect(itemChrome(0, 3, 1).radius).toEqual({ tl: 20, tr: 20, br: 20, bl: 20 });
    expect(itemChrome(2, 3, 1).radius).toEqual({ tl: 20, tr: 20, br: 20, bl: 20 });
    // Y los bordes: el primero conserva el superior, el último el inferior.
    expect(itemChrome(0, 3, 1).borderTop).toBe(1);
    expect(itemChrome(0, 3, 1).borderBottom).toBe(1);
    expect(itemChrome(2, 3, 1).borderBottom).toBe(1);
    expect(itemChrome(2, 3, 1).borderTop).toBe(1);
  });

  it('la primera abierta deja a la siguiente con esquinas superiores', () => {
    expect(itemChrome(1, 3, 0).radius).toEqual({ tl: 20, tr: 20, br: 0, bl: 0 });
    expect(itemChrome(0, 3, 0).radius).toEqual({ tl: 20, tr: 20, br: 20, bl: 20 });
  });

  it('en una lista de dos, la abierta deja «sola» a la otra y se redondea entera', () => {
    // índice 1 es el último y va después de la abierta → isAlone.
    expect(itemChrome(1, 2, 0).radius).toEqual({ tl: 20, tr: 20, br: 20, bl: 20 });
    expect(itemChrome(0, 2, 1).radius).toEqual({ tl: 20, tr: 20, br: 20, bl: 20 });
  });
});
