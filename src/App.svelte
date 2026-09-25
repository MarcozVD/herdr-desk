<!-- Shell del spike F0: titlebar glass con drag region, sidebar glass con los
     espacios del snapshot en vivo, un TerminalView del panel enfocado y status
     bar glass. Solo tres superficies con backdrop-filter (titlebar, sidebar,
     status bar): el §3 limita a 5 vivas a la vez. -->
<script lang="ts">
  import { onMount } from 'svelte';

  import { es } from './lib/i18n/es';
  import ConnectionPill from './lib/ui/ConnectionPill.svelte';
  import WindowControls from './lib/ui/WindowControls.svelte';
  import TerminalView from './lib/terminal/TerminalView.svelte';
  import { session } from './lib/stores/session.svelte';
  import { paneTitle, shortPath } from './lib/stores/snapshot';
  import { ui } from './lib/stores/ui.svelte';
  import type { WorkspaceInfo } from './lib/herdr/types';

  const focusedPane = $derived(session.focusedPane);
  const paneStatus = $derived(focusedPane?.agent_status ?? 'unknown');
  const scroll = $derived(focusedPane?.scroll ?? null);
  const scrollLabel = $derived(
    scroll
      ? es.statusbar.scroll
          .replace('{offset}', String(scroll.offset_from_bottom))
          .replace('{max}', String(scroll.max_offset_from_bottom))
      : es.statusbar.scroll.replace('{offset}', '0').replace('{max}', '0'),
  );
  const versionLabel = $derived(
    session.version
      ? es.app.version
          .replace('{version}', session.version)
          .replace('{protocol}', String(session.protocol ?? '?'))
      : '',
  );

  function focusWorkspace(workspace: WorkspaceInfo): void {
    // R11: por defecto el foco es local y no mueve la TUI. Solo si el usuario
    // activa «Sincronizar foco con TUI» se llama a workspace.focus.
    ui.focusWorkspaceLocally(workspace.workspace_id);
    if (ui.syncFocusWithTui) void session.focusWorkspace(workspace.workspace_id);
  }

  /** Número del espacio al que pertenece un agente (alinea las columnas). */
  function workspaceNumber(workspaceId: string): string {
    const workspace = session.workspaces.find((item) => item.workspace_id === workspaceId);
    return workspace ? String(workspace.number) : '';
  }

  function onKeydown(event: KeyboardEvent): void {
    // Únicos atajos globales de la GUI en F0 (§T1.10 los completa en F1). El
    // listener va en fase de captura sobre window: si el atajo es de la GUI, se
    // corta la propagación para que xterm no lo reciba.
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      event.stopPropagation();
      ui.togglePalette();
      return;
    }
    if (event.key === 'Escape' && ui.paletteOpen) {
      event.preventDefault();
      event.stopPropagation();
      ui.closePalette();
    }
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
  <header class="titlebar glass" data-tauri-drag-region data-testid="titlebar">
    <div class="titlebar__side">
      <span class="titlebar__brand">herdr</span>
      <span class="titlebar__session" data-testid="session-label">
        {es.app.session}: {session.sessionName ?? es.app.sessionUnknown}
      </span>
    </div>

    <button
      type="button"
      class="titlebar__palette"
      data-testid="palette-button"
      onclick={() => ui.togglePalette()}
    >
      <span>{es.titlebar.palette}</span>
      <span class="kbd">Ctrl+Shift+P</span>
    </button>

    <div class="titlebar__side titlebar__side--right">
      <ConnectionPill />
      <WindowControls />
    </div>
  </header>

  <main class="body" data-sidebar={ui.sidebarCollapsed ? 'collapsed' : 'expanded'}>
    <aside class="sidebar glass" data-testid="sidebar" aria-label={es.sidebar.workspaces}>
      <div class="sidebar__section">
        <h2 class="sidebar__title">
          <span>{es.sidebar.workspaces}</span>
          <span data-testid="workspaces-count">{session.workspaces.length}</span>
        </h2>
        {#if session.workspaces.length === 0}
          <p class="empty-note" data-testid="workspaces-empty">
            {session.connection === 'online' ? es.sidebar.noWorkspaces : es.sidebar.emptyState}
          </p>
        {:else}
          {#each session.workspaces as workspace (workspace.workspace_id)}
            <button
              type="button"
              class="workspace-row"
              data-testid="workspace-row"
              data-workspace-id={workspace.workspace_id}
              data-status={workspace.agent_status}
              aria-current={workspace.focused ||
                ui.localFocusedWorkspaceId === workspace.workspace_id}
              onclick={() => focusWorkspace(workspace)}
            >
              <span class="workspace-row__number">{workspace.number}</span>
              <span class="agent-dot" data-state={workspace.agent_status}></span>
              <span class="workspace-row__label">{workspace.label}</span>
              <span class="workspace-row__count">{workspace.pane_count}</span>
            </button>
          {/each}
        {/if}
      </div>

      <div class="sidebar__section">
        <h2 class="sidebar__title">
          <span>{es.sidebar.agents}</span>
          <span data-testid="agents-count">{session.agents.length}</span>
        </h2>
        {#if session.agents.length === 0}
          <p class="empty-note" data-testid="agents-empty">{es.sidebar.noAgents}</p>
        {:else}
          {#each session.agents as agent (agent.pane_id)}
            <div
              class="agent-row"
              data-testid="agent-row"
              data-pane-id={agent.pane_id}
              data-status={agent.agent_status}
            >
              <span class="agent-dot" data-state={agent.agent_status}></span>
              <span class="agent-row__number">{workspaceNumber(agent.workspace_id)}</span>
              <span class="agent-row__name"
                >{agent.display_agent ?? agent.agent ?? agent.pane_id}</span
              >
              <span class="agent-row__meta">{es.agentStatus[agent.agent_status]}</span>
            </div>
          {/each}
        {/if}
      </div>
    </aside>

    <section class="panes">
      {#if session.focusedPaneId}
        <article class="pane-frame" data-testid="pane-frame" data-pane-id={session.focusedPaneId}>
          <header class="pane-header">
            <span class="agent-dot" data-state={paneStatus}></span>
            <span class="pane-header__title" data-testid="pane-title">
              {paneTitle(focusedPane)}
            </span>
            <span data-testid="pane-status">{es.agentStatus[paneStatus]}</span>
            <span class="pane-header__spacer"></span>
            <span data-testid="pane-cwd">{shortPath(focusedPane?.cwd)}</span>
          </header>
          <TerminalView paneId={session.focusedPaneId} />
        </article>
      {:else}
        <p class="empty-note" data-testid="no-pane">{es.terminal.noPane}</p>
      {/if}
    </section>
  </main>

  <footer class="statusbar glass" data-testid="statusbar">
    <span class="statusbar__item" data-testid="status-pane">
      {es.statusbar.pane}
      {session.focusedPaneId ?? '—'}
    </span>
    <span class="statusbar__item" data-testid="status-cwd">
      {shortPath(focusedPane?.cwd) || '—'}
    </span>
    <span class="statusbar__item" data-testid="status-scroll">{scrollLabel}</span>
    <span class="statusbar__spacer"></span>
    <span class="statusbar__item" data-testid="status-version">{versionLabel}</span>
  </footer>
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
    >
      <input class="palette__input" placeholder={es.titlebar.palette} readonly />
      <p class="palette__note">{es.palette.comingSoon}</p>
    </div>
  </div>
{/if}
