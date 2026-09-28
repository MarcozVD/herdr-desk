// T3.6 — Overrides del keymap desde config.toml.

import { describe, expect, it } from 'vitest';

import type { ConfigEntry } from '../settings/spec';
import { keymapOverridesFromEntries } from './config';
import { Keymap } from './keymap';

function entry(path: string, value: string): ConfigEntry {
  return { path, value, origin: 'file', description: null, in_defaults: true };
}

describe('keymapOverridesFromEntries', () => {
  it('extrae prefix, acciones e indexed', () => {
    const overrides = keymapOverridesFromEntries([
      entry('keys.prefix', '"ctrl+a"'),
      entry('keys.help', '"prefix+alt+h"'),
      entry('keys.new_tab', '""'),
      entry('keys.indexed.tabs', '"ctrl"'),
      entry('keys.command.key', '"prefix+alt+t"'),
      entry('keys.command.type', '"popup"'),
      entry('ui.sidebar_width', '26'),
    ]);
    expect(overrides.prefix).toBe('ctrl+a');
    expect(overrides.bindings).toEqual({ help: 'prefix+alt+h', new_tab: '' });
    expect(overrides.indexed).toEqual({ tabs: 'ctrl' });
  });

  it('omite claves que no son strings TOML', () => {
    const overrides = keymapOverridesFromEntries([entry('keys.help', '42')]);
    expect(overrides.bindings).toEqual({});
    expect(overrides.indexed).toBeUndefined();
  });

  it('el motor aplica los overrides (binding y conflicto)', () => {
    const map = new Keymap();
    map.load(
      keymapOverridesFromEntries([
        entry('keys.help', '"prefix+shift+h"'),
        entry('keys.new_tab', '"prefix+shift+h"'),
      ]),
    );
    expect(map.bindingOf('help')).toBe('prefix+shift+h');
    const conflicts = map.conflicts();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].actions.sort()).toEqual(['help', 'new_tab']);
  });

  it('vaciar un atajo lo quita del lookup', () => {
    const map = new Keymap();
    map.load(keymapOverridesFromEntries([entry('keys.help', '""')]));
    expect(map.bindingOf('help')).toBeNull();
  });
});
