// Ajustes de la GUI (T1.6, F3/T3.5). Los valores que herdr conoce (sidebar, UI,
// sonidos, toasts) se leen de `config.toml` con `config_read` y se persisten con
// `config_write`; los exclusivos de la GUI viven en
// %APPDATA%\herdr-desk\settings.json (commands `gui_settings_read/write`).
// Ya no se usa localStorage: la config de herdr es la única fuente de verdad y
// el settings.json solo guarda lo que el server no sabe (glass, WebGL, LRU…).

import { configRead, configWrite, guiSettingsRead, guiSettingsWrite } from '../herdr/client';
import {
  applyGuiValues,
  applyHerdrEntries,
  configChangeFor,
  GUI_KEYS,
  guiValuesFromSettings,
} from '../settings/map';
import type { AgentTokenSpec } from '../agents/agentPanel';
import { DEFAULT_AGENT_ROWS, DEFAULT_AGENT_ROW_GAP } from '../agents/agentPanel';
import type { ConfigEntry } from '../settings/spec';
import { applyThemeToDocument } from '../theme/apply';
import { applyGlassLevel, GLASS_LEVEL_DEFAULT } from '../theme/glass';

export type GlassMode = 'auto' | 'full' | 'off';
/** Material de Windows detrás de la ventana: Mica (tinte del fondo de
 *  escritorio) o Acrílico (desenfoque en vivo de lo que hay detrás). */
export type BackdropMode = 'mica' | 'acrylic';
export type SidebarCollapsedMode = 'compact' | 'hidden';
export type TabBarPosition = 'top' | 'bottom';
export type AgentPanelSort = 'spaces' | 'priority';

/** Reparto de notificaciones de herdr (`[ui.toast] delivery`). */
export type ToastDelivery = 'off' | 'herdr' | 'terminal' | 'system';

/** Filas de un agente en el panel: array de filas y cada fila un array de tokens. */
export type AgentRowsConfig = AgentTokenSpec[][];

export interface UiSettings {
  // [theme] de herdr (T3.7)
  theme_name: string;
  theme_auto_switch: boolean;
  theme_dark_name: string;
  theme_light_name: string;
  /** `[theme.custom]`: token → color (hex, nombre o rgb()). */
  theme_custom: Record<string, string>;
  /** Presets de layout guardados (T3.3): nombre → LayoutNode. */
  layout_presets: Record<string, unknown>;
  /** Líneas que se leen en «Buscar en salida» / «Esperar salida» (T3.9). */
  search_lines: number;
  // [ui] de herdr
  sidebar_width: number;
  sidebar_min_width: number;
  sidebar_max_width: number;
  sidebar_start_collapsed: boolean;
  sidebar_collapsed_mode: SidebarCollapsedMode;
  mouse_scroll_lines: number;
  confirm_close: boolean;
  prompt_new_tab_name: boolean;
  prompt_new_workspace_name: boolean;
  pane_borders: boolean;
  pane_scrollbars: boolean;
  pane_gaps: boolean;
  hide_tab_bar_when_single_tab: boolean;
  tab_bar_position: TabBarPosition;
  agent_panel_sort: AgentPanelSort;
  /** `[ui.sidebar.agents] rows`: filas de cada agente (tokens). */
  agent_rows: AgentRowsConfig;
  /** `[ui.sidebar.agents.rows_by_agent]`: filas por id canónico de agente. */
  agent_rows_by_agent: Record<string, AgentRowsConfig>;
  /** `[ui.sidebar.agents] row_gap`: filas en blanco entre agentes. */
  agent_row_gap: number;
  accent: string;
  copy_on_select: boolean;
  // Solo de la GUI (settings.json)
  glass: GlassMode;
  backdrop: BackdropMode;
  /** Cuánto cristal: 1 = casi sólido, 100 = lo más transparente. */
  glass_level: number;
  sync_focus_with_tui: boolean;
  webgl: boolean;
  webgl_max_panes: number;
  terminal_lru_max: number;
  bridge_grace_ms: number;
  /** ms que se espera al respawn del backend antes de reenganchar el bridge. */
  bridge_reopen_grace_ms: number;
  toast_ms: number;
  /** `[ui.toast] delivery` de herdr: off | herdr | terminal | system.
   *  La GUI solo puede pintar los toasts in-app (`herdr`). */
  toast_delivery: ToastDelivery;
  /** `[ui.toast] delay_seconds`: lo que se espera para agrupar una ráfaga (ms). */
  toast_group_ms: number;
  /** `[ui.sound] enabled` de herdr: ÚNICO interruptor de los sonidos de aviso. */
  sound_enabled: boolean;
  /** Ids de los últimos comandos ejecutados en la paleta (los más nuevos delante). */
  palette_recent: string[];
}

/** Valores por defecto, tomados del `--default-config` de herdr 0.8.0-preview. */
export const UI_SETTINGS_DEFAULTS: UiSettings = {
  theme_name: 'catppuccin',
  theme_auto_switch: false,
  theme_dark_name: 'catppuccin',
  theme_light_name: 'catppuccin-latte',
  theme_custom: {},
  layout_presets: {},
  search_lines: 500,
  sidebar_width: 26,
  sidebar_min_width: 18,
  sidebar_max_width: 36,
  sidebar_start_collapsed: false,
  sidebar_collapsed_mode: 'compact',
  mouse_scroll_lines: 3,
  confirm_close: true,
  prompt_new_tab_name: true,
  prompt_new_workspace_name: false,
  pane_borders: true,
  pane_scrollbars: true,
  pane_gaps: true,
  hide_tab_bar_when_single_tab: false,
  tab_bar_position: 'top',
  agent_panel_sort: 'spaces',
  agent_rows: DEFAULT_AGENT_ROWS,
  agent_rows_by_agent: {},
  agent_row_gap: DEFAULT_AGENT_ROW_GAP,
  accent: 'cyan',
  copy_on_select: true,
  glass: 'auto',
  backdrop: 'mica',
  glass_level: GLASS_LEVEL_DEFAULT,
  sync_focus_with_tui: false,
  webgl: true,
  webgl_max_panes: 8,
  terminal_lru_max: 12,
  bridge_grace_ms: 3000,
  bridge_reopen_grace_ms: 3000,
  toast_ms: 4000,
  toast_delivery: 'off',
  toast_group_ms: 1000,
  sound_enabled: true,
  palette_recent: [],
};

/** Ancho de la sidebar en píxeles (herdr cuenta columnas de terminal). */
export function sidebarWidthPx(values: UiSettings): number {
  const columns = Math.min(
    values.sidebar_max_width,
    Math.max(values.sidebar_min_width, values.sidebar_width),
  );
  return Math.round(columns * 9.2);
}

const GUI_KEY_SET: readonly (keyof UiSettings)[] = GUI_KEYS;

class SettingsStore {
  values = $state<UiSettings>({ ...UI_SETTINGS_DEFAULTS });
  /** Últimas entradas de config.toml leídas (las usa el keymap al arrancar). */
  configEntries = $state<ConfigEntry[]>([]);
  /** false cuando el backend avisa que Mica no está disponible (Windows 10). */
  micaAvailable = $state(true);
  /** Aviso de un fallo al persistir (lo conecta main.ts con los toasts). */
  onPersistError: ((message: string) => void) | null = null;

  #persistTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Carga la config real: primero los ajustes de la GUI (settings.json) y los
   * valores efectivos de config.toml. Si un command falta o falla se siguen
   * usando los defaults: la app nunca se queda sin preferencias.
   */
  async init(): Promise<void> {
    const [gui, config] = await Promise.all([guiSettingsRead(), configRead()]);
    let next = { ...this.values };
    if (gui.ok && gui.value) next = applyGuiValues(next, gui.value);
    if (config.ok && config.value) {
      next = applyHerdrEntries(next, config.value.entries);
      this.configEntries = config.value.entries;
    }
    this.values = next;
    this.applyTheme();
  }

  /** Reaplica la config de herdr (tras guardar en el formulario de ajustes). */
  applyConfigEntries(entries: readonly ConfigEntry[]): void {
    this.configEntries = [...entries];
    this.values = applyHerdrEntries({ ...this.values }, entries);
  }

  set<K extends keyof UiSettings>(key: K, value: UiSettings[K]): void {
    this.values[key] = value;
    if (GUI_KEY_SET.includes(key)) this.#schedulePersistGui();
    else this.#persistHerdr(key, value);
  }

  reset(): void {
    this.values = { ...UI_SETTINGS_DEFAULTS };
    this.#schedulePersistGui();
  }

  get sidebarCollapsedMode(): SidebarCollapsedMode {
    return this.values.sidebar_collapsed_mode;
  }

  get widthPx(): number {
    return sidebarWidthPx(this.values);
  }

  /**
   * Escribe los atributos que consumen tokens.css y app.css y aplica la paleta
   * del tema (T3.7). El nombre del tema resuelto queda en `documentElement`.
   */
  applyTheme(mica = this.micaAvailable): void {
    this.micaAvailable = mica;
    const root = document.documentElement;
    const mode = this.values.glass;
    root.dataset.glass = mode === 'off' ? 'off' : mode === 'full' ? 'force' : 'on';
    root.dataset.mica = mica ? 'on' : 'off';
    root.dataset.backdrop = this.values.backdrop;
    root.lang = 'es';
    applyThemeToDocument(this.values);
    applyGlassLevel(root, this.values.glass_level, root.dataset.theme === 'light');
  }

  get resolvedTheme(): string {
    return document.documentElement.dataset.themeName ?? 'catppuccin';
  }

  #schedulePersistGui(): void {
    if (this.#persistTimer !== null) clearTimeout(this.#persistTimer);
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = null;
      this.#persistGuiNow();
    }, 400);
  }

  #persistGuiNow(): void {
    void guiSettingsWrite(guiValuesFromSettings(this.values)).then((outcome) => {
      if (!outcome.ok && outcome.kind === 'error') this.#report(outcome.error.message);
    });
  }

  /** Persiste una clave de herdr con config_write (validación + reload). */
  #persistHerdr<K extends keyof UiSettings>(key: K, value: UiSettings[K]): void {
    const change = configChangeFor(key, value);
    if (!change) return;
    void configWrite([change]).then((outcome) => {
      if (!outcome.ok) {
        // Backend sin config_write: el valor queda solo en memoria.
        if (outcome.kind === 'error') this.#report(outcome.error.message);
        return;
      }
      const result = outcome.value;
      if (!result) return;
      if (result.rejected || result.rolled_back) {
        const detail = result.diagnostics.map((item) => item.message).join('\n');
        this.#report(detail || 'herdr rechazó el cambio de configuración.');
        return;
      }
      if (result.reload?.status === 'failed') {
        this.#report(result.reload.diagnostics.join('\n') || 'la recarga de configuración falló.');
      }
    });
  }

  #report(message: string): void {
    if (this.onPersistError) this.onPersistError(message);
  }
}

export const settings = new SettingsStore();
