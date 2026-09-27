<!-- Tab bar glass (T1.6): pestañas del espacio enfocado, con position (top/bottom)
     y `hide_tab_bar_when_single_tab`. -->
<script lang="ts">
  import { flows } from '../../lib/actions/flows';
  import { es } from '../../lib/i18n/es';
  import { session } from '../../lib/stores/session.svelte';
  import { visible } from '../../lib/stores/visible.svelte';
  import { settings } from '../../lib/stores/settings.svelte';
  import AgentRollup from '../../lib/ui/AgentRollup.svelte';
  import { agentsOfTab } from '../../lib/agents/agentPanel';

  // Pestañas del espacio que se está VIENDO (foco local con respaldo del
  // servidor, `lib/stores/visible.svelte.ts`): antes se filtraban por el espacio
  // del servidor y al cambiar de espacio en la sidebar la barra se quedaba con
  // las pestañas del espacio anterior.
  const tabs = $derived(visible.tabs);
  const hidden = $derived(settings.values.hide_tab_bar_when_single_tab && tabs.length <= 1);
</script>

{#if !hidden}
  <nav
    class="tabbar glass"
    data-testid="tabbar"
    data-position={settings.values.tab_bar_position}
    aria-label={es.tabs.newTab}
  >
    {#each tabs as tab (tab.tab_id)}
      <button
        type="button"
        class="tab"
        data-testid="tab"
        data-tab-id={tab.tab_id}
        data-status={tab.agent_status}
        aria-current={tab.tab_id === visible.tabId}
        onclick={() => void flows.focusTab(tab.tab_id)}
        ondblclick={() => void flows.renameTab(tab.tab_id)}
        oncontextmenu={(event) => flows.openTabMenu(event, tab.tab_id)}
      >
        <AgentRollup agents={agentsOfTab(session.agents, tab.tab_id)} status={tab.agent_status} />
        <span class="tab__number">{tab.number}</span>
        <span class="tab__label">{tab.label}</span>
        <span
          class="tab__close"
          role="presentation"
          data-testid="tab-close"
          onclick={(event) => {
            event.stopPropagation();
            void flows.closeTab(tab.tab_id);
          }}>×</span
        >
      </button>
    {/each}
    <button
      type="button"
      class="tabbar__add"
      data-testid="new-tab"
      title={es.tabs.newTab}
      aria-label={es.tabs.newTab}
      onclick={() => void flows.newTab()}>+</button
    >
  </nav>
{/if}

<style>
  .tabbar {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0 var(--space-2);
    padding: 3px var(--space-2);
    border-radius: var(--radius-sm);
    overflow-x: auto;
  }

  .tabbar[data-position='bottom'] {
    order: 2;
    margin-block-start: var(--space-2);
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-dim);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }

  .tab:hover {
    background: var(--row-hover-bg);
    color: var(--text);
  }

  .tab:active {
    background: var(--control-pressed-bg);
  }

  .tab[aria-current='true'] {
    background: var(--row-current-bg);
    border-color: var(--row-current-border);
    color: var(--text);
  }

  .tab__number {
    font-family: var(--font-mono);
    font-size: 11px;
    opacity: 0.75;
  }

  .tab__close {
    opacity: 0;
    padding-inline: 2px;
    border-radius: 4px;
  }

  .tab:hover .tab__close {
    opacity: 0.8;
  }

  .tab__close:hover {
    background: var(--danger-bg);
    color: var(--danger-contrast);
  }

  .tabbar__add {
    margin-inline-start: 2px;
    inline-size: 22px;
    block-size: 22px;
    border: 1px dashed var(--glass-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    line-height: 1;
  }

  .tabbar__add:hover {
    background: var(--control-hover-bg);
    color: var(--text);
    border-color: var(--control-hover-border);
  }
</style>
