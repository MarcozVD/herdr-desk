import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  bindingLabel,
  chordFromEvent,
  chordId,
  normalizeKeyName,
  parseBinding,
  parseChord,
  parseIndexedRange,
} from './parse';

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

describe('parseChord', () => {
  it('parsea teclas con modificadores', () => {
    expect(parseChord('ctrl+b')).toEqual({
      key: 'b',
      ctrl: true,
      shift: false,
      alt: false,
      meta: false,
    });
    expect(parseChord('ctrl+shift+n')).toMatchObject({ key: 'n', ctrl: true, shift: true });
    expect(parseChord('alt+enter')).toEqual({
      key: 'Enter',
      ctrl: false,
      shift: false,
      alt: true,
      meta: false,
    });
  });

  it('reconoce nombres de puntuación y teclas especiales', () => {
    expect(parseChord('minus')?.key).toBe('-');
    expect(parseChord('comma')?.key).toBe(',');
    expect(parseChord('plus')?.key).toBe('+');
    expect(parseChord('backtick')?.key).toBe('`');
    expect(parseChord('esc')?.key).toBe('Escape');
    expect(parseChord('up')?.key).toBe('ArrowUp');
    expect(parseChord('f5')?.key).toBe('F5');
  });

  it('devuelve null sin tecla', () => {
    expect(parseChord('ctrl')).toBeNull();
    expect(parseChord('')).toBeNull();
  });
});

describe('parseBinding', () => {
  it('distingue prefix de directo', () => {
    expect(parseBinding('prefix+c')).toMatchObject({ prefix: true, chord: { key: 'c' } });
    expect(parseBinding('ctrl+alt+n')).toMatchObject({
      prefix: false,
      chord: { key: 'n', ctrl: true, alt: true },
    });
    expect(parseBinding('prefix+shift+t')).toMatchObject({
      prefix: true,
      chord: { key: 't', shift: true },
    });
  });

  it('un binding vacío no es un atajo', () => {
    expect(parseBinding('')).toBeNull();
    expect(parseBinding('   ')).toBeNull();
  });
});

describe('parseIndexedRange', () => {
  it('parsea rangos con prefijo', () => {
    const range = parseIndexedRange('prefix+1..9');
    expect(range).toMatchObject({ prefix: true, from: 1, to: 9 });
    expect(range?.chord.key).toBe('1');
  });

  it('parsea rangos con modificadores', () => {
    const range = parseIndexedRange('ctrl+shift+1..9');
    expect(range).toMatchObject({ prefix: false, from: 1, to: 9 });
    expect(range?.chord.ctrl).toBe(true);
    expect(range?.chord.shift).toBe(true);
  });

  it('rechaza lo que no es un rango', () => {
    expect(parseIndexedRange('prefix+c')).toBeNull();
    expect(parseIndexedRange('1..9')).toBeNull();
  });
});

describe('chordFromEvent', () => {
  it('normaliza letras a minúscula conservando shift', () => {
    expect(chordId(chordFromEvent(fakeEvent({ key: 'N', ctrlKey: true, shiftKey: true })))).toBe(
      'ctrl+shift+n',
    );
  });

  it('un símbolo ya consume el shift', () => {
    // '?' requiere shift en el teclado, pero el binding es `prefix+?`.
    expect(chordId(chordFromEvent(fakeEvent({ key: '?' })))).toBe('?');
    expect(chordId(chordFromEvent(fakeEvent({ key: '?', shiftKey: true })))).toBe('?');
  });

  it('esc y flechas se normalizan', () => {
    expect(chordId(chordFromEvent(fakeEvent({ key: 'Escape' })))).toBe('escape');
    expect(chordId(chordFromEvent(fakeEvent({ key: 'ArrowUp' })))).toBe('arrowup');
  });
});

describe('normalizeKeyName', () => {
  it('acepta alias de herdr', () => {
    expect(normalizeKeyName('backtick')).toBe('`');
    expect(normalizeKeyName('pageup')).toBe('PageUp');
    expect(normalizeKeyName('space')).toBe(' ');
  });
});

describe('bindingLabel', () => {
  it('compone una etiqueta legible', () => {
    expect(bindingLabel('prefix+shift+n', 'ctrl+b')).toBe('Ctrl + B + Shift + N');
    expect(bindingLabel('prefix+?', 'ctrl+b')).toBe('Ctrl + B + ?');
    expect(bindingLabel('prefix+minus', 'ctrl+b')).toBe('Ctrl + B + −');
  });
});

describe('fixture de --default-config', () => {
  const fixturePath = resolve(process.cwd(), 'tests/fixtures/default-config.toml');
  const lines = readFileSync(fixturePath, 'utf-8').split('\n');

  function defaultKeys(): Record<string, string> {
    const out: Record<string, string> = {};
    let inKeys = false;
    for (const line of lines) {
      if (/^\[keys\]/.test(line)) {
        inKeys = true;
        continue;
      }
      // Las secciones siguientes también están comentadas (# [keys.indexed],
      // # [worktrees]) y los comandos personalizados traen sus propias claves
      // (# type, # key, # command): ahí termina la sección de atajos.
      if (inKeys && /^#?\s*\[/.test(line)) break;
      if (inKeys && /^#\s*(Custom commands|Legacy indexed)/.test(line)) break;
      if (!inKeys) continue;
      const match = line.match(/^#\s*([a-z_]+)\s*=\s*"([^"]*)"/);
      if (match) out[match[1] as string] = match[2] as string;
    }
    return out;
  }

  it('el fixture trae los atajos por defecto de herdr', () => {
    const keys = defaultKeys();
    expect(Object.keys(keys).length).toBeGreaterThanOrEqual(45);
    expect(keys.prefix).toBe('ctrl+b');
    expect(keys.new_tab).toBe('prefix+c');
    expect(keys.split_horizontal).toBe('prefix+minus');
    expect(keys.switch_tab).toBe('prefix+1..9');
  });

  it('todos los atajos del fixture están en la tabla del motor', async () => {
    const { DEFAULT_KEYBINDINGS } = await import('./keymap');
    const keys = defaultKeys();
    // `prefix` es la tecla de prefix (ajuste aparte), no una acción.
    const actions = Object.keys(keys).filter((action) => action !== 'prefix');
    const missing = actions.filter((action) => !(action in DEFAULT_KEYBINDINGS));
    expect(missing).toEqual([]);
  });

  it('la tabla del motor no inventa atajos que herdr no tenga', async () => {
    const { DEFAULT_KEYBINDINGS } = await import('./keymap');
    const keys = defaultKeys();
    const extra = Object.keys(DEFAULT_KEYBINDINGS).filter((action) => !(action in keys));
    expect(extra).toEqual([]);
  });
});
