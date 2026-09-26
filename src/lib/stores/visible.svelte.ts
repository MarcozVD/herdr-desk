// T3.2 — Fuente ÚNICA del «foco visible» de la GUI.
//
// Criterio (documentado aquí y usado en toda la app): manda el foco LOCAL de la
// GUI (R11) y, si no hay o el id ya no existe, el del servidor. Antes cada sitio
// lo resolvía a su manera y se veía la incoherencia típica: el contenido cambiaba
// de espacio con el clic de la sidebar pero la barra de pestañas seguía filtrando
// por el espacio del SERVIDOR (`session.focusedWorkspaceId`), así que parecía que
// todos los espacios tenían las mismas pestañas.
//
// Reglas, en orden:
//   1. espacio visible = `ui.localFocusedWorkspaceId` ?? `session.focusedWorkspaceId`
//   2. pestañas       = las de ese espacio, como las da el snapshot (en orden)
//   3. pestaña activa = la local si está en ese espacio; si no, la activa del
//      espacio (`active_tab_id` del snapshot); si no, la enfocada por el servidor
//      si está en ese espacio; si no, la primera
//   4. panel activo   = el local si está en esa pestaña; si no, el del servidor si
//      está en esa pestaña; si no, NINGUNO (`paneId` es estricto: el anillo y
//      «enfocar con el clic» dependen de él, y caer «al primero» hacía que un
//      panel sin foco real saliera como activo y el clic no lo enfocara).
//      Para las ACCIONES sí hay respaldo al primero del tab (`actionPaneId`).

import { session } from './session.svelte';
import { ui } from './ui.svelte';

class VisibleFocus {
  /** Espacio que se está viendo en la GUI (el local solo si sigue existiendo). */
  workspaceId = $derived.by(() => {
    const local = ui.localFocusedWorkspaceId;
    if (local && session.workspaces.some((item) => item.workspace_id === local)) return local;
    return session.focusedWorkspaceId;
  });

  workspace = $derived(
    session.workspaces.find((item) => item.workspace_id === this.workspaceId) ?? null,
  );

  /** Pestañas del espacio visible (lo que pinta la barra de pestañas). */
  tabs = $derived(session.tabs.filter((tab) => tab.workspace_id === this.workspaceId));

  tabId = $derived.by(() => {
    const local = ui.localFocusedTabId;
    if (local && this.tabs.some((tab) => tab.tab_id === local)) return local;
    const active = this.workspace?.active_tab_id;
    if (active && this.tabs.some((tab) => tab.tab_id === active)) return active;
    const server = session.focusedTabId;
    if (server && this.tabs.some((tab) => tab.tab_id === server)) return server;
    return this.tabs[0]?.tab_id ?? null;
  });

  tab = $derived(this.tabs.find((item) => item.tab_id === this.tabId) ?? null);

  /** Paneles de la pestaña visible. */
  panes = $derived(session.panes.filter((pane) => pane.tab_id === this.tabId));

  /** Panel ENFOCADO (anillo del marco, «enfocar»): sin respaldo al primero. */
  paneId = $derived.by(() => {
    const local = ui.localFocusedPaneId;
    if (local && this.panes.some((pane) => pane.pane_id === local)) return local;
    const server = session.focusedPaneId;
    if (server && this.panes.some((pane) => pane.pane_id === server)) return server;
    return null;
  });

  /** Panel para las ACCIONES de la GUI: cae al primero del tab si no hay foco. */
  actionPaneId = $derived(this.paneId ?? this.panes[0]?.pane_id ?? null);
}

export const visible = new VisibleFocus();
