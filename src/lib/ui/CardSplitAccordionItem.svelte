<!-- Fila del acordeón de tarjetas: botón (cabecera) + panel desplegable.
     El Spring se crea en la inicialización de la fila (una vez, identidad
     estable) y su objetivo es la altura medida del contenido; así la fila no
     depende de estado compartido y el bucle de animación no se reinicia. -->
<script lang="ts">
  import { ChevronDown, Hand, Layers, Send, Timer } from '@lucide/svelte';
  import { Spring } from 'svelte/motion';
  import { untrack } from 'svelte';

  import type { AccordionItem, ItemChrome } from './cardSplit';
  import { prefersReducedMotionNow, setSpringTarget, springOptions, SPRINGS } from './motion';

  interface Props {
    item: AccordionItem;
    open: boolean;
    chrome: ItemChrome;
    testId: string;
    onToggle: () => void;
    /** Manejador de teclado de la cabecera (flechas/Home/End los resuelve la lista). */
    onkeydown: (event: KeyboardEvent) => void;
  }

  let { item, open, chrome, testId, onToggle, onkeydown }: Props = $props();

  /** Altura medida del contenido (la escribe `bind:clientHeight`). */
  let contentHeight = $state(0);
  /** Un spring por fila, creado una sola vez. */
  const spring = new Spring(0, springOptions(SPRINGS.card));

  // Trampas de Svelte 5 + Spring, cubiertas por los tests:
  //  1) `contentHeight` se lee DENTRO del efecto: leer el objeto/la variable en
  //     otro sitio no registra la dependencia que despierta la medición.
  //  2) `spring.set()` lee internamente `spring.current`, así que sin `untrack`
  //     el efecto se reejecutaría en cada tick, reiniciando el spring: el valor
  //     oscila y nunca se asienta.
  //  3) la preferencia de movimiento se consulta al animar
  //     (`prefersReducedMotionNow`) y no desde un store reactivo: el salto es
  //     determinista y el CSS se encarga del resto (ver el @media).
  $effect(() => {
    const isOpen = open;
    const height = contentHeight;
    untrack(() => setSpringTarget(spring, isOpen ? height : 0, prefersReducedMotionNow()));
  });

  const triggerId = $derived(`${testId}-trigger-${String(item.id)}`);
  const panelId = $derived(`${testId}-panel-${String(item.id)}`);
</script>

<li class="csa__row">
  <div
    class="csa__card"
    data-open={open}
    style="border-top-width: {chrome.borderTop}px;
           border-bottom-width: {chrome.borderBottom}px;
           margin-block: {chrome.marginBlock}px;
           border-radius: {chrome.radius.tl}px {chrome.radius.tr}px {chrome.radius.br}px {chrome
      .radius.bl}px;"
  >
    <button
      type="button"
      class="csa__trigger"
      id={triggerId}
      aria-expanded={open}
      aria-controls={panelId}
      data-testid="csa-trigger"
      data-open={open}
      onclick={onToggle}
      {onkeydown}
    >
      <span class="csa__icon" aria-hidden="true">
        {#if item.icon}
          {@render item.icon()}
        {:else if item.iconKey === 'cursor'}
          <!-- SVG inline (el original usaba un icono de react-icons). -->
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            data-testid="csa-icon-inline"
          >
            <path d="M7 4.5v9.6l2.5-2.2 1.8 3.9 1.9-.9-1.8-3.8 3.2-.5z" fill="currentColor" />
            <path d="M3.6 3.6 6.4 6.4M2.2 8.4h2.6M8.4 2.2v2.6M12.6 8.6l1.9-1.9M8.6 12.6l-1.9 1.9" />
          </svg>
        {:else if item.iconKey === 'layers'}
          <Layers size={22} />
        {:else if item.iconKey === 'hand'}
          <Hand size={22} />
        {:else if item.iconKey === 'send'}
          <Send size={22} />
        {:else if item.iconKey === 'timer'}
          <Timer size={22} />
        {/if}
      </span>

      <span class="csa__title">{item.title}</span>

      <span class="csa__chevron" aria-hidden="true">
        <ChevronDown size={20} />
      </span>
    </button>

    <div
      class="csa__panel"
      id={panelId}
      role="region"
      aria-labelledby={triggerId}
      aria-hidden={!open}
      data-testid="csa-panel"
      data-open={open}
      style="height: {spring.current}px"
    >
      <div class="csa__content" data-testid="csa-content" bind:clientHeight={contentHeight}>
        {item.content}
      </div>
    </div>
  </div>
</li>

<style>
  .csa__card {
    overflow: hidden;
    border: 1px solid var(--glass-border);
    border-inline-width: 1px;
    background: color-mix(in oklab, var(--panel-bg-solid) 86%, transparent);
    /* Las esquinas y el margen los manda `itemChrome` por estilo inline. */
    transition:
      border-radius var(--t-med) var(--ease),
      margin-block var(--t-med) var(--ease),
      background var(--t-med) var(--ease),
      border-color var(--t-fast) var(--ease);
    will-change: height;
  }

  .csa__card[data-open='true'] {
    background: color-mix(in oklab, var(--panel-bg-solid) 96%, transparent);
    border-color: color-mix(in oklab, var(--accent) 40%, var(--glass-border));
    box-shadow: var(--shadow-lg);
  }

  .csa__trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    inline-size: 100%;
    padding: 10px 12px;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    text-align: start;
    cursor: pointer;
  }

  .csa__trigger:hover {
    background: color-mix(in oklab, var(--surface-dim) 16%, transparent);
  }

  .csa__trigger:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .csa__icon {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    color: var(--accent);
  }

  .csa__title {
    flex: 1 1 auto;
    min-inline-size: 0;
  }

  .csa__chevron {
    display: inline-flex;
    flex: 0 0 auto;
    color: var(--text-dim);
    transition: transform var(--t-med) var(--ease);
  }

  .csa__trigger[data-open='true'] .csa__chevron {
    transform: rotate(180deg);
  }

  .csa__panel {
    overflow: hidden;
    opacity: 0;
    transition: opacity var(--t-med) var(--ease);
  }

  .csa__panel[data-open='true'] {
    opacity: 1;
  }

  .csa__content {
    padding: 0 20px 20px;
    color: var(--text-dim);
    font-size: 13px;
    line-height: 1.5;
  }

  /* Sin animación si el sistema lo pide (el spring salta de golpe). */
  @media (prefers-reduced-motion: reduce) {
    .csa__card,
    .csa__chevron,
    .csa__panel {
      transition: none;
    }
  }
</style>
