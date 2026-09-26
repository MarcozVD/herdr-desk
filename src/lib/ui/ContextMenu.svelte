<!-- Menú contextual (paneles, tabs y terminal). Se cierra con Esc, con clic
     fuera o al ejecutar una acción. -->
<script lang="ts">
  import { ui } from '../stores/ui.svelte';

  const menu = $derived(ui.contextMenu);

  let el = $state<HTMLDivElement | null>(null);
  let placed = $state<{ x: number; y: number } | null>(null);
  let lastMenu: unknown = null;

  // El menú se ancla al punto del clic.
  $effect(() => {
    if (!menu) {
      lastMenu = null;
      placed = null;
      return;
    }
    if (menu === lastMenu) return;
    lastMenu = menu;
    placed = { x: menu.x, y: menu.y };
  });

  // …pero se CORRE hacia dentro si no cabe: abierto desde el panel del borde
  // derecho se recortaba contra la ventana y no se leían sus etiquetas.
  $effect(() => {
    const at = placed;
    if (!el || !at) return;
    const rect = el.getBoundingClientRect();
    const margin = 6;
    const x = Math.max(margin, Math.min(at.x, window.innerWidth - rect.width - margin));
    const y = Math.max(margin, Math.min(at.y, window.innerHeight - rect.height - margin));
    if (x !== at.x || y !== at.y) placed = { x, y };
  });

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
    bind:this={el}
    style="left:{placed?.x ?? menu.x}px; top:{placed?.y ?? menu.y}px"
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
