// @vitest-environment jsdom
// T2.6/T2.7 — Catálogo de la paleta: grupos, comandos de agente, cobertura del
// mapa de teclas, orden por recientes y ejecución real de un comando.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface RecordedCall {
  method: string;
  params: unknown;
}

const calls: RecordedCall[] = [];

vi.mock('../herdr/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../herdr/client')>();
  return {
    ...actual,
    call: vi.fn(async (method: string, params: unknown) => {
      calls.push({ method, params });
      return { type: 'ok' };
    }),
    storeSubscribe: vi.fn(async () => undefined),
    sessionCurrent: vi.fn(async () => ({ ok: true, value: 'herdr-desk-dev' })),
  };
});

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

import type { AgentInfo, PaneInfo, TabInfo, WorkspaceInfo } from '../herdr/types';
import { es } from '../i18n/es';
import { ACTION_LABELS } from '../keys/actions';
import { keymap } from '../keys/keymap';
import { settings } from '../stores/settings.svelte';
import { ui } from '../stores/ui.svelte';
import {
  buildCommands,
  groupForDisplay,
  rankCommands,
  withShortcuts,
  type PaletteContext,
} from './commands';

function workspace(id: string, number: number, label: string): WorkspaceInfo {
  return {
    workspace_id: id,
    number,
    label,
    focused: number === 1,
    pane_count: 1,
    tab_count: 1,
    active_tab_id: `${id}:t1`,
    agent_status: 'unknown',
  } as unknown as WorkspaceInfo;
}

function tab(id: string, number: number, label: string): TabInfo {
  return {
    tab_id: id,
    workspace_id: 'w1',
    number,
    label,
    focused: number === 1,
    pane_count: 1,
    agent_status: 'unknown',
  } as unknown as TabInfo;
}

function pane(id: string): PaneInfo {
  return {
    pane_id: id,
    terminal_id: `term_${id}`,
    workspace_id: 'w1',
    tab_id: 'w1:t1',
    focused: true,
    agent_status: 'unknown',
    revision: 0,
    cwd: 'C:\\Users\\dev\\Documents\\herdr',
  } as unknown as PaneInfo;
}

function agent(paneId: string, status: AgentInfo['agent_status'], name?: string): AgentInfo {
  return {
    pane_id: paneId,
    terminal_id: `term_${paneId}`,
    workspace_id: 'w1',
    tab_id: 'w1:t1',
    focused: false,
    agent_status: status,
    revision: 0,
    agent: 'opencode',
    name: name ?? null,
  } as unknown as AgentInfo;
}

const context: PaletteContext = {
  workspaces: [workspace('w1', 1, 'spike-r3'), workspace('w2', 2, 'docs-r11')],
  tabs: [tab('w1:t1', 1, 'uno'), tab('w1:t2', 2, 'dos')],
  panes: [pane('w1:p1'), pane('w1:p9')],
  agents: [agent('w1:p1', 'blocked', 'hd-bot')],
  focusedPaneId: 'w1:p1',
  focusedTabId: 'w1:t1',
  focusedWorkspaceId: 'w1',
};

beforeEach(() => {
  calls.length = 0;
  settings.values.palette_recent = [];
  settings.values.toast_delivery = 'off';
  settings.values.sound_enabled = true;
  settings.values.agent_panel_sort = 'spaces';
});

afterEach(() => {
  ui.closeContextMenu();
});

describe('catálogo (T2.6)', () => {
  it('cubre los siete grupos y las acciones del mapa de teclas', () => {
    const commands = buildCommands(context);
    const groups = new Set(commands.map((command) => command.group));
    for (const group of [
      'session',
      'workspaces',
      'tabs',
      'panes',
      'agents',
      'settings',
      'system',
    ]) {
      expect(groups.has(group as never), `falta el grupo ${group}`).toBe(true);
    }

    // Ninguna acción con etiqueta del mapa de teclas se queda fuera.
    for (const entry of keymap.activeEntries) {
      if (!ACTION_LABELS[entry.action]) continue;
      const covered = commands.some(
        (command) => command.action === entry.action || command.id === `action:${entry.action}`,
      );
      expect(covered, `acción sin comando: ${entry.action}`).toBe(true);
    }
  });

  it('una entrada «ir a» por espacio, pestaña y panel, con su detalle', () => {
    const commands = buildCommands(context);
    const labels = commands.map((command) => command.label);

    expect(labels).toContain(
      es.palette.cmdGotoWorkspace.replace('{n}', '2').replace('{label}', 'docs-r11'),
    );
    expect(labels).toContain(es.palette.cmdGotoTab.replace('{n}', '2').replace('{label}', 'dos'));
    expect(labels).toContain(es.palette.cmdGotoPane.replace('{pane}', 'w1:p9'));
    // El panel con agente se distingue por el nombre del agente.
    expect(commands.find((command) => command.id === 'pane:w1:p1')?.hint).toBe('hd-bot');
  });

  it('por cada agente ofrece lo mismo que el menú de su fila', () => {
    const commands = buildCommands(context).filter((command) =>
      command.id.startsWith('agent:w1:p1:'),
    );
    expect(commands.map((command) => command.id)).toEqual([
      'agent:w1:p1:focus',
      'agent:w1:p1:rename',
      'agent:w1:p1:explain',
      'agent:w1:p1:transcript',
      'agent:w1:p1:wait-idle',
      'agent:w1:p1:wait-done',
      'agent:w1:p1:keys-escape',
      'agent:w1:p1:keys-interrupt',
      'agent:w1:p1:release',
    ]);
    expect(commands[0]?.label).toContain('hd-bot');
    expect(commands[0]?.hint).toContain('bloqueado');
  });

  it('los interruptores de la GUI dicen el estado y lo cambian', async () => {
    const commands = buildCommands(context);
    const sound = commands.find((command) => command.id === 'settings.sound');
    expect(sound?.label).toBe(es.palette.cmdSoundOff); // está activado: ofrece silenciar

    await sound?.run();
    expect(settings.values.sound_enabled).toBe(false);

    const notifications = buildCommands(context).find(
      (command) => command.id === 'settings.notifications',
    );
    await notifications?.run();
    expect(settings.values.toast_delivery).toBe('herdr');
  });

  it('los atajos reales se ven en el detalle', () => {
    const commands = withShortcuts(buildCommands(context));
    const split = commands.find((command) => command.id === 'panes.split_right');
    expect(split?.shortcut).toBe(keymap.labelOf('split_vertical'));
  });
});

describe('orden y búsqueda (T2.6)', () => {
  it('sin consulta salen primero los recientes y luego por grupo', () => {
    const commands = buildCommands(context);
    const ranked = rankCommands(commands, '', ['panes.zoom', 'tabs.close']);
    expect(ranked[0]?.id).toBe('panes.zoom');
    expect(ranked[1]?.id).toBe('tabs.close');
    // El resto mantiene el orden de los grupos.
    expect(ranked[2]?.group).toBe('session');
  });

  it('un comando sale UNA vez aunque esté en recientes', () => {
    const commands = buildCommands(context);
    const groups = groupForDisplay(commands, ['panes.zoom']);
    const ids = groups.flatMap((group) => group.items.map((command) => command.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(groups[0]?.group).toBe('recent');
  });

  it('busca sin acentos y por varias palabras', () => {
    const commands = buildCommands(context);
    const pestana = rankCommands(commands, 'pestana', []);
    expect(pestana.some((command) => command.group === 'tabs')).toBe(true);

    const transcript = rankCommands(commands, 'transcript hd-bot', []);
    expect(transcript[0]?.id).toBe('agent:w1:p1:transcript');
  });

  it('el filtro deja fuera lo que no encaja', () => {
    const commands = buildCommands(context);
    expect(rankCommands(commands, 'zzzz', [])).toHaveLength(0);
  });
});

describe('ejecución (T2.6/T2.7)', () => {
  it('los comandos de agente llaman a los flujos de agente', async () => {
    const commands = buildCommands(context);
    await commands.find((command) => command.id === 'agent:w1:p1:transcript')?.run();
    expect(calls.map((call) => call.method)).toContain('agent.read');

    calls.length = 0;
    await commands.find((command) => command.id === 'agent:w1:p1:focus')?.run();
    expect(calls.map((call) => call.method)).toContain('agent.focus');
    expect(ui.localFocusedPaneId).toBe('w1:p1');
  });

  it('«ir al panel» enfoca ese panel, y «ir a la última notificación» avisa si no hay', async () => {
    const commands = buildCommands(context);
    await commands.find((command) => command.id === 'pane:w1:p9')?.run();
    expect(ui.localFocusedPaneId).toBe('w1:p9');

    const target = buildCommands(context).find(
      (command) => command.id === 'agents.notification_target',
    );
    expect(target?.hint).toBe(es.palette.cmdNotificationNone);
    await target?.run();
    expect(ui.toasts.at(-1)?.text).toBe(es.palette.cmdNotificationNone);
  });

  it('los comandos de espacio y pestaña enfocan por su id', async () => {
    const commands = buildCommands(context);
    // El espacio cambia el foco local siempre y, con sincronía, también la TUI.
    settings.values.sync_focus_with_tui = true;
    try {
      await commands.find((command) => command.id === 'workspace:w2')?.run();
      expect(ui.localFocusedWorkspaceId).toBe('w2');
      expect(calls.at(-1)?.method).toBe('workspace.focus');
      expect(calls.at(-1)?.params).toEqual({ workspace_id: 'w2' });
    } finally {
      settings.values.sync_focus_with_tui = false;
    }

    calls.length = 0;
    await commands.find((command) => command.id === 'tab:w1:t2')?.run();
    expect(calls.at(-1)?.method).toBe('tab.focus');
    expect(calls.at(-1)?.params).toEqual({ tab_id: 'w1:t2' });
  });
});
