<!-- T3.2 — Render del árbol de splits con flex y los ratios del árbol. El divisor
     se arrastra con punteros (T3.1/T3.2): ratio optimista local mientras se
     arrastra y un ÚNICO `layout.set_split_ratio` al soltar. -->
<script lang="ts">
  import PaneFrame from '../../features/panes/PaneFrame.svelte';
  import { layoutApi } from '../herdr/actions';
  import { parseApiError } from '../herdr/errors';
  import { layout } from '../stores/layout.svelte';
  import { settings } from '../stores/settings.svelte';
  import { ui } from '../stores/ui.svelte';
  import type { TreeNode } from './tree';
  import SplitTree from './SplitTree.svelte';

  interface Props {
    node: TreeNode;
  }

  let { node }: Props = $props();

  /** Límites del ratio (los mismos que el backend y que `splitRect`). */
  const MIN_RATIO = 0.05;
  const MAX_RATIO = 0.95;

  function clamp(value: number): number {
    return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
  }

  const serverRatio = $derived(clamp(node.ratio ?? 0.5));
  /** Ratio optimista del arrastre: evita ir a trompicones con el servidor. */
  let optimistic = $state<number | null>(null);
  const ratio = $derived(optimistic ?? serverRatio);
  const pathKey = $derived(node.path.map((branch) => (branch ? '1' : '0')).join('.') || 'root');

  let dragging = $state(false);
  let startRatio = 0;
  let startPointer = 0;
  /** Tamaño en px del contenedor en el eje del split (0 = sin geometría). */
  let extent = 0;

  function onDividerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const divider = event.currentTarget as HTMLElement;
    const container = divider.parentElement;
    if (!container) return;
    // Divisores anidados: el del árbol más profundo es el que se arrastra; el
    // evento no sube al split padre.
    event.stopPropagation();
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    extent = node.direction === 'right' ? rect.width : rect.height;
    if (extent <= 0) return; // sin geometría (tests en jsdom) no se arrastra
    startRatio = ratio;
    startPointer = node.direction === 'right' ? event.clientX : event.clientY;
    dragging = true;
    optimistic = startRatio;
    if (typeof divider.setPointerCapture === 'function') {
      try {
        divider.setPointerCapture(event.pointerId);
      } catch {
        // El puntero ya no está: sin captura el arrastre sigue por el elemento.
      }
    }
    document.body.style.cursor = node.direction === 'right' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }

  function onDividerMove(event: PointerEvent): void {
    if (!dragging || extent <= 0) return;
    const current = node.direction === 'right' ? event.clientX : event.clientY;
    optimistic = clamp(startRatio + (current - startPointer) / extent);
  }

  function endDrag(divider: HTMLElement | null, pointerId?: number): void {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (divider && pointerId !== undefined && typeof divider.releasePointerCapture === 'function') {
      try {
        if (divider.hasPointerCapture(pointerId)) divider.releasePointerCapture(pointerId);
      } catch {
        // Sin captura: nada que soltar.
      }
    }
  }

  function onDividerUp(event: PointerEvent): void {
    if (!dragging) return;
    endDrag(event.currentTarget as HTMLElement, event.pointerId);
    const value = optimistic;
    if (value === null) return;
    const tabId = layout.tabId;
    if (!tabId) {
      optimistic = null;
      return;
    }
    // UN solo commit al servidor, al soltar. El optimista se queda hasta que
    // llegue el árbol nuevo (si se soltara ya, el panel daría un salto atrás).
    void layoutApi
      .setSplitRatio(tabId, node.path, Number(clamp(value).toFixed(4)))
      .catch((raw: unknown) => {
        optimistic = null;
        ui.notify(parseApiError(raw).message, 'warn');
      });
  }

  // El árbol del servidor ya trae otro ratio: el optimista del arrastre sobra.
  $effect(() => {
    if (optimistic !== null && Math.abs(serverRatio - startRatio) > 0.0005) optimistic = null;
  });
</script>

{#if node.kind === 'pane' && node.paneId}
  <!-- `{#key}` por pane_id: si en esta posición del árbol el panel cambia (se
       cierra uno y su hueco lo ocupa otro panel), Svelte no puede reutilizar el
       componente —se quedaría con la instancia de xterm y el bridge del panel
       que ya no está, y el marco sobrevivía con un overlay de «desconectado»—.
       Con la clave, el panel que se fue se desmonta entero (el pool suelta su
       terminal y su bridge) y el que llega monta su propia instancia. -->
  {#key node.paneId}
    <PaneFrame paneId={node.paneId} />
  {/key}
{:else if node.first && node.second}
  <div
    class="split"
    data-direction={node.direction}
    data-path={pathKey}
    data-testid="split"
    data-gaps={settings.values.pane_gaps}
    data-dragging={dragging}
  >
    <div class="split__side" style="--ratio:{ratio}">
      <SplitTree node={node.first} />
    </div>
    <div
      class="split__divider"
      data-testid="split-divider"
      data-direction={node.direction}
      data-path={pathKey}
      data-dragging={dragging}
      role="separator"
      aria-orientation={node.direction === 'right' ? 'vertical' : 'horizontal'}
      aria-valuemin={Math.round(MIN_RATIO * 100)}
      aria-valuemax={Math.round(MAX_RATIO * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      onpointerdown={onDividerDown}
      onpointermove={onDividerMove}
      onpointerup={onDividerUp}
      onpointercancel={onDividerUp}
    ></div>
    <div class="split__side" style="--ratio:{1 - ratio}">
      <SplitTree node={node.second} />
    </div>
  </div>
{/if}

<style>
  .split {
    display: flex;
    block-size: 100%;
    inline-size: 100%;
    min-block-size: 0;
    min-inline-size: 0;
  }

  .split[data-direction='down'] {
    flex-direction: column;
  }

  .split__side {
    flex: var(--ratio) 1 0;
    min-block-size: 0;
    min-inline-size: 0;
    display: flex;
  }

  .split__divider {
    position: relative;
    flex: 0 0 auto;
    background: var(--glass-border);
  }

  /* Zona de agarre más ancha que la línea (sigue siendo el mismo elemento: el
     pointerdown lo recibe el divisor). */
  .split__divider::after {
    content: '';
    position: absolute;
    inset: -3px;
  }

  .split[data-direction='right'] > .split__divider {
    inline-size: 2px;
    cursor: col-resize;
  }

  .split[data-direction='down'] > .split__divider {
    block-size: 2px;
    cursor: row-resize;
  }

  .split[data-gaps='true'] {
    gap: 2px;
  }

  .split[data-gaps='true'] > .split__divider {
    background: transparent;
  }

  .split[data-dragging='true'] > .split__divider,
  .split__divider[data-dragging='true'] {
    background: var(--accent);
  }
</style>
