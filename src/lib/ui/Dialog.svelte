<!-- Diálogo glass con foco, Esc y scrim. Las acciones van en el snippet `footer`. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  import { es } from '../i18n/es';

  interface Props {
    title: string;
    onclose: () => void;
    children: Snippet;
    footer?: Snippet;
    width?: string;
    testId?: string;
    closeLabel?: string;
    /** z-index del overlay: los diálogos abiertos desde otro diálogo van por encima. */
    level?: number;
  }

  let {
    title,
    onclose,
    children,
    footer,
    width = '30rem',
    testId = 'dialog',
    closeLabel = es.dialog.close,
    level = 20,
  }: Props = $props();

  let panel = $state<HTMLDivElement | null>(null);

  $effect(() => {
    panel?.focus();
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onclose();
    }
  }
</script>

<div class="overlay" style="--dialog-level:{level}">
  <button
    type="button"
    class="overlay__scrim"
    data-testid="{testId}-scrim"
    aria-label={closeLabel}
    onclick={onclose}
  ></button>
  <div
    class="dialog glass-overlay"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    bind:this={panel}
    data-testid={testId}
    style="--dialog-width:{width}"
    onkeydown={onKeydown}
  >
    <header class="dialog__head">
      <h2 class="dialog__title">{title}</h2>
      <button
        type="button"
        class="dialog__close"
        data-testid="{testId}-close"
        aria-label={closeLabel}
        onclick={onclose}>×</button
      >
    </header>
    <div class="dialog__body">{@render children()}</div>
    {#if footer}
      <footer class="dialog__foot">{@render footer()}</footer>
    {/if}
  </div>
</div>

<style>
  .dialog {
    position: relative;
    inline-size: min(var(--dialog-width), 92vw);
    max-block-size: 80vh;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
  }

  .dialog__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-block-end: 1px solid var(--glass-border);
  }

  .dialog__title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .dialog__close {
    border: none;
    background: transparent;
    color: var(--text-dim);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
  }

  .dialog__close:hover {
    background: color-mix(in oklab, var(--text) 12%, transparent);
    color: var(--text);
  }

  .dialog__body {
    padding: var(--space-4);
    overflow: auto;
    display: grid;
    gap: var(--space-3);
  }

  .dialog__foot {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-block-start: 1px solid var(--glass-border);
  }
</style>
