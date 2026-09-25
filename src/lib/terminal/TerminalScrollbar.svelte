<!-- Scrollbar propia del panel (T1.8): herdr manda el viewport y el scrollback
     vive en el server, así que la barra se dibuja desde `PaneInfo.scroll` y cada
     gesto se traduce a `terminal_scroll`. -->
<script lang="ts">
  import type { PaneScrollInfo } from '../herdr/types';

  interface Props {
    scroll: PaneScrollInfo | null;
    onscroll?: (direction: 'up' | 'down', lines: number) => void;
  }

  let { scroll, onscroll }: Props = $props();

  const max = $derived(scroll?.max_offset_from_bottom ?? 0);
  const offset = $derived(scroll?.offset_from_bottom ?? 0);
  const rows = $derived(scroll?.viewport_rows ?? 0);

  // Total de líneas = viewport + scrollback máximo.
  const total = $derived(max + Math.max(1, rows));
  const thumbHeight = $derived(Math.max(8, Math.round((Math.max(1, rows) / total) * 100)));
  const thumbTop = $derived(
    Math.max(0, Math.min(100 - thumbHeight, ((offset - max + max) / total) * 100)),
  );
  const hidden = $derived(max <= 0 || !scroll);

  function page(direction: 'up' | 'down'): void {
    onscroll?.(direction, Math.max(1, rows - 1));
  }
</script>

<div
  class="scrollbar"
  data-testid="terminal-scrollbar"
  data-hidden={hidden}
  aria-hidden={hidden}
  role="presentation"
>
  <button
    type="button"
    class="scrollbar__step"
    data-testid="scroll-step-up"
    aria-label="Scroll arriba"
    onclick={() => page('up')}
    onpointerenter={() => undefined}>▲</button
  >
  <div class="scrollbar__track">
    <button
      type="button"
      class="scrollbar__thumb"
      data-testid="scroll-thumb"
      aria-label="Posición del scroll"
      style="block-size:{thumbHeight}%; inset-block-start:{thumbTop}%"
      onclick={() => page('down')}
    ></button>
  </div>
  <button
    type="button"
    class="scrollbar__step"
    data-testid="scroll-step-down"
    aria-label="Scroll abajo"
    onclick={() => page('down')}>▼</button
  >
</div>

<style>
  .scrollbar {
    display: grid;
    grid-template-rows: auto 1fr auto;
    inline-size: 12px;
    margin-block: var(--space-1);
    margin-inline-end: 2px;
  }

  .scrollbar[data-hidden='true'] {
    visibility: hidden;
  }

  .scrollbar__track {
    position: relative;
    inline-size: 6px;
    margin-inline: auto;
    border-radius: 999px;
    background: color-mix(in oklab, var(--surface-dim) 35%, transparent);
  }

  .scrollbar__thumb {
    position: absolute;
    inline-size: 6px;
    left: 0;
    border: none;
    border-radius: 999px;
    background: color-mix(in oklab, var(--text-dim) 70%, transparent);
    padding: 0;
    cursor: pointer;
  }

  .scrollbar__step {
    border: none;
    background: transparent;
    color: var(--text-dim);
    font-size: 8px;
    line-height: 1;
    padding: 1px 0;
    cursor: pointer;
  }
</style>
