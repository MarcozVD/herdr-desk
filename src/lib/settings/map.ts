// T3.5 — Puente entre la configuración de herdr (config.toml) y los ajustes
// tipados de la GUI.
//
// `applyHerdrEntries` traduce `config_read.entries` (valores TOML efectivos) a
// `UiSettings`; `configChangeFor` hace lo inverso para persistir un cambio con
// `config_write`. Las claves que herdr no conoce (GUI_KEYS) se guardan aparte en
// %APPDATA%\herdr-desk\settings.json.

import type { AgentRows } from '../agents/agentPanel';
import type { GuiSettingsValues, ConfigChange, ConfigEntry } from './spec';
import { entriesByPath, parseTomlValue, toTomlScalar } from './spec';
import type { UiSettings } from '../stores/settings.svelte';

/** Ruta en config.toml de cada ajuste que herdr sí conoce. */
export const HERDR_PATHS: Partial<Record<keyof UiSettings, string>> = {
  theme_name: 'theme.name',
  theme_auto_switch: 'theme.auto_switch',
  theme_dark_name: 'theme.dark_name',
  theme_light_name: 'theme.light_name',
  sidebar_width: 'ui.sidebar_width',
  sidebar_min_width: 'ui.sidebar_min_width',
  sidebar_max_width: 'ui.sidebar_max_width',
  sidebar_start_collapsed: 'ui.sidebar_start_collapsed',
  sidebar_collapsed_mode: 'ui.sidebar_collapsed_mode',
  mouse_scroll_lines: 'ui.mouse_scroll_lines',
  confirm_close: 'ui.confirm_close',
  prompt_new_tab_name: 'ui.prompt_new_tab_name',
  prompt_new_workspace_name: 'ui.prompt_new_workspace_name',
  pane_borders: 'ui.pane_borders',
  pane_scrollbars: 'ui.pane_scrollbars',
  pane_gaps: 'ui.pane_gaps',
  hide_tab_bar_when_single_tab: 'ui.hide_tab_bar_when_single_tab',
  tab_bar_position: 'ui.tab_bar_position',
  agent_panel_sort: 'ui.agent_panel_sort',
  agent_rows: 'ui.sidebar.agents.rows',
  agent_rows_by_agent: 'ui.sidebar.agents.rows_by_agent',
  agent_row_gap: 'ui.sidebar.agents.row_gap',
  accent: 'ui.accent',
  copy_on_select: 'ui.copy_on_select',
  toast_delivery: 'ui.toast.delivery',
  toast_group_ms: 'ui.toast.delay_seconds',
  sound_enabled: 'ui.sound.enabled',
};

/** Claves exclusivas de la GUI (settings.json). */
export const GUI_KEYS = [
  'glass',
  'sync_focus_with_tui',
  'webgl',
  'webgl_max_panes',
  'terminal_lru_max',
  'bridge_grace_ms',
  'bridge_reopen_grace_ms',
  'toast_ms',
  'palette_recent',
  'layout_presets',
  'search_lines',
] as const satisfies readonly (keyof UiSettings)[];

const GLASS_MODES = ['auto', 'full', 'off'] as const;
const COLLAPSED_MODES = ['compact', 'hidden'] as const;
const TAB_POSITIONS = ['top', 'bottom'] as const;
const AGENT_SORTS = ['spaces', 'priority'] as const;
const TOAST_DELIVERIES = ['off', 'herdr', 'terminal', 'system'] as const;

function oneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/** Traduce los valores efectivos de config.toml a los ajustes tipados. */
export function applyHerdrEntries(values: UiSettings, entries: readonly ConfigEntry[]): UiSettings {
  const byPath = entriesByPath(entries);
  const read = (path: string): string | undefined => byPath.get(path)?.value;
  const num = (path: string, fallback: number): number => {
    const raw = read(path);
    if (raw === undefined) return fallback;
    const parsed = parseTomlValue(raw);
    return typeof parsed === 'number' ? parsed : fallback;
  };
  const bool = (path: string, fallback: boolean): boolean => {
    const raw = read(path);
    if (raw === undefined) return fallback;
    const parsed = parseTomlValue(raw);
    return typeof parsed === 'boolean' ? parsed : fallback;
  };
  const str = (path: string, fallback: string): string => {
    const raw = read(path);
    if (raw === undefined) return fallback;
    const parsed = parseTomlValue(raw);
    return typeof parsed === 'string' ? parsed : fallback;
  };
  const rows = (path: string, fallback: AgentRows): AgentRows => {
    const raw = read(path);
    if (raw === undefined) return fallback;
    const parsed = parseTomlValue(raw);
    return Array.isArray(parsed) ? (parsed as AgentRows) : fallback;
  };
  const rowsByAgent = (
    path: string,
    fallback: UiSettings['agent_rows_by_agent'],
  ): UiSettings['agent_rows_by_agent'] => {
    const raw = read(path);
    if (raw === undefined) return fallback;
    const parsed = parseTomlValue(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as UiSettings['agent_rows_by_agent'])
      : fallback;
  };
  const enumValue = <T extends string>(path: string, allowed: readonly T[], fallback: T): T => {
    const parsed = parseTomlValue(read(path) ?? '');
    return oneOf(allowed, parsed) ? parsed : fallback;
  };
  const custom: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.path.startsWith('theme.custom.')) continue;
    const key = entry.path.slice('theme.custom.'.length);
    if (key.includes('.')) continue;
    const parsed = parseTomlValue(entry.value);
    if (typeof parsed === 'string') custom[key] = parsed;
  }

  return {
    ...values,
    theme_name: str('theme.name', values.theme_name),
    theme_auto_switch: bool('theme.auto_switch', values.theme_auto_switch),
    theme_dark_name: str('theme.dark_name', values.theme_dark_name),
    theme_light_name: str('theme.light_name', values.theme_light_name),
    theme_custom: Object.keys(custom).length > 0 ? custom : values.theme_custom,
    sidebar_width: num('ui.sidebar_width', values.sidebar_width),
    sidebar_min_width: num('ui.sidebar_min_width', values.sidebar_min_width),
    sidebar_max_width: num('ui.sidebar_max_width', values.sidebar_max_width),
    sidebar_start_collapsed: bool('ui.sidebar_start_collapsed', values.sidebar_start_collapsed),
    sidebar_collapsed_mode: enumValue(
      'ui.sidebar_collapsed_mode',
      COLLAPSED_MODES,
      values.sidebar_collapsed_mode,
    ),
    mouse_scroll_lines: num('ui.mouse_scroll_lines', values.mouse_scroll_lines),
    confirm_close: bool('ui.confirm_close', values.confirm_close),
    prompt_new_tab_name: bool('ui.prompt_new_tab_name', values.prompt_new_tab_name),
    prompt_new_workspace_name: bool(
      'ui.prompt_new_workspace_name',
      values.prompt_new_workspace_name,
    ),
    pane_borders: bool('ui.pane_borders', values.pane_borders),
    pane_scrollbars: bool('ui.pane_scrollbars', values.pane_scrollbars),
    pane_gaps: bool('ui.pane_gaps', values.pane_gaps),
    hide_tab_bar_when_single_tab: bool(
      'ui.hide_tab_bar_when_single_tab',
      values.hide_tab_bar_when_single_tab,
    ),
    tab_bar_position: enumValue('ui.tab_bar_position', TAB_POSITIONS, values.tab_bar_position),
    agent_panel_sort: enumValue('ui.agent_panel_sort', AGENT_SORTS, values.agent_panel_sort),
    agent_rows: rows('ui.sidebar.agents.rows', values.agent_rows),
    agent_rows_by_agent: rowsByAgent('ui.sidebar.agents.rows_by_agent', values.agent_rows_by_agent),
    agent_row_gap: num('ui.sidebar.agents.row_gap', values.agent_row_gap),
    accent: str('ui.accent', values.accent),
    copy_on_select: bool('ui.copy_on_select', values.copy_on_select),
    toast_delivery: enumValue('ui.toast.delivery', TOAST_DELIVERIES, values.toast_delivery),
    // delay_seconds (herdr) ↔ toast_group_ms (GUI)
    toast_group_ms:
      read('ui.toast.delay_seconds') === undefined
        ? values.toast_group_ms
        : Math.round(num('ui.toast.delay_seconds', values.toast_group_ms / 1000) * 1000),
    sound_enabled: bool('ui.sound.enabled', values.sound_enabled),
  };
}

/** Cambio de config.toml para una clave conocida; `null` si no aplica. */
export function configChangeFor<K extends keyof UiSettings>(
  key: K,
  value: UiSettings[K],
): ConfigChange | null {
  const path = HERDR_PATHS[key];
  if (!path) return null;
  if (key === 'toast_group_ms') {
    const ms = typeof value === 'number' ? value : Number(value);
    return { path, value: String(Math.max(0, Math.round(ms / 1000))) };
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { path, value: toTomlScalar(value) };
  }
  // arrays/tablas se editan en el formulario (texto TOML), no desde un toggle
  return null;
}

/** Extrae las claves GUI de los ajustes para persistirlas en settings.json. */
export function guiValuesFromSettings(values: UiSettings): GuiSettingsValues {
  const out: GuiSettingsValues = {};
  for (const key of GUI_KEYS) out[key] = values[key];
  return out;
}

/** Aplica settings.json sobre los defaults con validación de tipo por clave. */
export function applyGuiValues(values: UiSettings, raw: GuiSettingsValues): UiSettings {
  const next = { ...values };
  for (const key of GUI_KEYS) {
    const incoming = raw[key];
    if (incoming === undefined) continue;
    switch (key) {
      case 'glass':
        if (oneOf(GLASS_MODES, incoming)) next.glass = incoming;
        break;
      case 'sync_focus_with_tui':
        if (typeof incoming === 'boolean') next.sync_focus_with_tui = incoming;
        break;
      case 'webgl':
        if (typeof incoming === 'boolean') next.webgl = incoming;
        break;
      case 'webgl_max_panes':
        if (typeof incoming === 'number') next.webgl_max_panes = incoming;
        break;
      case 'terminal_lru_max':
        if (typeof incoming === 'number') next.terminal_lru_max = incoming;
        break;
      case 'bridge_grace_ms':
        if (typeof incoming === 'number') next.bridge_grace_ms = incoming;
        break;
      case 'bridge_reopen_grace_ms':
        if (typeof incoming === 'number') next.bridge_reopen_grace_ms = incoming;
        break;
      case 'toast_ms':
        if (typeof incoming === 'number') next.toast_ms = incoming;
        break;
      case 'palette_recent':
        if (Array.isArray(incoming)) {
          next.palette_recent = incoming.filter((item): item is string => typeof item === 'string');
        }
        break;
      case 'layout_presets':
        if (incoming !== null && typeof incoming === 'object' && !Array.isArray(incoming)) {
          next.layout_presets = incoming as Record<string, unknown>;
        }
        break;
      case 'search_lines':
        if (typeof incoming === 'number') next.search_lines = incoming;
        break;
    }
  }
  return next;
}
