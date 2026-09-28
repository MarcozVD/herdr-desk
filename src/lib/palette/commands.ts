// T2.6/T2.7 — Catálogo de la paleta de acciones: comandos curados (Anexo B del
// plan), las acciones del mapa de teclas que no tengan comando propio y
// entradas dinámicas de espacios, pestañas, paneles y agentes.
//
// Los comandos NO ejecutan nada por su cuenta: llaman a `flows` o a
// `runAction()` (los mismos caminos que usan los menús y los atajos), así que
// cada acción tiene un solo recorrido. El catálogo se reconstruye cuando cambia
// el snapshot.

import { AGENT_KEY, agentLabel, DEFAULT_AGENT_WAIT_MS } from '../agents/agentActions';
import { noticeCenter } from '../agents/noticeCenter';
import { flows } from '../actions/flows';
import type { AgentInfo, PaneInfo, TabInfo, WorkspaceInfo } from '../herdr/types';
import { es } from '../i18n/es';
import { ACTION_LABELS, runAction } from '../keys/actions';
import { keymap } from '../keys/keymap';
import { presetNames } from '../layout/presets';
import { settings, type AgentPanelSort, type ToastDelivery } from '../stores/settings.svelte';
import { ui } from '../stores/ui.svelte';
import { fuzzyScore, rankByScore, recencyIndex } from './fuzzy';

export type PaletteGroup =
  'recent' | 'session' | 'workspaces' | 'tabs' | 'panes' | 'agents' | 'settings' | 'system';

/** Orden canónico de los grupos en la lista. */
export const PALETTE_GROUP_ORDER: readonly PaletteGroup[] = [
  'recent',
  'session',
  'workspaces',
  'tabs',
  'panes',
  'agents',
  'settings',
  'system',
];

export interface PaletteCommand {
  /** Id estable: es lo que se guarda en la lista de recientes. */
  id: string;
  label: string;
  group: PaletteGroup;
  /** Texto secundario (estado, cwd, destino…). */
  hint?: string;
  /** Atajo real, si la acción está atada a una tecla. */
  shortcut?: string;
  /** Términos extra que también valen para buscar. */
  keywords?: string;
  /** Acción del mapa de teclas que representa, si la hay. */
  action?: string;
  run: () => void | Promise<void>;
}

export interface PaletteContext {
  workspaces: readonly WorkspaceInfo[];
  tabs: readonly TabInfo[];
  panes: readonly PaneInfo[];
  agents: readonly AgentInfo[];
  focusedPaneId: string | null;
  focusedTabId: string | null;
  focusedWorkspaceId: string | null;
}

/** A qué grupo va cada acción del mapa de teclas que no tenga comando curado. */
const ACTION_GROUP: Record<string, PaletteGroup> = {
  help: 'settings',
  settings: 'settings',
  toggle_sidebar: 'settings',
  detach: 'system',
  reload_config: 'system',
  new_workspace: 'workspaces',
  rename_workspace: 'workspaces',
  close_workspace: 'workspaces',
  previous_workspace: 'workspaces',
  next_workspace: 'workspaces',
  new_tab: 'tabs',
  rename_tab: 'tabs',
  close_tab: 'tabs',
  previous_tab: 'tabs',
  next_tab: 'tabs',
  rename_pane: 'panes',
  split_vertical: 'panes',
  split_horizontal: 'panes',
  close_pane: 'panes',
  zoom: 'panes',
  focus_pane_left: 'panes',
  focus_pane_down: 'panes',
  focus_pane_up: 'panes',
  focus_pane_right: 'panes',
  cycle_pane_next: 'panes',
  cycle_pane_previous: 'panes',
  last_pane: 'panes',
  previous_agent: 'agents',
  next_agent: 'agents',
};

function toggleDelivery(value: ToastDelivery): ToastDelivery {
  return value === 'herdr' ? 'off' : 'herdr';
}

function toggleAgentSort(value: AgentPanelSort): AgentPanelSort {
  return value === 'spaces' ? 'priority' : 'spaces';
}

/**
 * Comandos curados: los que tienen flujo propio o necesitan contexto (el panel
 * enfocado). El resto de acciones del mapa de teclas se añaden solas.
 */
function curatedCommands(context: PaletteContext): PaletteCommand[] {
  const commands: PaletteCommand[] = [];
  const pane = context.focusedPaneId;

  commands.push(
    {
      id: 'session.picker',
      label: es.palette.cmdSessionPicker,
      group: 'session',
      keywords: 'sesion conectar cambiar servidor',
      run: () => ui.openSessions(),
    },
    {
      id: 'session.start',
      label: es.palette.cmdStartServer,
      group: 'session',
      keywords: 'server arrancar iniciar',
      run: () => flows.startServer(),
    },
    {
      id: 'settings.notifications',
      label:
        settings.values.toast_delivery === 'herdr' ? es.sidebar.notifyOff : es.sidebar.notifyOn,
      group: 'settings',
      keywords: 'avisos toasts notificaciones campana',
      run: () => settings.set('toast_delivery', toggleDelivery(settings.values.toast_delivery)),
    },
    {
      id: 'settings.sound',
      label: settings.values.sound_enabled ? es.palette.cmdSoundOff : es.palette.cmdSoundOn,
      group: 'settings',
      keywords: 'sonido silencio audio',
      run: () => settings.set('sound_enabled', !settings.values.sound_enabled),
    },
    {
      id: 'settings.agent_sort',
      label:
        settings.values.agent_panel_sort === 'spaces'
          ? es.palette.cmdAgentSortPriority
          : es.palette.cmdAgentSortSpaces,
      group: 'settings',
      keywords: 'orden agentes panel espacios prioridad',
      run: () =>
        settings.set('agent_panel_sort', toggleAgentSort(settings.values.agent_panel_sort)),
    },
    {
      id: 'plugins.open',
      label: es.plugins.open,
      group: 'system',
      keywords: 'plugins extensiones manifiesto github',
      run: () => ui.openPlugins(),
    },
    {
      id: 'advanced.open',
      label: es.advanced.open,
      group: 'system',
      keywords: 'avanzado metadata graficos kitty skill handoff notificacion',
      run: () => ui.openAdvanced(),
    },
    {
      id: 'console.open',
      label: es.apiConsole.open,
      group: 'system',
      keywords: 'consola api metodos rpc eventos',
      run: () => ui.openConsole(),
    },
    {
      id: 'server.open',
      label: es.server.open,
      group: 'system',
      keywords: 'servidor estado manifiestos update canal detener',
      run: () => ui.openServer(),
    },
    {
      id: 'integrations.open',
      label: es.integrations.open,
      group: 'system',
      keywords: 'integraciones agentes claude codex instalar',
      run: () => ui.openIntegrations(),
    },
    {
      id: 'worktrees.open',
      label: es.worktrees.open,
      group: 'settings',
      keywords: 'worktree git rama checkout espacio',
      run: () => flows.openWorktrees(),
    },
    {
      id: 'settings.settings',
      label: ACTION_LABELS['settings'] ?? 'settings',
      group: 'settings',
      keywords: 'ajustes preferencias configuracion',
      action: 'settings',
      run: () => runAction('settings'),
    },
    {
      id: 'settings.help',
      label: ACTION_LABELS['help'] ?? 'help',
      group: 'settings',
      keywords: 'ayuda atajos cheatsheet',
      action: 'help',
      run: () => runAction('help'),
    },
    {
      id: 'settings.sidebar',
      label: ACTION_LABELS['toggle_sidebar'] ?? 'toggle_sidebar',
      group: 'settings',
      keywords: 'sidebar lateral colapsar ocultar',
      action: 'toggle_sidebar',
      run: () => runAction('toggle_sidebar'),
    },
    {
      id: 'system.reload_config',
      label: ACTION_LABELS['reload_config'] ?? 'reload_config',
      group: 'system',
      keywords: 'recargar configuracion toml',
      action: 'reload_config',
      run: () => runAction('reload_config'),
    },
    {
      id: 'system.detach',
      label: ACTION_LABELS['detach'] ?? 'detach',
      group: 'system',
      keywords: 'cerrar salir gui server vivo',
      action: 'detach',
      run: () => runAction('detach'),
    },
    {
      id: 'panes.split_right',
      label: ACTION_LABELS['split_vertical'] ?? 'split_vertical',
      group: 'panes',
      keywords: 'dividir split vertical derecha',
      action: 'split_vertical',
      run: () => runAction('split_vertical'),
    },
    {
      id: 'panes.split_down',
      label: ACTION_LABELS['split_horizontal'] ?? 'split_horizontal',
      group: 'panes',
      keywords: 'dividir split horizontal abajo',
      action: 'split_horizontal',
      run: () => runAction('split_horizontal'),
    },
  );

  if (pane) {
    commands.push(
      {
        id: 'panes.close',
        label: ACTION_LABELS['close_pane'] ?? 'close_pane',
        group: 'panes',
        hint: pane,
        keywords: 'cerrar panel pane',
        action: 'close_pane',
        run: () => runAction('close_pane'),
      },
      {
        id: 'panes.zoom',
        label: ACTION_LABELS['zoom'] ?? 'zoom',
        group: 'panes',
        hint: pane,
        keywords: 'zoom maximizar panel',
        action: 'zoom',
        run: () => runAction('zoom'),
      },
      {
        id: 'panes.rename',
        label: ACTION_LABELS['rename_pane'] ?? 'rename_pane',
        group: 'panes',
        hint: pane,
        keywords: 'renombrar titulo panel',
        action: 'rename_pane',
        run: () => runAction('rename_pane'),
      },
      {
        id: 'panes.start_agent',
        label: es.agents.start,
        group: 'panes',
        hint: pane,
        keywords: 'iniciar arrancar agente kind',
        run: () => flows.openStartAgent(pane, pane),
      },
      {
        id: 'panes.start_agent_split',
        label: es.agents.startSplit,
        group: 'panes',
        hint: pane,
        keywords: 'iniciar agente split nuevo',
        run: () => flows.startAgentInNewSplit('right'),
      },
    );
  }

  if (context.focusedWorkspaceId) {
    commands.push(
      {
        id: 'workspaces.rename',
        label: ACTION_LABELS['rename_workspace'] ?? 'rename_workspace',
        group: 'workspaces',
        hint: context.focusedWorkspaceId,
        keywords: 'renombrar espacio etiqueta',
        action: 'rename_workspace',
        run: () => runAction('rename_workspace'),
      },
      {
        id: 'workspaces.close',
        label: ACTION_LABELS['close_workspace'] ?? 'close_workspace',
        group: 'workspaces',
        hint: context.focusedWorkspaceId,
        keywords: 'cerrar espacio workspace',
        action: 'close_workspace',
        run: () => runAction('close_workspace'),
      },
    );
  }

  if (context.focusedTabId) {
    commands.push({
      id: 'tabs.close',
      label: ACTION_LABELS['close_tab'] ?? 'close_tab',
      group: 'tabs',
      hint: context.focusedTabId,
      keywords: 'cerrar pestana tab',
      action: 'close_tab',
      run: () => runAction('close_tab'),
    });
  }

  // T2.7 — «Ir a la última notificación»: el último panel que avisó.
  commands.push({
    id: 'agents.notification_target',
    label: es.palette.cmdNotificationTarget,
    group: 'agents',
    hint: noticeCenter.lastNotifiedPaneId ?? es.palette.cmdNotificationNone,
    keywords: 'ultima notificacion aviso ir saltar',
    action: 'open_notification_target',
    run: () => {
      const target = noticeCenter.lastNotifiedPaneId;
      if (target) {
        flows.focusAgent(target);
        return;
      }
      ui.notify(es.palette.cmdNotificationNone, 'warn');
    },
  });

  // Por cada agente: lo mismo que ofrece el menú de su fila en el panel.
  for (const agent of context.agents) {
    const name = agentLabel(agent);
    const base = `agent:${agent.pane_id}`;
    const state = es.agentStatus[agent.agent_status];
    commands.push(
      {
        id: `${base}:focus`,
        label: es.palette.cmdAgentFocus.replace('{name}', name),
        group: 'agents',
        hint: `${state} · ${agent.pane_id}`,
        keywords: `agente enfocar focus ${agent.pane_id}`,
        run: () => flows.focusAgent(agent.pane_id),
      },
      {
        id: `${base}:rename`,
        label: es.palette.cmdAgentRename.replace('{name}', name),
        group: 'agents',
        hint: agent.pane_id,
        keywords: `agente renombrar nombre ${agent.pane_id}`,
        run: () => flows.renameAgent(agent.pane_id),
      },
      {
        id: `${base}:explain`,
        label: es.palette.cmdAgentExplain.replace('{name}', name),
        group: 'agents',
        hint: agent.pane_id,
        keywords: `agente explicar deteccion ${agent.pane_id}`,
        run: () => flows.explainAgent(agent.pane_id),
      },
      {
        id: `${base}:transcript`,
        label: es.palette.cmdAgentTranscript.replace('{name}', name),
        group: 'agents',
        hint: agent.pane_id,
        keywords: `agente transcript scrollback salida ${agent.pane_id}`,
        run: () => flows.showAgentTranscript(agent.pane_id),
      },
      {
        id: `${base}:wait-idle`,
        label: es.palette.cmdAgentWaitIdle.replace('{name}', name),
        group: 'agents',
        hint: `${DEFAULT_AGENT_WAIT_MS / 1000} s`,
        keywords: `agente esperar inactivo idle ${agent.pane_id}`,
        run: () => flows.waitAgent(agent.pane_id, 'idle'),
      },
      {
        id: `${base}:wait-done`,
        label: es.palette.cmdAgentWaitDone.replace('{name}', name),
        group: 'agents',
        hint: `${DEFAULT_AGENT_WAIT_MS / 1000} s`,
        keywords: `agente esperar terminar listo done ${agent.pane_id}`,
        run: () => flows.waitAgent(agent.pane_id, 'done'),
      },
      {
        id: `${base}:keys-escape`,
        label: es.palette.cmdAgentEscape.replace('{name}', name),
        group: 'agents',
        hint: AGENT_KEY.escape,
        keywords: `agente tecla escape ${agent.pane_id}`,
        run: () => flows.sendAgentKey(agent.pane_id, AGENT_KEY.escape),
      },
      {
        id: `${base}:keys-interrupt`,
        label: es.palette.cmdAgentInterrupt.replace('{name}', name),
        group: 'agents',
        hint: AGENT_KEY.interrupt,
        keywords: `agente tecla ctrl c interrumpir ${agent.pane_id}`,
        run: () => flows.sendAgentKey(agent.pane_id, AGENT_KEY.interrupt),
      },
      {
        id: `${base}:release`,
        label: es.palette.cmdAgentRelease.replace('{name}', name),
        group: 'agents',
        hint: agent.pane_id,
        keywords: `agente soltar liberar ${agent.pane_id}`,
        run: () => flows.releaseAgent(agent.pane_id),
      },
    );
  }

  return commands;
}

/** Espacios, pestañas y paneles: una entrada «ir a» por cada uno. */
function dynamicCommands(context: PaletteContext): PaletteCommand[] {
  const commands: PaletteCommand[] = [];

  for (const workspace of context.workspaces) {
    commands.push({
      id: `workspace:${workspace.workspace_id}`,
      label: es.palette.cmdGotoWorkspace
        .replace('{n}', String(workspace.number))
        .replace('{label}', workspace.label),
      group: 'workspaces',
      hint: `${workspace.pane_count} paneles`,
      keywords: `espacio workspace ir ${workspace.workspace_id}`,
      run: () => flows.focusWorkspace(workspace.workspace_id),
    });
  }

  for (const tab of context.tabs) {
    commands.push({
      id: `tab:${tab.tab_id}`,
      label: es.palette.cmdGotoTab.replace('{n}', String(tab.number)).replace('{label}', tab.label),
      group: 'tabs',
      hint: tab.tab_id,
      keywords: `pestana tab ir ${tab.tab_id}`,
      run: () => void flows.focusTab(tab.tab_id),
    });
  }

  for (const pane of context.panes) {
    const agent = context.agents.find((item) => item.pane_id === pane.pane_id);
    commands.push({
      id: `pane:${pane.pane_id}`,
      label: es.palette.cmdGotoPane.replace('{pane}', pane.pane_id),
      group: 'panes',
      hint: agent ? agentLabel(agent) : (pane.cwd ?? pane.pane_id),
      keywords: `panel pane ir ${pane.pane_id} ${pane.cwd ?? ''}`,
      run: () => flows.focusPane(pane.pane_id),
    });
  }

  // T3.3 — Presets de layout: guardar el actual y aplicar/quitar los guardados.
  commands.push({
    id: 'layout.save',
    label: es.presets.save,
    group: 'settings',
    keywords: 'layout preset guardar tab arbol',
    run: () => void flows.saveLayoutPreset(),
  });
  for (const name of presetNames(settings.values.layout_presets as Record<string, unknown>)) {
    commands.push({
      id: `layout.apply:${name}`,
      label: es.presets.apply.replace('{name}', name),
      group: 'settings',
      keywords: `layout preset aplicar ${name}`,
      run: () => void flows.applyLayoutPreset(name),
    });
    commands.push({
      id: `layout.remove:${name}`,
      label: es.presets.remove.replace('{name}', name),
      group: 'settings',
      keywords: `layout preset quitar borrar ${name}`,
      run: () => flows.deleteLayoutPreset(name),
    });
  }

  return commands;
}

/**
 * Catálogo completo: curados + dinámicos + las acciones del mapa de teclas que
 * no tengan ya un comando propio, así la paleta cubre todo lo que se puede atar
 * a una tecla.
 */
export function buildCommands(context: PaletteContext): PaletteCommand[] {
  const curated = [...curatedCommands(context), ...dynamicCommands(context)];
  const covered = new Set(curated.map((command) => command.action).filter(Boolean));
  const extras: PaletteCommand[] = [];
  for (const entry of keymap.activeEntries) {
    const action = entry.action;
    if (covered.has(action)) continue;
    const label = ACTION_LABELS[action];
    if (!label) continue;
    extras.push({
      id: `action:${action}`,
      label,
      group: ACTION_GROUP[action] ?? 'system',
      action,
      run: () => runAction(action),
    });
  }
  return [...curated, ...extras];
}

/** Rellena el atajo real de cada comando (una vez construido el catálogo). */
export function withShortcuts(commands: readonly PaletteCommand[]): PaletteCommand[] {
  return commands.map((command) =>
    command.action
      ? { ...command, shortcut: keymap.labelOf(command.action) ?? undefined }
      : command,
  );
}

/** Cuántos comandos hay por grupo (para el contador de cada sección). */
export function countByGroup(commands: readonly PaletteCommand[]): Map<PaletteGroup, number> {
  const counts = new Map<PaletteGroup, number>();
  for (const command of commands) {
    counts.set(command.group, (counts.get(command.group) ?? 0) + 1);
  }
  return counts;
}

/**
 * Filtra y ordena: con consulta, por puntuación (con los recientes como
 * desempate); sin consulta, los recientes arriba y el resto por grupo.
 */
export function rankCommands(
  commands: readonly PaletteCommand[],
  query: string,
  recent: readonly string[],
  max = 200,
): PaletteCommand[] {
  const trimmed = query.trim();
  const byId = new Map(commands.map((command) => [command.id, command]));

  if (trimmed.length === 0) {
    const ordered: PaletteCommand[] = [];
    for (const id of recent) {
      const command = byId.get(id);
      if (command) ordered.push(command);
    }
    for (const group of PALETTE_GROUP_ORDER) {
      if (group === 'recent') continue;
      for (const command of commands) if (command.group === group) ordered.push(command);
    }
    return ordered.slice(0, max);
  }

  const scored = rankByScore(
    commands,
    (command) => bestScore(trimmed, command),
    (command) => recencyIndex(recent, command.id),
  );
  return scored.map((entry) => entry.item).slice(0, max);
}

/** Mejor puntuación entre etiqueta (peso 1), términos extra (0.85) y detalle (0.7). */
function bestScore(query: string, command: PaletteCommand): number | null {
  const candidates: Array<[string, number]> = [
    [command.label, 1],
    [command.keywords ?? '', 0.85],
    [command.hint ?? '', 0.7],
  ];
  let best: number | null = null;
  for (const [text, weight] of candidates) {
    if (text.length === 0) continue;
    const score = fuzzyScore(query, text);
    if (score === null) continue;
    const weighted = score * weight;
    if (best === null || weighted > best) best = weighted;
  }
  return best;
}

/**
 * Agrupa la lista ya ordenada por grupos para pintarla (los recientes primero).
 * Mantiene el orden de dentro de cada grupo.
 */
export function groupForDisplay(
  commands: readonly PaletteCommand[],
  recent: readonly string[],
): Array<{ group: PaletteGroup; items: PaletteCommand[] }> {
  const recentItems = recent
    .map((id) => commands.find((command) => command.id === id))
    .filter((command): command is PaletteCommand => command !== undefined);
  const groups: Array<{ group: PaletteGroup; items: PaletteCommand[] }> = [];
  if (recentItems.length > 0) groups.push({ group: 'recent', items: recentItems });
  // Un comando sale UNA vez: si está en «Recientes», no se repite en su grupo.
  const shown = new Set(recentItems.map((command) => command.id));
  for (const group of PALETTE_GROUP_ORDER) {
    if (group === 'recent') continue;
    const items = commands.filter((command) => command.group === group && !shown.has(command.id));
    if (items.length > 0) groups.push({ group, items });
  }
  return groups;
}
