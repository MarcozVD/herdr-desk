<!-- Titlebar glass (T1.6): drag region, selector de sesión, botón de paleta, chip
     de PREFIX, píldora de conexión y controles de ventana. -->
<script lang="ts">
  import { Search } from '@lucide/svelte';

  import { es } from '../../lib/i18n/es';
  import { session } from '../../lib/stores/session.svelte';
  import { ui } from '../../lib/stores/ui.svelte';
  import IconButton from '../../lib/ui/IconButton.svelte';
  import WindowControls from '../../lib/ui/WindowControls.svelte';
  import ConnectionPill from './ConnectionPill.svelte';

  const sessionLabel = $derived(session.sessionName ?? es.app.sessionUnknown);
</script>

<header class="titlebar glass" data-tauri-drag-region data-testid="titlebar">
  <div class="titlebar__side">
    <IconButton
      label={es.titlebar.toggleSidebar}
      testId="sidebar-toggle"
      active={!ui.sidebarCollapsed}
      onclick={() => ui.toggleSidebar()}
    >
      <span aria-hidden="true">☰</span>
    </IconButton>
    <span class="titlebar__brand">herdr</span>
    <button
      type="button"
      class="titlebar__session"
      data-testid="session-label"
      title={es.titlebar.sessionSelector}
      onclick={() => ui.openSessions()}
    >
      {es.app.session}: {sessionLabel}
    </button>
    {#if ui.prefixActive}
      <span class="prefix-chip" data-testid="prefix-chip">{es.keys.prefixChip}</span>
    {/if}
  </div>

  <button
    type="button"
    class="titlebar__palette"
    data-testid="palette-button"
    onclick={() => ui.togglePalette()}
  >
    <Search size={13} aria-hidden="true" />
    <span>{es.titlebar.palette}</span>
    <span class="kbd">Ctrl+Shift+P</span>
  </button>

  <div class="titlebar__side titlebar__side--right">
    <IconButton label={es.keys.help} testId="help-button" onclick={() => ui.toggleHelp()}>
      <span aria-hidden="true">?</span>
    </IconButton>
    <ConnectionPill />
    <WindowControls />
  </div>
</header>

<style>
  .prefix-chip {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--warn-bg);
    border: 1px solid var(--warn-border-strong);
    color: var(--text);
    font-size: 11px;
    letter-spacing: 0.08em;
  }
</style>
