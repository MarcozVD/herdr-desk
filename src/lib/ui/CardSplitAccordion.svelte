<!-- CardSplitAccordion: acordeón de tarjetas «split» (porte del CardSplitAccordian
     de watermelon.sh a Svelte 5, sin dependencias nuevas).
     - data-driven: items { id, title, icon | iconKey, content }
     - un solo item abierto a la vez; el clic en el abierto lo cierra
     - cada fila (CardSplitAccordionItem) anima la altura de su panel con un Spring
       (preset `card` de motion.ts) y el objetivo es la altura medida del contenido
     - respeta prefers-reduced-motion: el panel salta abierto, sin animación
     - accesible: botón real, aria-expanded/aria-controls, flechas/Home/End, foco visible -->
<script module lang="ts">
  export {
    CARD_RADIUS,
    DEFAULT_ICON_KEYS,
    DEFAULT_ITEMS,
    itemChrome,
    OPEN_MARGIN,
  } from './cardSplit';
  export type { AccordionIconKey, AccordionItem, AccordionItemId, ItemChrome } from './cardSplit';
</script>

<script lang="ts">
  import CardSplitAccordionItem from './CardSplitAccordionItem.svelte';
  import { DEFAULT_ITEMS, itemChrome, type AccordionItem, type AccordionItemId } from './cardSplit';
  import { es } from '../i18n/es';

  interface Props {
    items?: AccordionItem[];
    /** Id del item abierto (bindable). `null` = todos cerrados. */
    openId?: AccordionItemId | null;
    onOpenChange?: (id: AccordionItemId | null) => void;
    /** Ancho máximo del bloque (el original: `w-xs md:w-sm`). */
    maxWidth?: string;
    class?: string;
    testId?: string;
  }

  let {
    items = DEFAULT_ITEMS,
    openId = $bindable<AccordionItemId | null>(null),
    onOpenChange,
    maxWidth = '26rem',
    class: className = '',
    testId = 'card-split-accordion',
  }: Props = $props();

  let list = $state<HTMLUListElement | null>(null);

  const openIndex = $derived(items.findIndex((item) => item.id === openId));

  function toggle(id: AccordionItemId): void {
    const next = openId === id ? null : id;
    openId = next;
    onOpenChange?.(next);
  }

  function onTriggerKeydown(event: KeyboardEvent, index: number): void {
    const handled = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!handled.includes(event.key)) return;
    event.preventDefault();
    const triggers = list?.querySelectorAll<HTMLButtonElement>('[data-testid="csa-trigger"]');
    if (!triggers || triggers.length === 0) return;
    const last = triggers.length - 1;
    let next = index;
    if (event.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    if (event.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = last;
    triggers[next]?.focus();
  }
</script>

<div
  class="csa {className}"
  style="--csa-max-width: {maxWidth}"
  data-testid={testId}
  aria-label={es.cardSplit.label}
  role="group"
>
  <ul class="csa__list" bind:this={list}>
    {#each items as item, index (item.id)}
      <CardSplitAccordionItem
        {item}
        open={item.id === openId}
        chrome={itemChrome(index, items.length, openIndex)}
        {testId}
        onToggle={() => toggle(item.id)}
        onkeydown={(event) => onTriggerKeydown(event, index)}
      />
    {/each}
  </ul>
</div>

<style>
  .csa {
    display: flex;
    justify-content: center;
    inline-size: 100%;
    padding: var(--space-6) var(--space-4);
  }

  .csa__list {
    inline-size: min(100%, var(--csa-max-width));
    margin: 0;
    padding: 0;
    list-style: none;
  }
</style>
