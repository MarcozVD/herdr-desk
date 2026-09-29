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
  import CompatBanner from './features/titlebar/CompatBanner.svelte';
  import ReconnectBanner from './features/titlebar/ReconnectBanner.svelte';
  import Titlebar from './features/titlebar/Titlebar.svelte';
  import { blockedCount } from './lib/agents/agentPanel';
  import { syncBlockedOverlay } from './lib/agents/taskbarOverlay';
  import { gitStatuses } from './lib/git/status.svelte';
  import { setMica } from './lib/herdr/client';
  import { glassAlphas } from './lib/theme/glass';
  import { es } from './lib/i18n/es';
  import { runAction } from './lib/keys/actions';
  import { flows } from './lib/actions/flows';
  import Cheatsheet from './lib/keys/Cheatsheet.svelte';
  import { keymap } from './lib/keys/keymap';
  import SplitTree from './lib/layout/SplitTree.svelte';
  import { zoomedTree } from './lib/layout/tree';
  import { layout } from './lib/stores/layout.svelte';
  import { pool } from './lib/terminal/pool';
  import { session } from './lib/stores/session.svelte';
  import { visible } from './lib/stores/visible.svelte';
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
   * Tab y panel que se están viendo: los resuelve `visible` en un solo sitio
   * (foco local de la GUI con respaldo en el del servidor; ver
   * `lib/stores/visible.svelte.ts`). Es lo que hace que un clic en la barra de
   * espacios se vea de verdad.
   */
  const visibleTabId = $derived(visible.tabId);
  const visiblePaneId = $derived(visible.actionPaneId);
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

  // T3.7 — Tema en vivo: aplica la paleta (CSS + xterm) y cambia Mica entre
  // oscuro y claro. `auto_switch` se reevalúa con prefers-color-scheme (abajo).
  $effect(() => {
    const fingerprint = [
      settings.values.theme_name,
      settings.values.theme_auto_switch,
      settings.values.theme_dark_name,
      settings.values.theme_light_name,
      settings.values.accent,
      settings.values.backdrop,
      settings.values.glass_level,
      JSON.stringify(settings.values.theme_custom),
    ].join('|');
    void fingerprint;
    settings.applyTheme();
    pool.applyXtermTheme();
    const light = document.documentElement.dataset.theme === 'light';
    const tint = glassAlphas(settings.values.glass_level, light).tint;
    void setMica(!light, settings.values.backdrop === 'acrylic', tint).catch(() => undefined);
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

  // T3.10 — Estado git de los espacios visibles (rama + cambios) para la
  // sidebar. Se refresca con cada revisión del snapshot, con límite interno.
  $effect(() => {
    const revision = session.revision;
    void revision;
    const list = session.workspaces.map((workspace) => {
      const pane = session.panes.find((item) => item.workspace_id === workspace.workspace_id);
      return {
        workspaceId: workspace.workspace_id,
        cwd: pane?.cwd ?? workspace.worktree?.checkout_path ?? null,
      };
    });
    void gitStatuses.refresh(list);
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

  const RESIZE_ARROWS: Record<string, 'left' | 'right' | 'up' | 'down'> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
  };

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

    // T3.1 — Modo redimensionar: las flechas mueven el divisor; Esc (o cualquier
    // otra tecla) sale. Va antes que el resto para que las flechas no lleguen a
    // la terminal mientras el modo está activo.
    if (ui.resizeMode) {
      const direction = RESIZE_ARROWS[event.key];
      if (direction) {
        event.preventDefault();
        event.stopPropagation();
        void flows.resizePane(direction);
        return;
      }
      if (event.key !== 'Shift' && event.key !== 'Control' && event.key !== 'Alt') {
        event.preventDefault();
        event.stopPropagation();
        ui.resizeMode = false;
      }
      return;
    }

    // 2. Escape cierra lo que esté abierto.
    if (event.key === 'Escape') {
      const somethingOpen =
        ui.paletteOpen ||
        ui.helpOpen ||
        ui.contextMenu !== null ||
        ui.sessionsOpen ||
        ui.settingsOpen ||
        ui.worktreesOpen ||
        ui.pluginsOpen ||
        ui.integrationsOpen ||
        ui.serverOpen ||
        ui.consoleOpen ||
        ui.advancedOpen ||
        ui.prefixActive;
      if (somethingOpen) {
        event.preventDefault();
        event.stopPropagation();
        if (ui.prefixActive) ui.prefixActive = false;
        else if (ui.helpOpen) ui.helpOpen = false;
        else if (ui.sessionsOpen) ui.closeSessions();
        else if (ui.settingsOpen) ui.closeSettings();
        else if (ui.worktreesOpen) ui.closeWorktrees();
        else if (ui.pluginsOpen) ui.closePlugins();
        else if (ui.integrationsOpen) ui.closeIntegrations();
        else if (ui.serverOpen) ui.closeServer();
        else if (ui.consoleOpen) ui.closeConsole();
        else if (ui.advancedOpen) ui.closeAdvanced();
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
    // `auto_switch`: al cambiar la apariencia del sistema se reevalúa el tema.
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = (): void => {
      settings.applyTheme();
      pool.applyXtermTheme();
    };
    scheme.addEventListener('change', onScheme);
    return () => {
      window.removeEventListener('keydown', onKeydown, true);
      scheme.removeEventListener('change', onScheme);
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
  <CompatBanner />

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

<!-- T5.2 — Diálogos pesados en chunks propios (lazy): no entran en el JS inicial
     (settings.gen, formularios, consola…). El import() se cachea: reabrir es
     instantáneo; la primera apertura muestra el chunk mientras llega. -->
{#if ui.settingsOpen}
  {#await import('./features/settings/SettingsDialog.svelte') then { default: SettingsDialog }}
    <SettingsDialog />
  {/await}
{/if}
{#if ui.worktreesOpen}
  {#await import('./features/worktrees/WorktreesDialog.svelte') then { default: WorktreesDialog }}
    <WorktreesDialog />
  {/await}
{/if}
{#if ui.pluginsOpen}
  {#await import('./features/plugins/PluginsDialog.svelte') then { default: PluginsDialog }}
    <PluginsDialog />
  {/await}
{/if}
{#if ui.integrationsOpen}
  {#await import('./features/integrations/IntegrationsDialog.svelte') then { default: IntegrationsDialog }}
    <IntegrationsDialog />
  {/await}
{/if}
{#if ui.serverOpen}
  {#await import('./features/server/ServerDialog.svelte') then { default: ServerDialog }}
    <ServerDialog />
  {/await}
{/if}
{#if ui.consoleOpen}
  {#await import('./features/console/ApiConsole.svelte') then { default: ApiConsole }}
    <ApiConsole />
  {/await}
{/if}
{#if ui.advancedOpen}
  {#await import('./features/advanced/AdvancedDialog.svelte') then { default: AdvancedDialog }}
    <AdvancedDialog />
  {/await}
{/if}

<ContextMenu />
<ToastHost />
