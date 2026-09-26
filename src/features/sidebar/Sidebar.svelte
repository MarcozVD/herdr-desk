<!-- Sidebar glass (T1.6): espacios con número, label, rollup de estado, conteos y
     activo; agentes ordenados por prioridad. Renombrar/cerrar por menú contextual. -->
<script lang="ts">
  import { flows } from '../../lib/actions/flows';
  import { es } from '../../lib/i18n/es';
  import { session } from '../../lib/stores/session.svelte';
  import { settings } from '../../lib/stores/settings.svelte';
  import { ui } from '../../lib/stores/ui.svelte';
  import AgentDot from '../../lib/ui/AgentDot.svelte';
  import AgentPanel from '../agents/AgentPanel.svelte';

  const collapsedMode = $derived(settings.values.sidebar_collapsed_mode);
</script>

<aside
  class="sidebar glass"
  data-testid="sidebar"
  data-collapsed-mode={collapsedMode}
  aria-label={es.sidebar.workspaces}
>
  <div class="sidebar__section">
    <h2 class="sidebar__title">
      <span>{es.sidebar.workspaces}</span>
      <span class="sidebar__count" data-testid="workspaces-count">{session.workspaces.length}</span>
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
          aria-current={workspace.focused || ui.localFocusedWorkspaceId === workspace.workspace_id}
          onclick={() => flows.focusWorkspace(workspace.workspace_id)}
          ondblclick={() => void flows.renameWorkspace(workspace.workspace_id)}
          oncontextmenu={(event) => flows.openWorkspaceMenu(event, workspace.workspace_id)}
        >
          <span class="workspace-row__number">{workspace.number}</span>
          <AgentDot
            status={workspace.agent_status}
            label={es.agentStatus[workspace.agent_status]}
          />
          <span class="workspace-row__label">{workspace.label}</span>
          <span
            class="workspace-row__count"
            title={es.sidebar.panesCount.replace('{n}', String(workspace.pane_count))}
            >{workspace.pane_count}</span
          >
        </button>
      {/each}
    {/if}
    <button
      type="button"
      class="sidebar__action"
      data-testid="new-workspace"
      onclick={() => void flows.createWorkspace()}
    >
      + {es.sidebar.newWorkspace}
    </button>
  </div>

  <div class="sidebar__section">
    <AgentPanel />
  </div>
</aside>

<style>
  .sidebar__count {
    font-variant-numeric: tabular-nums;
  }

  .sidebar__action {
    margin-block-start: var(--space-1);
    padding: 5px var(--space-2);
    border: 1px dashed var(--glass-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-dim);
    font: inherit;
    font-size: 12px;
    text-align: start;
    cursor: pointer;
  }

  .sidebar__action:hover {
    color: var(--text);
    border-color: color-mix(in oklab, var(--accent) 45%, transparent);
  }
</style>
