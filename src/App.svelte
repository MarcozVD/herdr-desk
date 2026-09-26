<!-- Shell completo de F1: titlebar con selector de sesión, franja de reconexión,
     sidebar de espacios y agentes, tab bar, árbol de splits y status bar. Los
     overlays (paleta, cheatsheet, diálogos, menú contextual y toasts) viven aquí
     para que solo haya un diálogo de cada tipo montado. -->
<script lang="ts">
  import { onMount } from 'svelte';

  import AgentPromptDialog from './features/agents/AgentPromptDialog.svelte';
  import { noticeCenter } from './lib/agents/noticeCenter';
  import { noticeSound } from './lib/agents/noticeSound';
  import StartAgentDialog from './features/agents/StartAgentDialog.svelte';
  import CommandPalette from './features/palette/CommandPalette.svelte';
  import SessionsDialog from './features/sessions/SessionsDialog.svelte';
  import Sidebar from './features/sidebar/Sidebar.svelte';
  import StatusBar from './features/statusbar/StatusBar.svelte';
  import TabBar from './features/tabs/TabBar.svelte';
  import ReconnectBanner from './features/titlebar/ReconnectBanner.svelte';
  import Titlebar from './features/titlebar/Titlebar.svelte';
  import { blockedCount } from './lib/agents/agentPanel';
  import { syncBlockedOverlay } from './lib/agents/taskbarOverlay';
  import { es } from './lib/i18n/es';
  import { runAction } from './lib/keys/actions';
  import Cheatsheet from './lib/keys/Cheatsheet.svelte';
  import { keymap } from './lib/keys/keymap';
  import SplitTree from './lib/layout/SplitTree.svelte';
  import { zoomedTree } from './lib/layout/tree';
  import { layout } from './lib/stores/layout.svelte';
  import { pool } from './lib/terminal/pool';
  import { session } from './lib/stores/session.svelte';
  import { settings } from './lib/stores/settings.svelte';
  import { ui } from './lib/stores/ui.svelte';
  import { suppressNativeContextMenu } from './lib/ui/context-menu';
  import ConfirmDialog from './lib/ui/ConfirmDialog.svelte';
  import ContextMenu from './lib/ui/ContextMenu.svelte';
  import PromptDialog from './lib/ui/PromptDialog.svelte';
  import ToastHost from './lib/ui/ToastHost.svelte';
  import TextViewer from './lib/ui/TextViewer.svelte';
  import WorkspaceDialog from './lib/ui/WorkspaceDialog.svelte';

  /**
   * Tab que se está viendo: manda el foco local de la GUI (R11) y, si no hay,
   * el del servidor. Es lo que hace que un clic en la barra de espacios o de
   * pestañas se vea de verdad.
   */
  const visibleTabId = $derived(ui.localFocusedTabId ?? session.focusedTabId);
  const visiblePaneId = $derived(ui.localFocusedPaneId ?? session.focusedPaneId);
  const tree = $derived(layout.zoomed ? zoomedTree(layout.tree, visiblePaneId) : layout.tree);

  // Si el SERVIDOR mueve el foco a otro tab (lo movió la TUI, no la GUI) se
  // adopta: el foco local manda solo hasta que el server diga otra cosa.
  let lastServerTab: string | null = null;
  $effect(() => {
    const serverTab = session.focusedTabId;
    if (serverTab === lastServerTab) return;
    const previous = lastServerTab;
    lastServerTab = serverTab;
    if (previous === null) return;
    if (serverTab !== null && serverTab !== ui.localFocusedTabId) ui.clearLocalTab();
  });

  // Un panel que ya no existe en la sesión suelta su bridge: cerrar un panel SÍ
  // cierra (ocultar —cambiar de pestaña— no). Solo con la sesión en línea: un
  // snapshot vacío durante una caída no debe vaciar el pool.
  $effect(() => {
    const paneIds = session.panes.map((pane) => pane.pane_id);
    if (session.connection !== 'online' || paneIds.length === 0) return;
    pool.sync(paneIds);
  });
  const sidebarMode = $derived(
    ui.sidebarCollapsed ? settings.values.sidebar_collapsed_mode : 'expanded',
  );

  // El árbol del tab visible se pide al entrar al tab y se vuelve a pedir cuando
  // el backend publica un snapshot nuevo (`revision` sube con cada refresco).
  $effect(() => {
    const tabId = visibleTabId;
    const revision = session.revision;
    layout.schedule(tabId, revision);
  });

  // Al (re)conectar se rehace el árbol: los paneles visibles reabren sus bridges.
  $effect(() => {
    const epoch = session.connectionEpoch;
    if (epoch > 0) void layout.refreshNow(visibleTabId);
  });

  $effect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${settings.widthPx}px`);
  });

  // T2.5 — El audio de los avisos se arma en el primer gesto del usuario (los
  // navegadores no dejan sonar sin interacción). Es una sola vez y no bloquea.
  $effect(() => {
    const arm = (): void => noticeSound.arm();
    window.addEventListener('pointerdown', arm, { once: true, capture: true });
    window.addEventListener('keydown', arm, { once: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', arm, { capture: true });
      window.removeEventListener('keydown', arm, { capture: true });
    };
  });

  // T2.5 — Avisos de agente: se compara el snapshot nuevo con el anterior en
  // cada refresco del store (que ya refresca por evento) y, si el usuario los
  // tiene activados, se agrupan antes de pintar el toast.
  $effect(() => {
    // La revisión sube con cada refresco del store (aunque la lista venga
    // igual): el centro la usa para no mirar dos veces el mismo snapshot.
    const revision = session.revision;
    noticeCenter.observe(
      session.agents,
      {
        focusedPaneId: ui.localFocusedPaneId ?? session.focusedPaneId,
        windowFocused: document.hasFocus(),
      },
      revision,
    );
  });

  // T2.4 — El conteo de agentes bloqueados va al overlay del icono de la barra
  // de tareas (el backend lo pinta). Solo se llama cuando el número cambia.
  $effect(() => {
    const blocked = blockedCount(session.agents);
    void syncBlockedOverlay(blocked);
  });

  function isTypingTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    if (!element || typeof element.tagName !== 'string') return false;
    if (element.closest('.xterm')) return false; // la terminal sí recibe las teclas
    return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
  }

  const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'AltGraph']);

  function onKeydown(event: KeyboardEvent): void {
    // Las teclas modificadoras solas no son un atajo: si se procesaran, el
    // Control de «Ctrl+B» consumiría el modo prefix antes de la «b».
    if (MODIFIER_KEYS.has(event.key)) return;

    // 1. Atajos globales de la GUI (siempre activos).
    const gui = keymap.resolveGuiShortcut(event);
    if (gui) {
      event.preventDefault();
      event.stopPropagation();
      // Un atajo de la GUI sale del modo prefix: si no, la siguiente tecla se
      // interpretaría como combinación con prefijo (y ejecutaría otra acción).
      ui.prefixActive = false;
      void runAction(gui);
      return;
    }

    // Mientras se escribe en un campo, solo Escape sale del modo.
    if (isTypingTarget(event.target)) return;

    // 2. Escape cierra lo que esté abierto.
    if (event.key === 'Escape') {
      const somethingOpen =
        ui.paletteOpen ||
        ui.helpOpen ||
        ui.contextMenu !== null ||
        ui.sessionsOpen ||
        ui.prefixActive;
      if (somethingOpen) {
        event.preventDefault();
        event.stopPropagation();
        if (ui.prefixActive) ui.prefixActive = false;
        else if (ui.helpOpen) ui.helpOpen = false;
        else if (ui.sessionsOpen) ui.closeSessions();
        else if (ui.contextMenu) ui.closeContextMenu();
        else ui.closePalette();
      }
      return;
    }

    // 3. La tecla de prefix entra y sale del modo prefix; pulsarla dos veces manda
    //    el Ctrl+B literal a la terminal (como la TUI).
    if (keymap.isPrefixKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      if (ui.prefixActive) {
        ui.prefixActive = false;
        window.dispatchEvent(
          new CustomEvent('herdr-desk:terminal', {
            detail: { channel: 'input', detail: '\u0002' },
          }),
        );
      } else {
        ui.prefixActive = true;
      }
      return;
    }

    // 4. Atajo resuelto por el motor.
    const resolved = keymap.resolveForEvent(event, ui.prefixActive);
    if (resolved) {
      event.preventDefault();
      event.stopPropagation();
      if ('literalPrefix' in resolved) {
        // prefix dos veces: se manda el ctrl+b literal al panel enfocado.
        window.dispatchEvent(
          new CustomEvent('herdr-desk:terminal', {
            detail: { channel: 'input', detail: '\u0002' },
          }),
        );
      } else {
        void runAction(resolved.action);
      }
      ui.prefixActive = false;
      return;
    }

    // 5. En modo prefix, una tecla sin acción avisa y sale del modo.
    if (ui.prefixActive) {
      event.preventDefault();
      event.stopPropagation();
      ui.prefixActive = false;
      ui.notify(es.keys.unbound, 'warn');
    }
    // Todo lo demás sigue su camino a la terminal.
  }

  onMount(() => {
    window.addEventListener('keydown', onKeydown, true);
    // El menú de contexto nativo del WebView2 no se quiere en ninguna zona: los
    // menús propios (terminal, paneles, pestañas, espacios) siguen abriéndose.
    const unsuppress = suppressNativeContextMenu(window);
    return () => {
      window.removeEventListener('keydown', onKeydown, true);
      unsuppress();
    };
  });
</script>

<div class="shell-fallback"></div>
<div class="bg-layer bg-mesh"></div>
<div class="bg-layer bg-noise"></div>

<div class="shell">
  <Titlebar />
  <ReconnectBanner />

  <main class="body" data-sidebar={sidebarMode}>
    <Sidebar />

    <section class="panes" data-testid="panes">
      <TabBar />
      <div class="panes__area" data-testid="split-area">
        {#if tree}
          <SplitTree node={tree} />
        {:else if session.focusedTabId}
          <p class="empty-note" data-testid="no-panes">{es.panes.noPanes}</p>
        {:else}
          <p class="empty-note" data-testid="no-pane">{es.terminal.noPane}</p>
        {/if}
      </div>
    </section>
  </main>

  <StatusBar />
</div>

<AgentPromptDialog />
<StartAgentDialog />
<TextViewer />

{#key ui.paletteSession}
  <CommandPalette />
{/key}

{#if ui.helpOpen}
  <Cheatsheet />
{/if}

{#key ui.pendingConfirm}
  <ConfirmDialog />
{/key}
{#key ui.pendingPrompt}
  <PromptDialog />
{/key}
{#key ui.pendingWorkspaceForm}
  <WorkspaceDialog />
{/key}
<SessionsDialog />
<ContextMenu />
<ToastHost />
