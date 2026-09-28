<!-- Sidebar glass (T1.6): espacios con número, label, rollup de estado, conteos y
     activo; agentes ordenados por prioridad. Renombrar/cerrar por menú contextual. -->
<script lang="ts">
  import { flows } from '../../lib/actions/flows';
  import { gitStatuses } from '../../lib/git/status.svelte';
  import { es } from '../../lib/i18n/es';
  import { session } from '../../lib/stores/session.svelte';
  import { visible } from '../../lib/stores/visible.svelte';
  import { settings } from '../../lib/stores/settings.svelte';
  import AgentPanel from '../agents/AgentPanel.svelte';
  import AgentRollup from '../../lib/ui/AgentRollup.svelte';
  import { agentsOfWorkspace } from '../../lib/agents/agentPanel';

  const collapsedMode = $derived(settings.values.sidebar_collapsed_mode);

  /* T3.2 — Reordenar espacios arrastrando una fila sobre otra. */
  let dragId = $state<string | null>(null);
  let dropId = $state<string | null>(null);

  function onRowDragStart(event: DragEvent, workspaceId: string): void {
    dragId = workspaceId;
    event.dataTransfer?.setData('application/x-herdr-workspace', workspaceId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function onRowDragOver(event: DragEvent, workspaceId: string): void {
    if (!event.dataTransfer || dragId === null || dragId === workspaceId) return;
    event.preventDefault();
    dropId = workspaceId;
  }

  function onRowDrop(event: DragEvent, workspaceId: string): void {
    event.preventDefault();
    const source = event.dataTransfer?.getData('application/x-herdr-workspace') ?? dragId;
    dropId = null;
    dragId = null;
    if (!source || source === workspaceId) return;
    const target = session.workspaces.findIndex((item) => item.workspace_id === workspaceId);
    if (target !== -1) void flows.moveWorkspaceTo(source, target);
  }
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
        {@const git = gitStatuses.infoOf(workspace.workspace_id)}
        <button
          type="button"
          class="workspace-row"
          class:drop-active={dropId === workspace.workspace_id}
          data-testid="workspace-row"
          data-workspace-id={workspace.workspace_id}
          data-status={workspace.agent_status}
          draggable="true"
          title={es.workspace.reorderHint}
          aria-current={visible.workspaceId === workspace.workspace_id}
          onclick={() => flows.focusWorkspace(workspace.workspace_id)}
          ondblclick={() => void flows.renameWorkspace(workspace.workspace_id)}
          ondragstart={(event) => onRowDragStart(event, workspace.workspace_id)}
          ondragover={(event) => onRowDragOver(event, workspace.workspace_id)}
          ondragleave={() => (dropId = null)}
          ondrop={(event) => onRowDrop(event, workspace.workspace_id)}
          oncontextmenu={(event) => flows.openWorkspaceMenu(event, workspace.workspace_id)}
        >
          <span class="workspace-row__number">{workspace.number}</span>
          <AgentRollup
            agents={agentsOfWorkspace(session.agents, workspace.workspace_id)}
            status={workspace.agent_status}
          />
          <span class="workspace-row__label">{workspace.label}</span>
          {#if git?.branch}
            <span
              class="workspace-row__git"
              data-testid="workspace-branch"
              title={es.sidebar.gitBranch.replace('{branch}', git.branch)}>{git.branch}</span
            >
          {/if}
          {#if git && git.dirty > 0}
            <span
              class="workspace-row__dirty"
              data-testid="workspace-dirty"
              title={es.sidebar.gitDirty.replace('{n}', String(git.dirty))}>●{git.dirty}</span
            >
          {/if}
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
  :global(.workspace-row.drop-active) {
    outline: 1px dashed var(--accent);
    outline-offset: -1px;
  }

  .workspace-row__git {
    font-size: 10px;
    color: var(--mauve);
    overflow: hidden;
    text-overflow: ellipsis;
    max-inline-size: 7rem;
    white-space: nowrap;
  }

  .workspace-row__dirty {
    font-size: 10px;
    color: var(--yellow);
  }

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
    background: var(--control-hover-bg);
    color: var(--text);
    border-color: var(--control-hover-border);
  }
</style>
