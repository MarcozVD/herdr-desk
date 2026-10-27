<!-- T4a — Hint del modo navegar (`goto`): muestra las teclas activas del ámbito
     `navigate` sin capturar el ratón. El modo lo gobierna App.svelte; esto solo
     pinta el estado para que el usuario sepa qué puede pulsar. -->
<script lang="ts">
  import { es } from '../i18n/es';
  import { bindingLabel } from './parse';
  import { keymap } from './keymap';
  import { ui } from '../stores/ui.svelte';

  const entries = $derived(keymap.navigateEntries);

  const LABELS: Record<string, string> = {
    navigate_workspace_up: es.keys.navigateWorkspaceUp,
    navigate_workspace_down: es.keys.navigateWorkspaceDown,
    navigate_pane_left: es.keys.navigatePaneLeft,
    navigate_pane_down: es.keys.navigatePaneDown,
    navigate_pane_up: es.keys.navigatePaneUp,
    navigate_pane_right: es.keys.navigatePaneRight,
  };
</script>

{#if ui.navigateMode}
  <div class="navigate-hint" data-testid="navigate-hint" role="status" aria-live="polite">
    <strong class="navigate-hint__title">{es.keys.navigateTitle}</strong>
    {#each entries as entry (entry.action)}
      <span class="navigate-hint__item">
        <kbd>{bindingLabel(entry.binding, keymap.prefixKey)}</kbd>
        {LABELS[entry.action] ?? entry.action}
      </span>
    {/each}
    <span class="navigate-hint__item">
      <kbd>1..9</kbd>
      {es.keys.navigateTabs}
    </span>
    <span class="navigate-hint__exit">{es.keys.navigateExit}</span>
  </div>
{/if}

<style>
  .navigate-hint {
    position: fixed;
    inset-block-end: 2.4rem;
    inset-inline: 0;
    margin-inline: auto;
    z-index: 45;
    inline-size: fit-content;
    max-inline-size: calc(100vw - 2rem);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    padding: 7px 12px;
    border: 1px solid var(--glass-border);
    border-radius: 999px;
    background: var(--panel-bg-solid);
    box-shadow: var(--shadow-lg);
    color: var(--text);
    font-size: 12px;
    pointer-events: none;
  }

  .navigate-hint__title {
    color: var(--accent);
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .navigate-hint__item,
  .navigate-hint__exit {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }

  .navigate-hint__item kbd {
    padding: 1px 5px;
    border: 1px solid var(--glass-border);
    border-radius: 4px;
    background: var(--control-bg-strong);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .navigate-hint__exit {
    color: var(--text-dim);
    font-size: 11px;
  }
</style>
