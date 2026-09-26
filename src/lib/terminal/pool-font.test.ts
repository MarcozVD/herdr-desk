// @vitest-environment jsdom
// El pool crea instancias reales de xterm: en jsdom hay que darle `matchMedia`
// (lo consulta al abrirse) y el contenedor para `fit`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

import { setTerminalFont } from './font';
import { pool } from './pool';

/** Monta la vista de un panel y devuelve su instancia de xterm (+fit). */
function mount(paneId: string) {
  const host = document.createElement('div');
  document.body.append(host);
  const entry = pool.mountView(paneId, host);
  if (!entry.view) throw new Error('sin vista');
  return entry.view;
}

const STACK_COMPLETA = "'Cascadia Code', 'Cascadia Mono', Consolas, monospace";

beforeEach(() => {
  setTerminalFont({
    family: STACK_COMPLETA,
    size: 13,
    lineHeight: 1,
    source: 'local',
  });
});

afterEach(() => {
  pool.disposeAll();
});

describe('tipografía de las instancias de xterm', () => {
  it('la terminal nace con una pila real de familias, no con `var(--font-mono)`', () => {
    const view = mount('w1:p1');
    expect(view.terminal.options.fontFamily).toBe(STACK_COMPLETA);
    expect(view.terminal.options.fontFamily).not.toContain('var(');
    expect(view.terminal.options.fontSize).toBe(13);
    expect(view.terminal.options.lineHeight).toBe(1);
  });

  it('usa el preset del backend cuando ya se resolvió', () => {
    setTerminalFont({
      family: "'Consolas', 'Cascadia Mono', monospace",
      size: 14,
      lineHeight: 1.3,
      source: 'backend',
    });
    const view = mount('w1:p2');
    expect(view.terminal.options.fontFamily).toBe("'Consolas', 'Cascadia Mono', monospace");
    expect(view.terminal.options.fontSize).toBe(14);
    expect(view.terminal.options.lineHeight).toBe(1.3);
  });

  it('applyFont repinta las instancias vivas y reajusta las celdas (fit)', () => {
    const view = mount('w1:p3');
    const fitSpy = vi.spyOn(view.fit, 'fit');
    // El contenedor no tiene tamaño en jsdom: `fit` avisa y se ignora.
    fitSpy.mockImplementation(() => undefined);

    pool.applyFont({
      family: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
      size: 15,
      lineHeight: 1.35,
      source: 'backend',
    });

    expect(view.terminal.options.fontFamily).toBe(STACK_COMPLETA);
    expect(view.terminal.options.fontSize).toBe(15);
    expect(view.terminal.options.lineHeight).toBe(1.35);
    expect(fitSpy).toHaveBeenCalledTimes(1);
  });

  it('applyFont no toca nada si el preset es el mismo (evita repintar de más)', () => {
    const view = mount('w1:p4');
    const fitSpy = vi.spyOn(view.fit, 'fit');
    fitSpy.mockImplementation(() => undefined);

    pool.applyFont({ family: STACK_COMPLETA, size: 13, lineHeight: 1, source: 'local' });

    expect(fitSpy).not.toHaveBeenCalled();
  });

  it('refitAll reajusta todas las instancias vivas', () => {
    const a = mount('w1:p5');
    const b = mount('w1:p6');
    const spyA = vi.spyOn(a.fit, 'fit').mockImplementation(() => undefined);
    const spyB = vi.spyOn(b.fit, 'fit').mockImplementation(() => undefined);

    pool.refitAll();

    expect(spyA).toHaveBeenCalledTimes(1);
    expect(spyB).toHaveBeenCalledTimes(1);
  });
});
