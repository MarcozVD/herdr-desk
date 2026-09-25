<!-- Shell completo de F1: titlebar con selector de sesión, franja de reconexión,
     sidebar de espacios y agentes, tab bar, árbol de splits y status bar. Los
     overlays (paleta, cheatsheet, diálogos, menú contextual y toasts) viven aquí
     para que solo haya un diálogo de cada tipo montado. -->
<script lang="ts">
  import { onMount } from 'svelte';

  import SessionsDialog from './features/sessions/SessionsDialog.svelte';
  import Sidebar from './features/sidebar/Sidebar.svelte';
  import StatusBar from './features/statusbar/StatusBar.svelte';
  import TabBar from './features/tabs/TabBar.svelte';
  import ReconnectBanner from './features/titlebar/ReconnectBanner.svelte';
  import Titlebar from './features/titlebar/Titlebar.svelte';
  import { es } from './lib/i18n/es';
  import { runAction } from './lib/keys/actions';
  import Cheatsheet from './lib/keys/Cheatsheet.svelte';
  import { keymap } from './lib/keys/keymap';
  import SplitTree from './lib/layout/SplitTree.svelte';
  import { zoomedTree } from './lib/layout/tree';
  import { layout } from './lib/stores/layout.svelte';
  import { session } from './lib/stores/session.svelte';
  import { settings } from './lib/stores/settings.svelte';
  import { ui } from './lib/stores/ui.svelte';
  import ConfirmDialog from './lib/ui/ConfirmDialog.svelte';
  import ContextMenu from './lib/ui/ContextMenu.svelte';
  import PromptDialog from './lib/ui/PromptDialog.svelte';
  import ToastHost from './lib/ui/ToastHost.svelte';
  import WorkspaceDialog from './lib/ui/WorkspaceDialog.svelte';

  const tree = $derived(
    layout.zoomed ? zoomedTree(layout.tree, session.focusedPaneId) : layout.tree,
  );
  const sidebarMode = $derived(
    ui.sidebarCollapsed ? settings.values.sidebar_collapsed_mode : 'expanded',
  );

  // El árbol del tab visible se pide al entrar al tab y se vuelve a pedir cuando
  // el backend publica un snapshot nuevo (`revision` sube con cada refresco).
  $effect(() => {
    const tabId = session.focusedTabId;
    const revision = session.revision;
    layout.schedule(tabId, revision);
  });

  // Al (re)conectar se rehace el árbol: los paneles visibles reabren sus bridges.
  $effect(() => {
    const epoch = session.connectionEpoch;
    if (epoch > 0) void layout.refreshNow(session.focusedTabId);
  });

  $effect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${settings.widthPx}px`);
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
    return () => window.removeEventListener('keydown', onKeydown, true);
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

{#if ui.paletteOpen}
  <div class="overlay">
    <button
      type="button"
      class="overlay__scrim"
      data-testid="palette-scrim"
      aria-label={es.palette.close}
      onclick={() => ui.closePalette()}
    ></button>
    <div
      class="palette glass-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={es.palette.title}
      tabindex="-1"
      data-testid="palette"
    >
      <input class="palette__input" placeholder={es.titlebar.palette} readonly />
      <p class="palette__note">{es.palette.comingSoon}</p>
    </div>
  </div>
{/if}

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
