// T4.7 — El build falla si un método del schema no está clasificado.

import { describe, expect, it } from 'vitest';

import { COVERAGE, curatedRoutes } from './coverage';
import { METHOD_NAMES } from './methods.gen';

describe('cobertura de métodos', () => {
  it('clasifica exactamente los 90 métodos del schema', () => {
    expect(METHOD_NAMES.length).toBe(90);
    expect(Object.keys(COVERAGE).sort()).toEqual([...METHOD_NAMES].sort());
  });

  it('cada entrada es curated:<ruta> o console', () => {
    for (const [method, value] of Object.entries(COVERAGE)) {
      expect(value, method).toMatch(/^(console|curated:[a-z][a-z-]*)$/);
    }
  });

  it('las rutas curadas usan el nombre de la feature, sin barras', () => {
    for (const route of curatedRoutes()) {
      expect(route).not.toContain('/');
    }
  });

  it('la consola cubre los métodos sin UI dedicada', () => {
    const consoleMethods = Object.entries(COVERAGE)
      .filter(([, value]) => value === 'console')
      .map(([method]) => method);
    // Los métodos sin superficie propia son pocos y deliberados.
    expect(consoleMethods.sort()).toEqual(
      [
        'events.wait',
        'pane.current',
        'pane.edges',
        'pane.get',
        'pane.layout',
        'pane.neighbor',
        'tab.get',
        'workspace.get',
      ].sort(),
    );
  });
});
