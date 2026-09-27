<!-- Botón de icono con tooltip y estado activo. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    onclick?: (event: MouseEvent) => void;
    active?: boolean;
    danger?: boolean;
    disabled?: boolean;
    testId?: string;
    size?: number;
    children: Snippet;
  }

  let {
    label,
    onclick,
    active = false,
    danger = false,
    disabled = false,
    testId,
    size = 28,
    children,
  }: Props = $props();
</script>

<button
  type="button"
  class="icon-button"
  data-testid={testId}
  data-active={active}
  data-danger={danger}
  title={label}
  aria-label={label}
  aria-pressed={active}
  {disabled}
  style="--icon-size:{size}px"
  {onclick}
>
  {@render children()}
</button>

<style>
  .icon-button {
    display: grid;
    place-items: center;
    inline-size: var(--icon-size);
    block-size: var(--icon-size);
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    transition:
      background var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease),
      border-color var(--t-fast) var(--ease);
  }

  .icon-button:hover:not([disabled]) {
    background: var(--control-hover-bg);
    color: var(--text);
  }

  .icon-button:active:not([disabled]) {
    background: var(--control-pressed-bg);
  }

  .icon-button[data-active='true'] {
    background: var(--control-active-bg);
    border-color: var(--control-active-border);
    color: var(--text);
  }

  .icon-button[data-danger='true']:hover:not([disabled]) {
    background: var(--danger-bg);
    color: var(--danger-contrast);
  }

  .icon-button[disabled] {
    opacity: var(--control-disabled-opacity);
    cursor: default;
  }
</style>
