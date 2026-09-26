// Ajustes de la GUI (T1.6). Los valores por defecto salen de `herdr
// --default-config` (fixture en tests/fixtures/default-config.toml); en F3 se
// leerán de config.toml + %APPDATA%\herdr-desk\settings.json y aquí solo quedarán
// los que son exclusivos de la GUI (glass, LRU de terminales, etc.).

import {
  DEFAULT_AGENT_ROWS,
  DEFAULT_AGENT_ROW_GAP,
  type AgentTokenSpec,
} from '../agents/agentPanel';

export type GlassMode = 'auto' | 'full' | 'off';
export type SidebarCollapsedMode = 'compact' | 'hidden';
export type TabBarPosition = 'top' | 'bottom';
export type AgentPanelSort = 'spaces' | 'priority';

/** Reparto de notificaciones de herdr (`[ui.toast] delivery`). */
export type ToastDelivery = 'off' | 'herdr' | 'terminal' | 'system';

/** Filas de un agente en el panel: array de filas y cada fila un array de tokens. */
export type AgentRowsConfig = AgentTokenSpec[][];

export interface UiSettings {
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
  // Solo de la GUI (F3 las moverá a settings.json)
  glass: GlassMode;
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
  /** `[ui.toast] delay_seconds`: lo que se espera para agrupar una ráfaga. */
  toast_group_ms: number;
  /** `[ui.sound] enabled` de herdr: ÚNICO interruptor de los sonidos de aviso. */
  sound_enabled: boolean;
  /** Ids de los últimos comandos ejecutados en la paleta (los más nuevos delante). */
  palette_recent: string[];
}

/** Valores por defecto, tomados del `--default-config` de herdr 0.8.0-preview. */
export const UI_SETTINGS_DEFAULTS: UiSettings = {
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

const STORAGE_KEY = 'herdr-desk.settings';

/** Ancho de la sidebar en píxeles (herdr cuenta columnas de terminal). */
export function sidebarWidthPx(values: UiSettings): number {
  const columns = Math.min(
    values.sidebar_max_width,
    Math.max(values.sidebar_min_width, values.sidebar_width),
  );
  return Math.round(columns * 9.2);
}

class SettingsStore {
  values = $state<UiSettings>({ ...UI_SETTINGS_DEFAULTS });
  /** false cuando el backend avisa que Mica no está disponible (Windows 10). */
  micaAvailable = $state(true);

  load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<UiSettings>;
      const next = { ...UI_SETTINGS_DEFAULTS };
      for (const key of Object.keys(UI_SETTINGS_DEFAULTS) as (keyof UiSettings)[]) {
        const value = parsed[key];
        if (value !== undefined && typeof value === typeof UI_SETTINGS_DEFAULTS[key]) {
          // @ts-expect-error índice dinámico sobre un objeto homogéneo por clave
          next[key] = value;
        }
      }
      this.values = next;
    } catch {
      // Preferencias corruptas: se sigue con los valores por defecto.
    }
  }

  persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      // Sin localStorage la GUI funciona igual; solo no recuerda preferencias.
    }
  }

  set<K extends keyof UiSettings>(key: K, value: UiSettings[K]): void {
    this.values[key] = value;
    this.persist();
  }

  reset(): void {
    this.values = { ...UI_SETTINGS_DEFAULTS };
    this.persist();
  }

  get sidebarCollapsedMode(): SidebarCollapsedMode {
    return this.values.sidebar_collapsed_mode;
  }

  get widthPx(): number {
    return sidebarWidthPx(this.values);
  }

  /** Escribe los atributos que consumen tokens.css y app.css. */
  applyTheme(mica = this.micaAvailable): void {
    this.micaAvailable = mica;
    const root = document.documentElement;
    const mode = this.values.glass;
    root.dataset.glass = mode === 'off' ? 'off' : mode === 'full' ? 'force' : 'on';
    root.dataset.mica = mica ? 'on' : 'off';
    root.lang = 'es';
    root.style.setProperty(
      '--accent',
      this.values.accent === 'cyan' ? 'var(--teal)' : this.values.accent,
    );
  }
}

export const settings = new SettingsStore();
