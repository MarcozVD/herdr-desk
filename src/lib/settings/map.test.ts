// T3.5 — Puente config.toml ↔ ajustes GUI: parseo TOML, valores editables y
// traducción de entradas de `config_read` a `UiSettings`.

import { describe, expect, it } from 'vitest';

import type { ConfigEntry } from './spec';
import {
  displayValue,
  parseTomlValue,
  payloadToSections,
  serializeValue,
  toTomlScalar,
} from './spec';
import {
  applyGuiValues,
  applyHerdrEntries,
  configChangeFor,
  guiValuesFromSettings,
  GUI_KEYS,
  HERDR_PATHS,
} from './map';
import { UI_SETTINGS_DEFAULTS, type UiSettings } from '../stores/settings.svelte';

function entry(path: string, value: string, origin: 'file' | 'default' = 'file'): ConfigEntry {
  return { path, value, origin, description: null, in_defaults: true };
}

describe('valores TOML', () => {
  it('parsea escalares, arrays y literales', () => {
    expect(parseTomlValue('"compact"')).toBe('compact');
    expect(parseTomlValue("'literal'")).toBe('literal');
    expect(parseTomlValue('true')).toBe(true);
    expect(parseTomlValue('false')).toBe(false);
    expect(parseTomlValue('42')).toBe(42);
    expect(parseTomlValue('-3.5')).toBe(-3.5);
    expect(parseTomlValue('[["state_icon", "agent"]]')).toEqual([['state_icon', 'agent']]);
    expect(parseTomlValue('{ "hd-bot" = [["state_icon"]] }')).toEqual({
      'hd-bot': [['state_icon']],
    });
    expect(parseTomlValue('{ hd-bot = [["state_icon"]] }')).toEqual({ 'hd-bot': [['state_icon']] });
    expect(parseTomlValue('una palabra suelta')).toBeNull();
    expect(parseTomlValue('')).toBeNull();
  });

  it('serializa strings con comillas', () => {
    expect(toTomlScalar('nord')).toBe('"nord"');
    expect(toTomlScalar(true)).toBe('true');
    expect(toTomlScalar(3)).toBe('3');
  });

  it('displayValue y serializeValue hacen roundtrip por tipo', () => {
    expect(displayValue('string', '"nord"')).toBe('nord');
    expect(displayValue('boolean', 'true')).toBe('true');
    expect(displayValue('integer', '26')).toBe('26');
    expect(displayValue('array', '[["a"]]')).toBe('[["a"]]');
    expect(serializeValue('string', 'nord')).toBe('"nord"');
    expect(serializeValue('string', '')).toBe('""');
    expect(serializeValue('integer', '')).toBeNull();
    expect(serializeValue('boolean', 'false')).toBe('false');
    expect(serializeValue('boolean', 'quizá')).toBeNull();
  });
});

describe('applyHerdrEntries', () => {
  it('traduce las claves conocidas y respeta los defaults', () => {
    const entries = [
      entry('ui.sidebar_width', '40'),
      entry('ui.confirm_close', 'false'),
      entry('ui.tab_bar_position', '"bottom"'),
      entry('ui.toast.delay_seconds', '2'),
      entry('ui.sound.enabled', 'false'),
      entry('ui.sidebar.agents.rows', '[["agent"]]'),
    ];
    const next = applyHerdrEntries(UI_SETTINGS_DEFAULTS, entries);
    expect(next.sidebar_width).toBe(40);
    expect(next.confirm_close).toBe(false);
    expect(next.tab_bar_position).toBe('bottom');
    expect(next.toast_group_ms).toBe(2000);
    expect(next.sound_enabled).toBe(false);
    expect(next.agent_rows).toEqual([['agent']]);
    // sin entradas, el resto queda igual
    expect(next.sidebar_max_width).toBe(UI_SETTINGS_DEFAULTS.sidebar_max_width);
  });

  it('ignora valores de enum inválidos y tipos raros', () => {
    const entries = [
      entry('ui.sidebar_collapsed_mode', '"lo-que-sea"'),
      entry('ui.sidebar_width', '"ancho"'),
      entry('ui.pane_gaps', 'no-es-bool'),
    ];
    const next = applyHerdrEntries(UI_SETTINGS_DEFAULTS, entries);
    expect(next.sidebar_collapsed_mode).toBe(UI_SETTINGS_DEFAULTS.sidebar_collapsed_mode);
    expect(next.sidebar_width).toBe(UI_SETTINGS_DEFAULTS.sidebar_width);
    expect(next.pane_gaps).toBe(UI_SETTINGS_DEFAULTS.pane_gaps);
  });
});

describe('configChangeFor', () => {
  it('genera el cambio TOML de un escalar', () => {
    expect(configChangeFor('sound_enabled', false)).toEqual({
      path: 'ui.sound.enabled',
      value: 'false',
    });
    expect(configChangeFor('accent', 'blue')).toEqual({ path: 'ui.accent', value: '"blue"' });
  });

  it('convierte toast_group_ms a delay_seconds', () => {
    expect(configChangeFor('toast_group_ms', 3000)).toEqual({
      path: 'ui.toast.delay_seconds',
      value: '3',
    });
  });

  it('no genera cambios para claves GUI ni estructuras', () => {
    expect(configChangeFor('glass', 'off')).toBeNull();
    expect(configChangeFor('agent_rows', [['agent']])).toBeNull();
  });
});

describe('ajustes de la GUI (settings.json)', () => {
  it('extrae solo las claves GUI', () => {
    const gui = guiValuesFromSettings(UI_SETTINGS_DEFAULTS);
    expect(Object.keys(gui).sort()).toEqual([...GUI_KEYS].sort());
    expect(gui.glass).toBe('auto');
    expect('sidebar_width' in gui).toBe(false);
  });

  it('aplica con validación de tipo y enum', () => {
    const next = applyGuiValues(UI_SETTINGS_DEFAULTS, {
      glass: 'off',
      webgl: false,
      terminal_lru_max: 20,
      palette_recent: ['a', 3, 'b'],
      sidebar_width: 99, // no es clave GUI: se ignora
      sync_focus_with_tui: 'sí', // tipo incorrecto: se ignora
      bridge_grace_ms: 1500,
    });
    expect(next.glass).toBe('off');
    expect(next.webgl).toBe(false);
    expect(next.terminal_lru_max).toBe(20);
    expect(next.palette_recent).toEqual(['a', 'b']);
    expect(next.bridge_grace_ms).toBe(1500);
    expect(next.sidebar_width).toBe(UI_SETTINGS_DEFAULTS.sidebar_width);
    expect(next.sync_focus_with_tui).toBe(false);
  });

  it('un archivo corrupto no rompe: se quedan los defaults', () => {
    const next = applyGuiValues(UI_SETTINGS_DEFAULTS, { glass: 7, webgl: 'no' });
    expect(next).toEqual(UI_SETTINGS_DEFAULTS);
  });
});

describe('payloadToSections', () => {
  it('traduce el payload snake_case del backend', () => {
    const sections = payloadToSections({
      sections: [
        {
          path: '',
          table_array: false,
          description: 'raíz',
          keys: [{ key: 'onboarding', value: 'true', active: false, description: 'ayuda' }],
        },
        {
          path: 'keys.command',
          table_array: true,
          description: '',
          keys: [{ key: 'key', value: '"prefix+alt+g"', active: false, description: '' }],
        },
      ],
    });
    expect(sections[0].keys[0]).toMatchObject({ key: 'onboarding', type: 'boolean' });
    expect(sections[1].tableArray).toBe(true);
    expect(sections[1].keys[0].type).toBe('string');
  });
});

describe('tipado de UiSettings', () => {
  it('el mapa de rutas cubre todas las claves de herdr previstas', () => {
    const mapped: (keyof UiSettings)[] = [
      'sidebar_width',
      'sidebar_min_width',
      'sidebar_max_width',
      'sidebar_start_collapsed',
      'sidebar_collapsed_mode',
      'mouse_scroll_lines',
      'confirm_close',
      'prompt_new_tab_name',
      'prompt_new_workspace_name',
      'pane_borders',
      'pane_scrollbars',
      'pane_gaps',
      'hide_tab_bar_when_single_tab',
      'tab_bar_position',
      'agent_panel_sort',
      'agent_rows',
      'agent_rows_by_agent',
      'agent_row_gap',
      'accent',
      'copy_on_select',
      'toast_delivery',
      'toast_group_ms',
      'sound_enabled',
    ];
    for (const key of mapped) {
      expect(HERDR_PATHS[key], `sin ruta para ${key}`).toBeDefined();
    }
  });
});
