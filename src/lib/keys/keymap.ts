// T1.10 — Tabla de atajos. Los valores por defecto son los que herdr muestra
// comentados en `herdr --default-config` (fixture: tests/fixtures/default-config.toml);
// el test unitario compara esta tabla con el fixture para que no derive.
// En F3 el usuario los podrá editar desde Settings (config.toml → [keys]).

import {
  bindingLabel,
  chordFromEvent,
  chordId,
  parseBinding,
  parseIndexedRange,
  type KeyChord,
} from './parse';

export type KeyScope = 'prefix' | 'direct' | 'navigate';

export interface KeymapEntry {
  action: string;
  /** Valor tal cual viene de la config (p. ej. `prefix+shift+n`). */
  binding: string;
  scope: KeyScope;
  chordId: string;
}

export interface IndexedRange {
  scope: KeyScope;
  from: number;
  to: number;
  chord: KeyChord;
}

export interface KeymapOverrides {
  prefix?: string;
  bindings?: Record<string, string>;
  indexed?: Partial<Record<'tabs' | 'workspaces' | 'agents', string>>;
}

/** Defaults de herdr 0.8.0-preview (los del `--default-config`, sin comentar). */
export const DEFAULT_PREFIX_KEY = 'ctrl+b';

export const DEFAULT_KEYBINDINGS: Record<string, string> = {
  help: 'prefix+?',
  settings: 'prefix+s',
  detach: 'prefix+q',
  reload_config: 'prefix+shift+r',
  open_notification_target: 'prefix+o',
  workspace_picker: 'prefix+w',
  goto: 'prefix+g',
  new_workspace: 'prefix+shift+n',
  new_worktree: 'prefix+shift+g',
  open_worktree: '',
  remove_worktree: '',
  rename_workspace: 'prefix+shift+w',
  close_workspace: 'prefix+shift+d',
  previous_workspace: '',
  next_workspace: '',
  previous_agent: '',
  next_agent: '',
  focus_agent: '',
  remote_image_paste: 'ctrl+v',
  new_tab: 'prefix+c',
  rename_tab: 'prefix+shift+t',
  previous_tab: 'prefix+p',
  next_tab: 'prefix+n',
  switch_tab: 'prefix+1..9',
  switch_workspace: '',
  close_tab: 'prefix+shift+x',
  rename_pane: 'prefix+shift+p',
  edit_scrollback: 'prefix+e',
  focus_pane_left: 'prefix+h',
  focus_pane_down: 'prefix+j',
  focus_pane_up: 'prefix+k',
  focus_pane_right: 'prefix+l',
  cycle_pane_next: 'prefix+tab',
  cycle_pane_previous: 'prefix+shift+tab',
  last_pane: '',
  split_vertical: 'prefix+v',
  split_horizontal: 'prefix+minus',
  close_pane: 'prefix+x',
  zoom: 'prefix+z',
  resize_mode: 'prefix+r',
  toggle_sidebar: 'prefix+b',
  navigate_workspace_up: 'up',
  navigate_workspace_down: 'down',
  navigate_pane_left: 'h',
  navigate_pane_down: 'j',
  navigate_pane_up: 'k',
  navigate_pane_right: 'l',
};

export const NAVIGATE_ACTIONS = [
  'navigate_workspace_up',
  'navigate_workspace_down',
  'navigate_pane_left',
  'navigate_pane_down',
  'navigate_pane_up',
  'navigate_pane_right',
] as const;

/** Atajos que la propia GUI reserva (§T1.10) y no se pueden reasignar aquí. */
export const GUI_RESERVED: Array<{ chordId: string; action: string; label: string }> = [
  { chordId: 'ctrl+shift+p', action: 'gui.palette', label: 'Paleta de acciones' },
  { chordId: 'ctrl+shift+c', action: 'gui.copy', label: 'Copiar de la terminal' },
  { chordId: 'ctrl+shift+v', action: 'gui.paste', label: 'Pegar en la terminal' },
];

/** Acciones que solo existen dentro del modo navegar (F3) o fuera de v1. */
export const NAVIGATE_SCOPED = new Set<string>([...NAVIGATE_ACTIONS, 'remote_image_paste']);

export class Keymap {
  prefixKey = DEFAULT_PREFIX_KEY;
  entries: KeymapEntry[] = [];
  indexed: Partial<Record<'tabs' | 'workspaces' | 'agents', IndexedRange>> = {};
  /** chordId (`p:` prefix, `d:` directo) → acción. */
  lookup = new Map<string, string>();

  load(overrides: KeymapOverrides = {}): void {
    this.prefixKey =
      overrides.prefix && overrides.prefix.length > 0 ? overrides.prefix : DEFAULT_PREFIX_KEY;
    const bindings = { ...DEFAULT_KEYBINDINGS, ...(overrides.bindings ?? {}) };
    this.entries = [];
    this.indexed = {};
    this.lookup = new Map();

    for (const [action, raw] of Object.entries(bindings)) {
      if (!raw || raw.trim().length === 0) continue;
      if (action === 'switch_tab' || action === 'switch_workspace' || action === 'focus_agent') {
        const range = parseIndexedRange(raw);
        if (!range) continue;
        const kind =
          action === 'switch_tab'
            ? 'tabs'
            : action === 'switch_workspace'
              ? 'workspaces'
              : 'agents';
        this.indexed[kind] = {
          scope: range.prefix ? 'prefix' : 'direct',
          from: range.from,
          to: range.to,
          chord: range.chord,
        };
        continue;
      }
      const parsed = parseBinding(raw);
      if (!parsed) continue;
      // Los atajos de navigate solo viven dentro del modo navegar (F3) y
      // remote_image_paste es de `--remote` (fuera de v1): no se capturan nunca,
      // así las flechas y h/j/k/l siguen llegando a la terminal.
      const scope: KeyScope = NAVIGATE_SCOPED.has(action)
        ? 'navigate'
        : parsed.prefix
          ? 'prefix'
          : 'direct';
      const id = chordId(parsed.chord);
      this.entries.push({ action, binding: raw, scope, chordId: id });
      if (scope === 'navigate') continue;
      this.lookup.set(`${scope === 'prefix' ? 'p' : 'd'}:${id}`, action);
    }

    const indexOverrides = overrides.indexed ?? {};
    for (const [kind, raw] of Object.entries(indexOverrides)) {
      if (!raw) continue;
      const range = parseIndexedRange(
        `prefix+1..9`.replace('prefix+', raw.length > 0 ? `${raw}+` : ''),
      );
      if (range) {
        this.indexed[kind as 'tabs' | 'workspaces' | 'agents'] = {
          scope: range.prefix ? 'prefix' : 'direct',
          from: range.from,
          to: range.to,
          chord: range.chord,
        };
      }
    }
  }

  /** Atajos de prefix/directo para el cheatsheet. */
  get activeEntries(): KeymapEntry[] {
    return this.entries.filter((entry) => entry.scope !== 'navigate');
  }

  /** Atajos del modo navegar (F3). */
  get navigateEntries(): KeymapEntry[] {
    return this.entries.filter((entry) => entry.scope === 'navigate');
  }

  /** Atajo configurado para una acción (para menús y cheatsheet). */
  bindingOf(action: string): string | null {
    return this.entries.find((entry) => entry.action === action)?.binding ?? null;
  }

  labelOf(action: string): string | null {
    const binding = this.bindingOf(action);
    return binding ? bindingLabel(binding, this.prefixKey) : null;
  }

  /** Conflictos: dos acciones distintas con el mismo atajo y el mismo ámbito. */
  conflicts(): Array<{ chordId: string; scope: KeyScope; actions: string[] }> {
    const byChord = new Map<string, string[]>();
    for (const entry of this.entries) {
      const key = `${entry.scope}:${entry.chordId}`;
      const list = byChord.get(key) ?? [];
      list.push(entry.action);
      byChord.set(key, list);
    }
    const conflicts: Array<{ chordId: string; scope: KeyScope; actions: string[] }> = [];
    for (const [key, actions] of byChord) {
      if (actions.length > 1) {
        const [scope, chord] = key.split(':') as [KeyScope, string];
        conflicts.push({ chordId: chord, scope, actions });
      }
    }
    return conflicts;
  }

  /**
   * Resuelve una tecla. Devuelve la acción, `literalPrefix` cuando se pulsó la
   * tecla de prefix dos veces (hay que mandar el ctrl+b literal al panel) o null
   * si la tecla no es de la GUI y debe llegar a la terminal.
   */
  resolveForEvent(
    event: KeyboardEvent,
    prefixActive: boolean,
  ): { action: string } | { literalPrefix: true } | null {
    const chord = chordFromEvent(event);
    const id = chordId(chord);
    if (prefixActive) {
      const action = this.lookup.get(`p:${id}`);
      if (action) return { action };
      if (
        id ===
        chordId(
          parseBinding(this.prefixKey)?.chord ?? {
            key: '',
            ctrl: false,
            shift: false,
            alt: false,
            meta: false,
          },
        )
      ) {
        return { literalPrefix: true };
      }
      const indexed = this.#indexedFor(chord, 'prefix');
      if (indexed) return { action: indexed };
      return null;
    }
    const direct = this.lookup.get(`d:${id}`);
    if (direct) return { action: direct };
    const indexed = this.#indexedFor(chord, 'direct');
    if (indexed) return { action: indexed };
    return null;
  }

  /** Acción indexada (`switch_tab:3`) si la tecla es un dígito del rango. */
  #indexedFor(chord: KeyChord, scope: KeyScope): string | null {
    const digit = Number.parseInt(chord.key, 10);
    if (Number.isNaN(digit) || String(digit) !== chord.key) return null;
    for (const [kind, range] of Object.entries(this.indexed) as Array<
      ['tabs' | 'workspaces' | 'agents', IndexedRange]
    >) {
      if (range.scope !== scope) continue;
      if (digit < range.from || digit > range.to) continue;
      // Los modificadores tienen que coincidir (ctrl+1..9 != prefix+1..9).
      if (
        chord.ctrl !== range.chord.ctrl ||
        chord.shift !== range.chord.shift ||
        chord.alt !== range.chord.alt ||
        chord.meta !== range.chord.meta
      ) {
        continue;
      }
      const action =
        kind === 'tabs' ? 'switch_tab' : kind === 'workspaces' ? 'switch_workspace' : 'focus_agent';
      return `${action}:${digit}`;
    }
    return null;
  }

  isPrefixKey(event: KeyboardEvent): boolean {
    const parsed = parseBinding(this.prefixKey);
    if (!parsed) return false;
    return chordId(chordFromEvent(event)) === chordId(parsed.chord);
  }

  /** Atajos globales de la GUI (no configurables). */
  resolveGuiShortcut(event: KeyboardEvent): string | null {
    const id = chordId(chordFromEvent(event));
    return GUI_RESERVED.find((entry) => entry.chordId === id)?.action ?? null;
  }
}

export const keymap = new Keymap();
keymap.load();
