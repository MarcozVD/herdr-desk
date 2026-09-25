import { describe, expect, it } from 'vitest';

import { DEFAULT_KEYBINDINGS, DEFAULT_PREFIX_KEY, GUI_RESERVED, Keymap } from './keymap';

function fakeEvent(init: {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}): KeyboardEvent {
  return {
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    metaKey: init.metaKey ?? false,
  } as KeyboardEvent;
}

describe('Keymap', () => {
  const map = new Keymap();
  map.load();

  it('carga los atajos por defecto sin conflictos', () => {
    expect(map.conflicts()).toEqual([]);
    expect(map.entries.length).toBeGreaterThanOrEqual(35);
    expect(map.prefixKey).toBe(DEFAULT_PREFIX_KEY);
  });

  it('omite los atajos vacíos (los que herdr deja sin asignar)', () => {
    expect(map.bindingOf('open_worktree')).toBeNull();
    expect(map.entries.some((entry) => entry.action === 'open_worktree')).toBe(false);
  });

  it('resuelve atajos con prefix', () => {
    expect(map.resolveForEvent(fakeEvent({ key: 'c' }), true)).toEqual({
      action: 'new_tab',
    });
    expect(map.resolveForEvent(fakeEvent({ key: '?', shiftKey: true }), true)).toEqual({
      action: 'help',
    });
    expect(map.resolveForEvent(fakeEvent({ key: '-' }), true)).toEqual({
      action: 'split_horizontal',
    });
  });

  it('no resuelve atajos de prefix si el prefix no está activo', () => {
    expect(map.resolveForEvent(fakeEvent({ key: 'c' }), false)).toBeNull();
  });

  it('los atajos de navigate NO se capturan fuera del modo navegar', () => {
    // Si se capturaran, las flechas y h/j/k/l dejarían de llegar a la terminal.
    expect(map.resolveForEvent(fakeEvent({ key: 'ArrowUp' }), false)).toBeNull();
    expect(map.resolveForEvent(fakeEvent({ key: 'j' }), false)).toBeNull();
    expect(map.navigateEntries.length).toBeGreaterThanOrEqual(6);
    expect(map.activeEntries.some((entry) => entry.scope === 'navigate')).toBe(false);
  });

  it('remote_image_paste (solo --remote) tampoco se captura', () => {
    expect(map.resolveForEvent(fakeEvent({ key: 'v', ctrlKey: true }), false)).toBeNull();
    expect(map.bindingOf('remote_image_paste')).toBe('ctrl+v');
  });

  it('los dígitos con prefix resuelven switch_tab', () => {
    expect(map.resolveForEvent(fakeEvent({ key: '3' }), true)).toEqual({
      action: 'switch_tab:3',
    });
    expect(map.resolveForEvent(fakeEvent({ key: '0' }), true)).toBeNull();
  });

  it('prefix dos veces devuelve literalPrefix (manda el ctrl+b al panel)', () => {
    expect(map.resolveForEvent(fakeEvent({ key: 'b', ctrlKey: true }), true)).toEqual({
      literalPrefix: true,
    });
  });

  it('una tecla cualquiera no resuelve nada (va a la terminal)', () => {
    expect(map.resolveForEvent(fakeEvent({ key: 'a' }), false)).toBeNull();
    expect(map.resolveForEvent(fakeEvent({ key: 'Enter' }), false)).toBeNull();
    expect(map.resolveForEvent(fakeEvent({ key: 'q', ctrlKey: true }), true)).toBeNull();
  });

  it('detecta la tecla de prefix', () => {
    expect(map.isPrefixKey(fakeEvent({ key: 'b', ctrlKey: true }))).toBe(true);
    expect(map.isPrefixKey(fakeEvent({ key: 'b' }))).toBe(false);
  });

  it('los atajos globales de la GUI se resuelven aparte', () => {
    expect(map.resolveGuiShortcut(fakeEvent({ key: 'P', ctrlKey: true, shiftKey: true }))).toBe(
      'gui.palette',
    );
    expect(map.resolveGuiShortcut(fakeEvent({ key: 'c', ctrlKey: true, shiftKey: true }))).toBe(
      'gui.copy',
    );
    expect(map.resolveGuiShortcut(fakeEvent({ key: 'a', ctrlKey: true }))).toBeNull();
    expect(GUI_RESERVED).toHaveLength(3);
  });

  it('detecta conflictos al cargar overrides', () => {
    const custom = new Keymap();
    custom.load({ bindings: { new_tab: 'prefix+x' } });
    const conflicts = custom.conflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.actions.sort()).toEqual(['close_pane', 'new_tab']);
  });

  it('acepta overrides de la tecla de prefix y de indexed', () => {
    const custom = new Keymap();
    custom.load({ prefix: 'ctrl+a', indexed: { tabs: 'ctrl' } });
    expect(custom.prefixKey).toBe('ctrl+a');
    expect(custom.indexed.tabs?.scope).toBe('direct');
    expect(custom.resolveForEvent(fakeEvent({ key: '2', ctrlKey: true }), false)).toEqual({
      action: 'switch_tab:2',
    });
  });

  it('la tabla por defecto cubre todas las acciones del Anexo B que aplican a la GUI', () => {
    const expected = [
      'new_workspace',
      'rename_workspace',
      'close_workspace',
      'new_tab',
      'rename_tab',
      'close_tab',
      'rename_pane',
      'split_vertical',
      'split_horizontal',
      'close_pane',
      'zoom',
      'toggle_sidebar',
    ];
    for (const action of expected) {
      expect(action in DEFAULT_KEYBINDINGS).toBe(true);
      expect(map.bindingOf(action)).not.toBeNull();
    }
  });
});
