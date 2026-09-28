// T3.5 — El parser de `herdr --default-config` (scripts/gen-settings.mjs) contra
// la fixture real del sandbox. El formulario de ajustes consume `config_default`
// en runtime; este test fija el contrato del codegen.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseDefaultConfig } from '../../../scripts/gen-settings.mjs';
import { SETTINGS_SECTIONS } from './settings.gen';

const fixture = readFileSync(resolve(process.cwd(), 'tests/fixtures/default-config.toml'), 'utf-8');

function section(path: string) {
  const found = parseDefaultConfig(fixture).find((s) => s.path === path);
  if (!found) throw new Error(`sin seccion ${path}`);
  return found;
}

describe('parser de settings (T3.5)', () => {
  it('parsea la fixture real de --default-config', () => {
    const sections = parseDefaultConfig(fixture);
    expect(sections.length).toBeGreaterThan(10);
    // la raiz existe porque onboarding viene comentado en la raiz
    const root = sections.find((s) => s.path === '');
    expect(root?.keys.some((k) => k.key === 'onboarding')).toBe(true);
  });

  it('extrae valor, tipo, estado y descripcion de una clave comentada', () => {
    const theme = section('theme');
    const name = theme.keys.find((k) => k.key === 'name');
    expect(name).toMatchObject({
      value: '"catppuccin"',
      active: false,
      type: 'string',
    });
    expect(name?.description).toContain('Built-in themes');
  });

  it('marca tableArray y las claves de [[keys.command]]', () => {
    const command = section('keys.command');
    expect(command.tableArray).toBe(true);
    for (const key of ['key', 'type', 'command', 'width', 'height']) {
      expect(command.keys.some((k) => k.key === key)).toBe(true);
    }
    expect(command.keys.find((k) => k.key === 'key')?.value).toBe('"prefix+alt+g"');
  });

  it('una clave activa y un numero conservan su tipo', () => {
    const experimental = section('experimental');
    expect(experimental.keys.find((k) => k.key === 'pane_history')).toMatchObject({
      value: 'false',
      active: true,
      type: 'boolean',
    });
    const ui = section('ui');
    const width = ui.keys.find((k) => k.key === 'sidebar_width');
    expect(width?.type).toBe('integer');
  });

  it('el archivo generado es valido y cubre las mismas secciones', () => {
    expect(SETTINGS_SECTIONS.length).toBe(parseDefaultConfig(fixture).length);
    expect(SETTINGS_SECTIONS.some((s) => s.path === 'theme')).toBe(true);
    expect(SETTINGS_SECTIONS.some((s) => s.path === 'keys.command' && s.tableArray)).toBe(true);
  });
});
