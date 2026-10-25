// T4.7 — El build falla si un método del schema no está clasificado.

import { describe, expect, it } from 'vitest';

import { COVERAGE, curatedRoutes } from './coverage';
import { METHOD_NAMES } from './methods.gen';

describe('cobertura de métodos', () => {
  it('clasifica exactamente los 102 métodos del schema', () => {
    expect(METHOD_NAMES.length).toBe(102);
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
        'client_shell.surface.set',
        'command.invoke',
        'events.wait',
        'pane.clear',
        'pane.copy_motion',
        'pane.copy_search',
        'pane.current',
        'pane.edit_scrollback',
        'pane.edges',
        'pane.get',
        'pane.input.set',
        'pane.layout',
        'pane.link.activate',
        'pane.link.resolve',
        'pane.neighbor',
        'pane.scroll',
        'pane.selection.read',
        'product_announcement.dismiss',
        'release_notes.dismiss',
        'server.ssh_agent.register',
        'tab.get',
        'workspace.get',
      ].sort(),
    );
  });
});
