<!-- T2.1 — Panel de agentes de la sidebar.
     Lista `snapshot.agents` con el orden de `ui.agent_panel_sort` (spaces agrupa
     por espacio; priority es la cola de atención), filtrable por texto y con las
     filas que diga la config `[ui.sidebar.agents]` (rows / rows_by_agent /
     row_gap) y sus tokens `$name` de metadata. Respeta el ancho de la sidebar y
     su colapso: en modo compacto quedan solo los iconos de estado (app.css). -->
<script lang="ts">
  import { flows } from '../../lib/actions/flows';
  import {
    agentRowGap,
    agentRowsFor,
    buildAgentPanel,
    blockedCount,
    normalizeAgentPanelSort,
    resolveAgentToken,
    type AgentTokenStyle,
  } from '../../lib/agents/agentPanel';
  import { es } from '../../lib/i18n/es';
  import { session } from '../../lib/stores/session.svelte';
  import { settings } from '../../lib/stores/settings.svelte';
  import AgentDot from '../../lib/ui/AgentDot.svelte';
  import type { AgentInfo } from '../../lib/herdr/types';

  let query = $state('');

  const sortMode = $derived(normalizeAgentPanelSort(settings.values.agent_panel_sort));
  const rowsConfig = $derived({
    rows: settings.values.agent_rows,
    rowsByAgent: settings.values.agent_rows_by_agent,
    rowGap: settings.values.agent_row_gap,
  });
  const sections = $derived(
    buildAgentPanel({
      agents: session.agents,
      workspaces: session.workspaces,
      mode: sortMode,
      query,
    }),
  );
  const total = $derived(session.agents.length);
  const blocked = $derived(blockedCount(session.agents));
  const filtering = $derived(query.trim().length > 0);
  /** Filas en blanco entre agentes (`row_gap` de la config). */
  const gaps = $derived(Array.from({ length: agentRowGap(rowsConfig) }, (_, index) => index));

  function toggleSort(): void {
    settings.set('agent_panel_sort', sortMode === 'spaces' ? 'priority' : 'spaces');
  }

  function tabFor(agent: AgentInfo) {
    return session.tabs.find((tab) => tab.tab_id === agent.tab_id) ?? null;
  }

  function workspaceFor(agent: AgentInfo) {
    return session.workspaces.find((space) => space.workspace_id === agent.workspace_id) ?? null;
  }

  /** Estilo inline del token (`fg`/`bold`/`dim` de la config). */
  function tokenStyle(style: AgentTokenStyle): string {
    const parts: string[] = [];
    if (style.fg) parts.push(`color:${style.fg}`);
    if (style.bold) parts.push('font-weight:600');
    if (style.dim) parts.push('opacity:0.65');
    return parts.join(';');
  }
</script>

<section class="agent-panel" data-testid="agent-panel" data-sort={sortMode}>
  <h2 class="sidebar__title">
    <span>{es.sidebar.agents}</span>
    <span class="sidebar__count" data-testid="agents-count">{total}</span>
  </h2>

  <div class="agent-panel__tools">
    <input
      class="agent-panel__filter"
      type="search"
      data-testid="agent-panel-filter"
      placeholder={es.sidebar.filterAgents}
      aria-label={es.sidebar.filterAgents}
      bind:value={query}
    />
    <button
      type="button"
      class="agent-panel__sort"
      data-testid="agent-panel-sort"
      title={es.sidebar.sortAgentsHint}
      aria-label={es.sidebar.sortAgentsHint}
      onclick={toggleSort}
    >
      {sortMode === 'spaces' ? es.sidebar.sortSpaces : es.sidebar.sortPriority}
    </button>
  </div>

  {#if blocked > 0}
    <p class="agent-panel__blocked" data-testid="agents-blocked">
      {es.sidebar.blockedCount.replace('{n}', String(blocked))}
    </p>
  {/if}

  {#if sections.length === 0}
    <p class="empty-note" data-testid="agents-empty">
      {filtering ? es.sidebar.noAgentsMatch : es.sidebar.noAgents}
    </p>
  {:else}
    {#each sections as section (section.id)}
      <div class="agent-panel__section" data-testid="agent-section" data-workspace-id={section.id}>
        {#if section.title.length > 0}
          <p class="agent-panel__section-title" data-testid="agent-section-title">
            {section.title}
          </p>
        {/if}
        {#each section.agents as agent (agent.pane_id)}
          <button
            type="button"
            class="agent-row"
            data-testid="agent-row"
            data-pane-id={agent.pane_id}
            data-status={agent.agent_status}
            data-agent={agent.agent ?? ''}
            aria-current={agent.pane_id === session.focusedPaneId}
            onclick={() => flows.focusPane(agent.pane_id)}
          >
            {#each agentRowsFor(agent, rowsConfig) as row, rowIndex (rowIndex)}
              <span class="agent-row__line">
                {#each row as token, tokenIndex (tokenIndex)}
                  {@const resolved = resolveAgentToken(token, {
                    agent,
                    workspace: workspaceFor(agent),
                    tab: tabFor(agent),
                    stateLabels: es.agentStatus,
                  })}
                  {#if resolved?.kind === 'icon'}
                    <AgentDot
                      status={resolved.status ?? 'unknown'}
                      label={es.agentStatus[resolved.status ?? 'unknown']}
                    />
                  {:else if resolved}
                    <span
                      class="agent-row__token"
                      data-token={resolved.id}
                      style={tokenStyle(resolved.style)}>{resolved.text}</span
                    >
                  {/if}
                {/each}
              </span>
            {/each}
            {#each gaps as gapIndex (gapIndex)}
              <span class="agent-row__gap" data-testid="agent-row-gap"></span>
            {/each}
          </button>
        {/each}
      </div>
    {/each}
  {/if}
</section>

<style>
  .agent-panel__tools {
    display: flex;
    gap: var(--space-1);
    margin-block-end: var(--space-1);
  }

  .agent-panel__filter {
    min-inline-size: 0;
    flex: 1 1 auto;
    padding: 3px var(--space-2);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--surface-dim) 45%, transparent);
    color: var(--text);
    font: inherit;
    font-size: 12px;
  }

  .agent-panel__filter:focus {
    outline: none;
    border-color: color-mix(in oklab, var(--accent) 45%, transparent);
  }

  .agent-panel__sort {
    flex: 0 0 auto;
    padding: 3px var(--space-2);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-dim);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .agent-panel__sort:hover {
    color: var(--text);
    border-color: color-mix(in oklab, var(--accent) 45%, transparent);
  }

  .agent-panel__blocked {
    margin: 0 0 var(--space-1);
    color: var(--yellow);
    font-size: 11px;
  }

  .agent-panel__section-title {
    margin: var(--space-1) 0 2px;
    color: var(--text-dim);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .agent-panel__section:first-child .agent-panel__section-title {
    margin-block-start: 0;
  }

  .agent-row {
    display: flex;
    flex-direction: column;
    gap: 1px;
    inline-size: 100%;
    padding: 3px var(--space-1);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .agent-row:hover {
    background: color-mix(in oklab, var(--active-row-bg) 55%, transparent);
  }

  .agent-row[aria-current='true'] {
    background: color-mix(in oklab, var(--active-row-bg) 85%, transparent);
  }

  .agent-row__line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-inline-size: 0;
  }

  .agent-row__token {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  /* La segunda fila (y siguientes) es metadata: más pequeña y apagada. */
  .agent-row__line + .agent-row__line .agent-row__token {
    color: var(--text-dim);
    font-size: 11px;
  }

  .agent-row__gap {
    block-size: 6px;
  }
</style>
