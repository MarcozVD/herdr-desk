<!-- Menú contextual (paneles, tabs y terminal). Se cierra con Esc, con clic
     fuera o al ejecutar una acción. -->
<script lang="ts">
  import { ui } from '../stores/ui.svelte';

  const menu = $derived(ui.contextMenu);

  function run(item: { disabled?: boolean; run: () => void | Promise<void> }): void {
    if (item.disabled) return;
    ui.closeContextMenu();
    void item.run();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      ui.closeContextMenu();
    }
  }
</script>

<svelte:window onclick={() => menu && ui.closeContextMenu()} />

{#if menu}
  <div
    class="context glass-overlay"
    role="menu"
    tabindex="-1"
    data-testid="context-menu"
    style="left:{menu.x}px; top:{menu.y}px"
    onkeydown={onKeydown}
    onclick={(event) => event.stopPropagation()}
  >
    {#each menu.items as item (item.id)}
      <button
        type="button"
        class="context__item"
        role="menuitem"
        data-testid="context-item"
        data-id={item.id}
        data-danger={item.danger}
        disabled={item.disabled}
        onclick={() => run(item)}
      >
        <span>{item.label}</span>
        {#if item.shortcut}<span class="kbd">{item.shortcut}</span>{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .context {
    position: fixed;
    z-index: 40;
    min-inline-size: 13rem;
    padding: var(--space-1);
    display: grid;
    gap: 1px;
    border-radius: var(--radius-sm);
  }

  .context__item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 6px var(--space-2);
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 13px;
    text-align: start;
    cursor: pointer;
  }

  .context__item:hover:not([disabled]) {
    background: color-mix(in oklab, var(--accent) 20%, transparent);
  }

  .context__item[data-danger='true']:hover:not([disabled]) {
    background: color-mix(in oklab, var(--red) 70%, transparent);
    color: #14151c;
  }

  .context__item[disabled] {
    opacity: 0.45;
    cursor: default;
  }

  .context__item .kbd {
    margin-inline-start: auto;
  }
</style>
