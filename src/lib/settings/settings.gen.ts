/* eslint-disable */
/**
 * Configuracion por defecto de herdr — GENERADO por scripts/gen-settings.mjs.
 * NO EDITAR A MANO. Regenerar: pnpm gen
 * Origen: `herdr --default-config` (0.8.0-preview.2026-08-04-d78e3d3b5126)
 * 22 secciones · 120 claves
 */
export type SettingsValueType = 'string' | 'boolean' | 'integer' | 'float' | 'array' | 'toml';

export interface SettingsKeySpec {
  key: string;
  value: string | null;
  active: boolean;
  type: SettingsValueType;
  description: string;
}

export interface SettingsSectionSpec {
  path: string;
  tableArray: boolean;
  description: string;
  keys: SettingsKeySpec[];
}

export const SETTINGS_SECTIONS: SettingsSectionSpec[] = [
  {
    path: '',
    tableArray: false,
    description: '',
    keys: [
      {
        key: 'onboarding',
        value: 'true',
        active: false,
        type: 'boolean',
        description:
          "Show first-run notification setup on startup.\nMissing also shows onboarding; set false after you've chosen.",
      },
    ],
  },
  {
    path: 'theme',
    tableArray: false,
    description: '',
    keys: [
      {
        key: 'name',
        value: '"catppuccin"',
        active: false,
        type: 'string',
        description:
          'Built-in themes: catppuccin, terminal, tokyo-night, dracula, nord,\ngruvbox, one-dark, solarized, kanagawa, rose-pine,\nvesper',
      },
      {
        key: 'auto_switch',
        value: 'false',
        active: false,
        type: 'boolean',
        description:
          'Follow host terminal light/dark appearance and switch Herdr UI themes.\nExisting manual behavior is unchanged unless this is true.',
      },
      { key: 'dark_name', value: '"catppuccin"', active: false, type: 'string', description: '' },
      {
        key: 'light_name',
        value: '"catppuccin-latte"',
        active: false,
        type: 'string',
        description: '',
      },
    ],
  },
  {
    path: 'theme.custom',
    tableArray: false,
    description:
      'Override individual color tokens on top of the base theme.\nAccepts: hex (#rrggbb), named colors, rgb(r,g,b), or panel_bg = "reset"',
    keys: [
      { key: 'panel_bg', value: '"reset"', active: false, type: 'string', description: '' },
      { key: 'accent', value: '"#f5c2e7"', active: false, type: 'string', description: '' },
      { key: 'red', value: '"#ff6188"', active: false, type: 'string', description: '' },
      { key: 'green', value: '"#a6e3a1"', active: false, type: 'string', description: '' },
    ],
  },
  {
    path: 'terminal',
    tableArray: false,
    description: '',
    keys: [
      {
        key: 'default_shell',
        value: '""',
        active: false,
        type: 'string',
        description:
          'Executable used for new interactive panes.\nEmpty means $SHELL, then /bin/sh.',
      },
      {
        key: 'shell_mode',
        value: '"auto"',
        active: false,
        type: 'string',
        description:
          'Startup mode for new interactive pane shells: "auto", "login", or "non_login".\n"auto" uses login shells on macOS and keeps the current behavior elsewhere.',
      },
      {
        key: 'new_cwd',
        value: '"follow"',
        active: false,
        type: 'string',
        description:
          'CWD policy for new panes, tabs, and workspaces when no explicit --cwd is provided.\nUse "follow" to inherit the source pane/workspace, "home" for $HOME,\n"current" for Herdr\'s process directory, or a fixed path such as "~/Projects".',
      },
    ],
  },
  {
    path: 'update',
    tableArray: false,
    description: '',
    keys: [
      {
        key: 'channel',
        value: '"stable"',
        active: false,
        type: 'string',
        description:
          'Update channel used by background version checks and `herdr update`.\nDefaults to "stable" on Linux/macOS and "preview" on Windows.\nSet explicitly to choose stable releases or opt-in preview builds.',
      },
      {
        key: 'version_check',
        value: 'true',
        active: false,
        type: 'boolean',
        description: 'Check herdr.dev for new Herdr versions in the background.',
      },
      {
        key: 'manifest_check',
        value: 'true',
        active: false,
        type: 'boolean',
        description:
          'Check herdr.dev for remote agent-detection manifest updates in the background.',
      },
    ],
  },
  {
    path: 'keys',
    tableArray: false,
    description: '',
    keys: [
      {
        key: 'prefix',
        value: '"ctrl+b"',
        active: false,
        type: 'string',
        description:
          'Prefix key to enter prefix mode (default: "ctrl+b")\nExamples: "ctrl+b", "f12", "esc", "-"\nAction bindings use explicit syntax: "prefix+n" requires the prefix;\n"ctrl+alt+n" is a direct terminal-mode shortcut.\nAccepted key syntax: plain keys, ctrl/shift/alt/cmd/super modifiers, and special keys like enter/tab/esc/left/right/up/down.\nNamed punctuation such as minus, comma, ampersand, plus, and backtick is also accepted.\nMost reliable direct bindings are ctrl+letter, function keys, and explicit modified chords.\nalt+..., cmd/super, and punctuation-with-modifiers may depend on your terminal/tmux setup.',
      },
      {
        key: 'help',
        value: '"prefix+?"',
        active: false,
        type: 'string',
        description: 'Prefix-mode actions',
      },
      { key: 'settings', value: '"prefix+s"', active: false, type: 'string', description: '' },
      { key: 'detach', value: '"prefix+q"', active: false, type: 'string', description: '' },
      {
        key: 'reload_config',
        value: '"prefix+shift+r"',
        active: false,
        type: 'string',
        description: '',
      },
      {
        key: 'open_notification_target',
        value: '"prefix+o"',
        active: false,
        type: 'string',
        description: '',
      },
      {
        key: 'workspace_picker',
        value: '"prefix+w"',
        active: false,
        type: 'string',
        description: '',
      },
      { key: 'goto', value: '"prefix+g"', active: false, type: 'string', description: '' },
      {
        key: 'new_workspace',
        value: '"prefix+shift+n"',
        active: false,
        type: 'string',
        description: '',
      },
      {
        key: 'new_worktree',
        value: '"prefix+shift+g"',
        active: false,
        type: 'string',
        description: '',
      },
      {
        key: 'open_worktree',
        value: '""',
        active: false,
        type: 'string',
        description: 'optional, unset by default',
      },
      {
        key: 'remove_worktree',
        value: '""',
        active: false,
        type: 'string',
        description: 'optional, unset by default; opens confirmation',
      },
      {
        key: 'rename_workspace',
        value: '"prefix+shift+w"',
        active: false,
        type: 'string',
        description: '',
      },
      {
        key: 'close_workspace',
        value: '"prefix+shift+d"',
        active: false,
        type: 'string',
        description: '',
      },
      {
        key: 'previous_workspace',
        value: '""',
        active: false,
        type: 'string',
        description: 'optional, unset by default',
      },
      {
        key: 'next_workspace',
        value: '""',
        active: false,
        type: 'string',
        description: 'optional, unset by default',
      },
      {
        key: 'previous_agent',
        value: '""',
        active: false,
        type: 'string',
        description: 'optional, unset by default',
      },
      {
        key: 'next_agent',
        value: '""',
        active: false,
        type: 'string',
        description: 'optional, unset by default',
      },
      {
        key: 'focus_agent',
        value: '""',
        active: false,
        type: 'string',
        description: 'optional indexed binding, e.g. "prefix+alt+1..9"',
      },
      {
        key: 'remote_image_paste',
        value: '"ctrl+v"',
        active: false,
        type: 'string',
        description: 'only active in herdr --remote; empty disables raw-key image paste',
      },
      { key: 'new_tab', value: '"prefix+c"', active: false, type: 'string', description: '' },
      {
        key: 'rename_tab',
        value: '"prefix+shift+t"',
        active: false,
        type: 'string',
        description: '',
      },
      { key: 'previous_tab', value: '"prefix+p"', active: false, type: 'string', description: '' },
      { key: 'next_tab', value: '"prefix+n"', active: false, type: 'string', description: '' },
      { key: 'switch_tab', value: '"prefix+1..9"', active: false, type: 'string', description: '' },
      {
        key: 'switch_workspace',
        value: '""',
        active: false,
        type: 'string',
        description: 'optional indexed binding, e.g. "prefix+shift+1..9"',
      },
      {
        key: 'close_tab',
        value: '"prefix+shift+x"',
        active: false,
        type: 'string',
        description: '',
      },
      {
        key: 'rename_pane',
        value: '"prefix+shift+p"',
        active: false,
        type: 'string',
        description: '',
      },
      {
        key: 'edit_scrollback',
        value: '"prefix+e"',
        active: false,
        type: 'string',
        description: '',
      },
      {
        key: 'focus_pane_left',
        value: '"prefix+h"',
        active: false,
        type: 'string',
        description: '',
      },
      {
        key: 'focus_pane_down',
        value: '"prefix+j"',
        active: false,
        type: 'string',
        description: '',
      },
      { key: 'focus_pane_up', value: '"prefix+k"', active: false, type: 'string', description: '' },
      {
        key: 'focus_pane_right',
        value: '"prefix+l"',
        active: false,
        type: 'string',
        description: '',
      },
      {
        key: 'cycle_pane_next',
        value: '"prefix+tab"',
        active: false,
        type: 'string',
        description: '',
      },
      {
        key: 'cycle_pane_previous',
        value: '"prefix+shift+tab"',
        active: false,
        type: 'string',
        description: '',
      },
      {
        key: 'last_pane',
        value: '""',
        active: false,
        type: 'string',
        description: 'optional, unset by default; bind e.g. "prefix+tab" for global back-and-forth',
      },
      {
        key: 'split_vertical',
        value: '"prefix+v"',
        active: false,
        type: 'string',
        description: '',
      },
      {
        key: 'split_horizontal',
        value: '"prefix+minus"',
        active: false,
        type: 'string',
        description: '',
      },
      { key: 'close_pane', value: '"prefix+x"', active: false, type: 'string', description: '' },
      {
        key: 'zoom',
        value: '"prefix+z"',
        active: false,
        type: 'string',
        description: 'legacy alias: fullscreen',
      },
      { key: 'resize_mode', value: '"prefix+r"', active: false, type: 'string', description: '' },
      {
        key: 'toggle_sidebar',
        value: '"prefix+b"',
        active: false,
        type: 'string',
        description: '',
      },
      {
        key: 'navigate_workspace_up',
        value: '"up"',
        active: false,
        type: 'string',
        description:
          'Navigate-mode movement. These local shortcuts win while navigate mode is open.\nThey are independent from focus_pane_*. Do not include prefix+, esc, enter, tab, or 1..9 here.',
      },
      {
        key: 'navigate_workspace_down',
        value: '"down"',
        active: false,
        type: 'string',
        description: '',
      },
      {
        key: 'navigate_pane_left',
        value: '"h"',
        active: false,
        type: 'string',
        description: 'left arrow always focuses the pane to the left',
      },
      { key: 'navigate_pane_down', value: '"j"', active: false, type: 'string', description: '' },
      { key: 'navigate_pane_up', value: '"k"', active: false, type: 'string', description: '' },
      {
        key: 'navigate_pane_right',
        value: '"l"',
        active: false,
        type: 'string',
        description: 'right arrow always focuses the pane to the right',
      },
    ],
  },
  {
    path: 'keys.command',
    tableArray: true,
    description:
      'Custom commands use the same binding syntax.\ntype = "shell" runs detached in the background.\ntype = "pane" opens a temporary pane and closes it when the command exits.\ntype = "popup" opens a session-modal terminal without changing the tab layout.\nPopup width and height accept terminal cells or percentages such as "80%".\nOn Windows, command strings run through cmd.exe /d /c.',
    keys: [
      { key: 'key', value: '"prefix+alt+g"', active: false, type: 'string', description: '' },
      { key: 'type', value: '"popup"', active: false, type: 'string', description: '' },
      { key: 'command', value: '"lazygit"', active: false, type: 'string', description: '' },
      { key: 'width', value: '"80%"', active: false, type: 'string', description: '' },
      { key: 'height', value: '"80%"', active: false, type: 'string', description: '' },
    ],
  },
  {
    path: 'keys.indexed',
    tableArray: false,
    description:
      'Legacy indexed shortcut config is still parsed for compatibility.\nPrefer switch_tab, switch_workspace, and focus_agent for new configs.',
    keys: [
      {
        key: 'tabs',
        value: '""',
        active: false,
        type: 'string',
        description: 'e.g. "ctrl" makes ctrl+1..9 switch tabs directly',
      },
      {
        key: 'workspaces',
        value: '""',
        active: false,
        type: 'string',
        description: 'e.g. "ctrl+shift" makes ctrl+shift+1..9 switch workspaces directly',
      },
      {
        key: 'agents',
        value: '""',
        active: false,
        type: 'string',
        description: 'e.g. "alt" makes alt+1..9 focus agent rows directly',
      },
    ],
  },
  {
    path: 'worktrees',
    tableArray: false,
    description: '',
    keys: [
      {
        key: 'directory',
        value: '"~/.herdr/worktrees"',
        active: false,
        type: 'string',
        description: '',
      },
    ],
  },
  {
    path: 'ui',
    tableArray: false,
    description: '',
    keys: [
      {
        key: 'sidebar_width',
        value: '26',
        active: false,
        type: 'integer',
        description: 'Sidebar width (auto-scaled based on workspace names, this sets the default)',
      },
      {
        key: 'sidebar_min_width',
        value: '18',
        active: false,
        type: 'integer',
        description: 'Minimum sidebar width when expanded (columns)',
      },
      {
        key: 'sidebar_max_width',
        value: '36',
        active: false,
        type: 'integer',
        description: 'Maximum sidebar width when expanded (columns)',
      },
      {
        key: 'sidebar_start_collapsed',
        value: 'false',
        active: false,
        type: 'boolean',
        description: 'Start with the sidebar collapsed. Changes take effect on the next launch.',
      },
      {
        key: 'sidebar_collapsed_mode',
        value: '"compact"',
        active: false,
        type: 'string',
        description:
          'Collapsed sidebar presentation: "compact" keeps the narrow status rail, "hidden" uses zero width.',
      },
      {
        key: 'mobile_width_threshold',
        value: '64',
        active: false,
        type: 'integer',
        description:
          'Terminal width at or below which Herdr uses the mobile single-column layout.\nIncrease this for foldables, tablets, or wide phone terminals.',
      },
      {
        key: 'mouse_capture',
        value: 'true',
        active: false,
        type: 'boolean',
        description:
          "Capture mouse input for Herdr's mouse UI.\nSet false to let the terminal handle normal clicks, such as Cmd-clicking URLs.\nPane apps like lazygit and btop can still receive mouse when they request it.",
      },
      {
        key: 'copy_on_select',
        value: 'true',
        active: false,
        type: 'boolean',
        description:
          'Automatically copy text selected with the mouse.\nSet false to retain drag or double-click word selection until Ctrl+C,\nor Cmd+C when the host forwards it, copies and clears it.',
      },
      {
        key: 'host_cursor',
        value: '"auto"',
        active: false,
        type: 'string',
        description:
          'Host cursor policy: "auto", "native", or "drawn".\n"auto" draws Herdr\'s own cursor on native Windows builds and WSL to avoid ConPTY cursor flicker, and uses the native terminal cursor elsewhere.\n"native" always uses the outer terminal cursor. "drawn" always draws Herdr\'s cursor as terminal cell content.',
      },
      {
        key: 'right_click_passthrough_modifier',
        value: '""',
        active: false,
        type: 'string',
        description:
          "Optional modifier that forwards right-click hold/drag gestures to pane apps instead of opening Herdr's pane menu.\nEmpty/off disables this. Shift is intentionally unsupported because terminals commonly reserve Shift+mouse.",
      },
      {
        key: 'redraw_on_focus_gained',
        value: 'true',
        active: false,
        type: 'boolean',
        description:
          'Force a full redraw when the outer terminal regains focus.\nSet false to reduce visible flashing when switching back to Herdr.\nTrade-off: rare host terminal surface corruption may persist until the next full redraw.',
      },
      {
        key: 'mouse_scroll_lines',
        value: '3',
        active: false,
        type: 'integer',
        description: 'Pane scrollback lines to scroll per mouse wheel notch.',
      },
      {
        key: 'confirm_close',
        value: 'true',
        active: false,
        type: 'boolean',
        description: 'Ask for confirmation before closing a workspace',
      },
      {
        key: 'prompt_new_tab_name',
        value: 'true',
        active: false,
        type: 'boolean',
        description:
          'Ask for a tab name before creating a new tab.\nSet false to create tabs immediately with generated names.',
      },
      {
        key: 'prompt_new_workspace_name',
        value: 'false',
        active: false,
        type: 'boolean',
        description: 'Ask for a workspace name before interactive creation.',
      },
      {
        key: 'pane_borders',
        value: 'true',
        active: false,
        type: 'boolean',
        description: 'Draw borders around split panes.',
      },
      {
        key: 'pane_scrollbars',
        value: 'true',
        active: false,
        type: 'boolean',
        description:
          'Draw interactive scrollbars beside terminal panes.\nSet false to reclaim the scrollbar column and keep it out of terminal-native selections.',
      },
      {
        key: 'pane_gaps',
        value: 'true',
        active: false,
        type: 'boolean',
        description: 'Keep split panes visually separated instead of sharing divider borders.',
      },
      {
        key: 'show_agent_labels_on_pane_borders',
        value: 'false',
        active: false,
        type: 'boolean',
        description:
          'Show detected/reported agent labels in split pane borders when no manual pane name is set.',
      },
      {
        key: 'hide_tab_bar_when_single_tab',
        value: 'false',
        active: false,
        type: 'boolean',
        description:
          'Hide the tab row when a workspace has exactly one tab.\nNew tabs can still be created with the configured keybinding.',
      },
      {
        key: 'tab_bar_position',
        value: '"top"',
        active: false,
        type: 'string',
        description: 'Desktop tab row placement: "top" or "bottom".',
      },
      {
        key: 'agent_panel_sort',
        value: '"spaces"',
        active: false,
        type: 'string',
        description:
          'Agent panel ordering: "spaces" (grouped by space) or "priority" (attention queue).\n"workspaces" is accepted as an alias for "spaces".',
      },
    ],
  },
  {
    path: 'ui.sidebar.agents',
    tableArray: false,
    description:
      'Expanded agent rows. Built-ins are state_icon, state_text, workspace, tab, pane, agent,\nterminal_title, and terminal_title_stripped.\nCustom values reported through pane metadata use a $name token.\nA token occurrence may be styled with { token = "workspace", fg = "#89b4fa", bold = true, dim = false }.\nOmitted style fields preserve the contextual default.',
    keys: [
      {
        key: 'row_gap',
        value: '0',
        active: false,
        type: 'integer',
        description: 'Blank rows between agent entries. Set to 1 to restore the previous spacing.',
      },
      {
        key: 'rows',
        value: '[["state_icon", "workspace", "tab"], ["agent"]]',
        active: false,
        type: 'array',
        description: '',
      },
    ],
  },
  {
    path: 'ui.sidebar.agents.rows_by_agent',
    tableArray: false,
    description: 'Optional canonical agent IDs replace the default rows for matching agents.',
    keys: [
      {
        key: 'claude',
        value: '[["state_icon", "workspace", "tab"], ["terminal_title_stripped"], ["agent"]]',
        active: false,
        type: 'array',
        description: '',
      },
    ],
  },
  {
    path: 'ui.sidebar.spaces',
    tableArray: false,
    description:
      'Expanded space rows. Built-ins are state_icon, state_text, workspace, branch, and git_status.\nCustom values reported through workspace metadata use a $name token, for example $jj_status.\nInline token styles accept strict #RGB/#RRGGBB foregrounds plus bold and dim booleans.',
    keys: [
      {
        key: 'row_gap',
        value: '0',
        active: false,
        type: 'integer',
        description: 'Blank rows between space entries. Set to 1 to restore the previous spacing.',
      },
      {
        key: 'rows',
        value: '[["state_icon", "workspace"], ["branch", "git_status"]]',
        active: false,
        type: 'array',
        description: '',
      },
      {
        key: 'accent',
        value: '"cyan"',
        active: false,
        type: 'string',
        description:
          'Accent color for highlights, borders, and navigation UI.\nAccepts: hex (#89b4fa), named colors (cyan, blue, magenta), or rgb(r,g,b)',
      },
    ],
  },
  {
    path: 'ui.toast',
    tableArray: false,
    description: 'Background notification popup delivery',
    keys: [
      {
        key: 'delivery',
        value: '"off"',
        active: false,
        type: 'string',
        description:
          'off = disable pop-up notifications\nherdr = show in-app toasts\nterminal = ask the outer terminal to show a desktop notification\nsystem = ask the OS notification service directly',
      },
      { key: 'delay_seconds', value: '1', active: false, type: 'integer', description: '' },
    ],
  },
  {
    path: 'ui.toast.herdr',
    tableArray: false,
    description: '',
    keys: [
      { key: 'position', value: '"bottom-right"', active: false, type: 'string', description: '' },
    ],
  },
  {
    path: 'ui.toast.clipboard',
    tableArray: false,
    description: '',
    keys: [
      { key: 'enabled', value: 'true', active: false, type: 'boolean', description: '' },
      { key: 'position', value: '"bottom-center"', active: false, type: 'string', description: '' },
    ],
  },
  {
    path: 'ui.sound',
    tableArray: false,
    description: 'Play sounds when agents change state in background workspaces',
    keys: [
      { key: 'enabled', value: 'true', active: false, type: 'boolean', description: '' },
      {
        key: 'path',
        value: '"sounds/notification.mp3"',
        active: false,
        type: 'string',
        description:
          "Optional custom mp3 sound files. Relative paths are resolved from this config file's directory.\none mp3 file for all sound notifications",
      },
      {
        key: 'done_path',
        value: '"sounds/done.mp3"',
        active: false,
        type: 'string',
        description: 'overrides only finished notifications',
      },
      {
        key: 'request_path',
        value: '"sounds/request.mp3"',
        active: false,
        type: 'string',
        description: 'overrides only needs-attention notifications',
      },
    ],
  },
  {
    path: 'ui.sound.agents',
    tableArray: false,
    description: 'Per-agent overrides: default | on | off\nBy default, droid is muted.',
    keys: [{ key: 'droid', value: '"off"', active: false, type: 'string', description: '' }],
  },
  {
    path: 'session',
    tableArray: false,
    description: '',
    keys: [
      {
        key: 'resume_agents_on_restore',
        value: 'true',
        active: false,
        type: 'boolean',
        description:
          'Resume supported AI-agent panes into their native conversation sessions after\na Herdr server restart. Requires official integrations that report session refs.',
      },
    ],
  },
  {
    path: 'remote',
    tableArray: false,
    description: '',
    keys: [
      {
        key: 'manage_ssh_config',
        value: 'true',
        active: false,
        type: 'boolean',
        description:
          'Whether herdr manages the ssh config used for `herdr --remote`.\nWhen true (default), herdr runs remote ssh through a generated config that\nincludes your ~/.ssh/config first and adds ServerAliveInterval/\nServerAliveCountMax as fallbacks (so any keepalive values you set yourself\nstill win) to survive idle network/NAT timeouts. Herdr also uses a private\nper-attach OpenSSH control socket to reuse the first authenticated connection.\nSet false to run plain ssh against your ssh config unchanged — this does not\nforce keepalive or multiplexing off, it only stops herdr from adding its own.',
      },
    ],
  },
  {
    path: 'experimental',
    tableArray: false,
    description: '',
    keys: [
      {
        key: 'allow_nested',
        value: 'false',
        active: false,
        type: 'boolean',
        description: 'Allow launching herdr from inside a herdr-managed pane.',
      },
      {
        key: 'kitty_graphics',
        value: 'false',
        active: false,
        type: 'boolean',
        description:
          'Experimental local Kitty graphics rendering for attached clients.\nRequires a Kitty graphics-compatible outer terminal.',
      },
      {
        key: 'pane_history',
        value: 'false',
        active: true,
        type: 'boolean',
        description: 'Save recent pane screen history across full server restarts.',
      },
      {
        key: 'switch_ascii_input_source_in_prefix',
        value: 'false',
        active: false,
        type: 'boolean',
        description:
          'While prefix mode is active, temporarily switch the host input source to\nan ASCII-capable mode so prefix commands register even when an IME is\nactive, then restore the previous input source when prefix mode exits. On\nmacOS this selects the ASCII-capable keyboard layout; on Windows it toggles\na Korean IME between Hangul and English (other IME languages are left\nunchanged). macOS and Windows only; best-effort. Default: false.',
      },
      {
        key: 'reveal_hidden_cursor_for_cjk_ime',
        value: 'false',
        active: false,
        type: 'boolean',
        description:
          "Expose the focused pane's cursor to the outer terminal so macOS input\nmethods keep tracking the candidate window when TUIs paint their own\ncursor (Claude Code, pi, codex). Trade-off: extra cursor visible for\napps that hide it without painting a replacement (vim normal mode, etc.).",
      },
      {
        key: 'cjk_ime_agents',
        value: '[]',
        active: false,
        type: 'array',
        description:
          'Optional allow-list: only reveal for focused panes whose detected agent\nmatches one of these names. Empty means apply to any focused pane.\nIf the list contains no valid names, the reveal does not apply.\nAccepted: pi, claude, codex, gemini, cursor, devin, cline, opencode,\ncopilot, kimi, kiro, droid, amp, grok, hermes, kilo, qodercli, qoder.',
      },
      {
        key: 'cjk_ime_cursor_shape',
        value: '"steady_block"',
        active: false,
        type: 'string',
        description:
          'Cursor shape rendered when reveal_hidden_cursor_for_cjk_ime is true.\nValues: block, steady_block (default), underline, steady_underline, bar, steady_bar.',
      },
    ],
  },
  {
    path: 'advanced',
    tableArray: false,
    description: '',
    keys: [
      {
        key: 'scrollback_limit_bytes',
        value: '10000000',
        active: false,
        type: 'integer',
        description:
          "Maximum scrollback buffer size in bytes retained per pane terminal.\nMatches Ghostty's default scrollback-limit behavior.",
      },
    ],
  },
];
