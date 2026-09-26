// T1.10 — Acciones del motor de atajos: id de acción → flujo de UI.
// Las acciones de fases posteriores avisan en vez de fallar en silencio.

import { es } from '../i18n/es';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { flows } from '../actions/flows';
import { session } from '../stores/session.svelte';
import { ui } from '../stores/ui.svelte';

export const ACTION_LABELS: Record<string, string> = {
  help: 'Ayuda de atajos',
  settings: 'Ajustes',
  detach: 'Cerrar la GUI (deja el server vivo)',
  reload_config: 'Recargar configuración',
  open_notification_target: 'Ir a la última notificación',
  workspace_picker: 'Selector de espacios',
  goto: 'Modo navegar',
  new_workspace: 'Nuevo espacio',
  new_worktree: 'Nuevo worktree',
  open_worktree: 'Abrir worktree',
  remove_worktree: 'Quitar worktree',
  rename_workspace: 'Renombrar espacio',
  close_workspace: 'Cerrar espacio',
  previous_workspace: 'Espacio anterior',
  next_workspace: 'Espacio siguiente',
  previous_agent: 'Agente anterior',
  next_agent: 'Agente siguiente',
  focus_agent: 'Enfocar agente',
  remote_image_paste: 'Pegar imagen (solo remoto)',
  new_tab: 'Nueva pestaña',
  rename_tab: 'Renombrar pestaña',
  previous_tab: 'Pestaña anterior',
  next_tab: 'Pestaña siguiente',
  switch_tab: 'Ir a la pestaña N',
  switch_workspace: 'Ir al espacio N',
  close_tab: 'Cerrar pestaña',
  rename_pane: 'Renombrar panel',
  edit_scrollback: 'Editar scrollback',
  focus_pane_left: 'Panel a la izquierda',
  focus_pane_down: 'Panel abajo',
  focus_pane_up: 'Panel arriba',
  focus_pane_right: 'Panel a la derecha',
  cycle_pane_next: 'Siguiente panel',
  cycle_pane_previous: 'Panel anterior',
  last_pane: 'Panel anterior (último)',
  split_vertical: 'Dividir a la derecha',
  split_horizontal: 'Dividir abajo',
  close_pane: 'Cerrar panel',
  zoom: 'Zoom del panel',
  resize_mode: 'Modo redimensionar',
  toggle_sidebar: 'Mostrar/ocultar la barra lateral',
  navigate_workspace_up: 'Navegar: espacio arriba',
  navigate_workspace_down: 'Navegar: espacio abajo',
  navigate_pane_left: 'Navegar: panel izquierda',
  navigate_pane_down: 'Navegar: panel abajo',
  navigate_pane_up: 'Navegar: panel arriba',
  navigate_pane_right: 'Navegar: panel derecha',
  gui: 'Atajos de la GUI',
};

const LATER: Record<string, string> = {
  settings: 'Los ajustes llegan en F3.',
  open_notification_target: 'Las notificaciones llegan en F2.',
  workspace_picker: 'El selector fuzzy llega en F2.',
  goto: 'El modo navegar llega en F3.',
  new_worktree: 'Los worktrees llegan en F3.',
  open_worktree: 'Los worktrees llegan en F3.',
  remove_worktree: 'Los worktrees llegan en F3.',
  edit_scrollback: 'La edición de scrollback llega en F3.',
  resize_mode: 'El modo redimensionar llega en F3.',
  navigate_workspace_up: 'El modo navegar llega en F3.',
  navigate_workspace_down: 'El modo navegar llega en F3.',
  navigate_pane_left: 'El modo navegar llega en F3.',
  navigate_pane_down: 'El modo navegar llega en F3.',
  navigate_pane_up: 'El modo navegar llega en F3.',
  navigate_pane_right: 'El modo navegar llega en F3.',
};

/** Avisa al TerminalView del panel enfocado (atajo literal o portapapeles). */
function dispatchToTerminal(channel: 'input' | 'copy' | 'paste', detail = ''): void {
  window.dispatchEvent(new CustomEvent('herdr-desk:terminal', { detail: { channel, detail } }));
}

export async function runAction(action: string): Promise<void> {
  if (action.startsWith('switch_tab:')) {
    await flows.switchTabNumber(Number(action.split(':')[1]));
    return;
  }
  if (action.startsWith('switch_workspace:')) {
    await flows.switchWorkspaceNumber(Number(action.split(':')[1]));
    return;
  }
  if (action.startsWith('focus_agent:')) {
    flows.focusAgentNumber(Number(action.split(':')[1]));
    return;
  }
  if (action.startsWith('gui.')) {
    if (action === 'gui.palette') ui.togglePalette();
    if (action === 'gui.copy') dispatchToTerminal('copy');
    if (action === 'gui.paste') dispatchToTerminal('paste');
    return;
  }

  const later = LATER[action];
  if (later) {
    ui.notify(later, 'warn');
    return;
  }

  const focusedPane = session.focusedPaneId;
  const focusedTab = session.focusedTabId;
  const focusedWorkspace = session.focusedWorkspaceId;

  switch (action) {
    case 'help':
      ui.toggleHelp();
      break;
    case 'detach':
      void getCurrentWindow().close();
      break;
    case 'reload_config':
      await flows.reloadConfig();
      break;
    case 'new_workspace':
      await flows.createWorkspace();
      break;
    case 'rename_workspace':
      if (focusedWorkspace) await flows.renameWorkspace(focusedWorkspace);
      break;
    case 'close_workspace':
      if (focusedWorkspace) await flows.closeWorkspace(focusedWorkspace);
      break;
    case 'previous_workspace':
      await flows.nextWorkspace(-1);
      break;
    case 'next_workspace':
      await flows.nextWorkspace(1);
      break;
    case 'previous_agent':
      flows.nextAgent(-1);
      break;
    case 'next_agent':
      flows.nextAgent(1);
      break;
    case 'remote_image_paste':
      ui.notify('Solo aplica a herdr --remote (fuera de v1).', 'warn');
      break;
    case 'new_tab':
      await flows.newTab();
      break;
    case 'rename_tab':
      if (focusedTab) await flows.renameTab(focusedTab);
      break;
    case 'previous_tab':
      await flows.nextTab(-1);
      break;
    case 'next_tab':
      await flows.nextTab(1);
      break;
    case 'close_tab':
      if (focusedTab) await flows.closeTab(focusedTab);
      break;
    case 'rename_pane':
      if (focusedPane) await flows.renamePane(focusedPane);
      break;
    case 'focus_pane_left':
      await flows.focusPaneDirection('left');
      break;
    case 'focus_pane_down':
      await flows.focusPaneDirection('down');
      break;
    case 'focus_pane_up':
      await flows.focusPaneDirection('up');
      break;
    case 'focus_pane_right':
      await flows.focusPaneDirection('right');
      break;
    case 'cycle_pane_next':
      flows.cyclePane(1);
      break;
    case 'cycle_pane_previous':
      flows.cyclePane(-1);
      break;
    case 'last_pane':
      flows.lastPane();
      break;
    case 'split_vertical':
      await flows.splitPane('right');
      break;
    case 'split_horizontal':
      await flows.splitPane('down');
      break;
    case 'close_pane':
      if (focusedPane) await flows.closePane(focusedPane);
      break;
    case 'zoom':
      if (focusedPane) await flows.toggleZoom(focusedPane);
      break;
    case 'toggle_sidebar':
      ui.toggleSidebar();
      break;
    default:
      ui.notify(es.keys.unbound, 'warn');
      break;
  }
}
