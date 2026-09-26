// Piezas puras del acordeón de tarjetas: tipos, geometría «split» y items por
// defecto. Viven aparte para que el componente de la fila y el de la lista las
// compartan sin importarse entre sí.

import type { Snippet } from 'svelte';

import { es } from '../i18n/es';

export type AccordionItemId = string | number;

/** Iconos integrados (lucide + el SVG inline del cursor). */
export type AccordionIconKey = 'cursor' | 'layers' | 'hand' | 'send' | 'timer';

export interface AccordionItem {
  id: AccordionItemId;
  title: string;
  content: string;
  /** Icono propio como snippet; si falta se usa `iconKey`. */
  icon?: Snippet;
  iconKey?: AccordionIconKey;
}

export interface ItemChrome {
  borderTop: 0 | 1;
  borderBottom: 0 | 1;
  radius: { tl: number; tr: number; br: number; bl: number };
  marginBlock: number;
}

export const CARD_RADIUS = 20;
export const OPEN_MARGIN = 10;

/**
 * Geometría «split» del original: los bordes horizontales se reparten entre
 * vecinos (así la lista se ve como un bloque continuo) y la tarjeta abierta —o
 * la que queda sola— se redondea entera y se separa con margen.
 */
export function itemChrome(index: number, total: number, openIndex: number): ItemChrome {
  const isOpen = index === openIndex;
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const isBeforeOpen = index === openIndex - 1;
  const isAfterOpen = index === openIndex + 1;
  const isAlone = (isAfterOpen && isLast) || (isBeforeOpen && isFirst);

  const radius = { tl: 0, tr: 0, br: 0, bl: 0 };
  if (isOpen || isAlone) {
    radius.tl = CARD_RADIUS;
    radius.tr = CARD_RADIUS;
    radius.br = CARD_RADIUS;
    radius.bl = CARD_RADIUS;
  } else if (isBeforeOpen) {
    radius.bl = CARD_RADIUS;
    radius.br = CARD_RADIUS;
  } else if (isAfterOpen) {
    radius.tl = CARD_RADIUS;
    radius.tr = CARD_RADIUS;
  } else if (isFirst) {
    radius.tl = CARD_RADIUS;
    radius.tr = CARD_RADIUS;
  } else if (isLast) {
    radius.bl = CARD_RADIUS;
    radius.br = CARD_RADIUS;
  }

  return {
    borderTop: isFirst || isAfterOpen || isOpen ? 1 : 0,
    borderBottom: isLast || isBeforeOpen || isOpen ? 1 : 0,
    radius,
    marginBlock: isOpen ? OPEN_MARGIN : 0,
  };
}

export const DEFAULT_ICON_KEYS: AccordionIconKey[] = ['cursor', 'layers', 'hand', 'send', 'timer'];

/** Items por defecto: los mismos temas del componente original, en español. */
export const DEFAULT_ITEMS: AccordionItem[] = es.cardSplit.items.map((item, index) => ({
  id: index + 1,
  title: item.title,
  content: item.content,
  iconKey: DEFAULT_ICON_KEYS[index] ?? 'layers',
}));
