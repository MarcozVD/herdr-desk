// T1.7 — Árbol de paneles de un tab a partir de `layout.export`.
//
// El API devuelve `LayoutNode` = hoja `{type:'pane', pane_id, …}` o
// `{type:'split', direction:'right'|'down', ratio, first, second}`. Aquí se pasa a
// un árbol con geometría normalizada (0..1 del área), la ruta de decisiones de cada
// divisor (para `layout.set_split_ratio {path}`) y las utilidades que usa la UI.

import type { LayoutNode } from '../herdr/actions';
import type { SplitDirection } from '../herdr/actions';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TreeNode {
  /** `pane:<pane_id>` en hojas, `split:<path>` en ramas. */
  id: string;
  kind: 'pane' | 'split';
  rect: Rect;
  /** Ruta de decisiones desde la raíz (false = first, true = second). */
  path: boolean[];
  direction?: SplitDirection;
  ratio?: number;
  paneId?: string;
  command?: string[] | null;
  cwd?: string | null;
  label?: string | null;
  first?: TreeNode;
  second?: TreeNode;
}

export interface Divider {
  /** Ruta del split que representa este divisor. */
  path: boolean[];
  direction: SplitDirection;
  ratio: number;
  /** Línea del divisor en coordenadas normalizadas: x1,y1 → x2,y2. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const FULL_RECT: Rect = { x: 0, y: 0, w: 1, h: 1 };

function pathId(path: boolean[]): string {
  return `split:${path.map((branch) => (branch ? '1' : '0')).join('') || 'root'}`;
}

/** Divide un rect en dos según dirección y ratio (el primero se queda el ratio). */
export function splitRect(rect: Rect, direction: SplitDirection, ratio: number): [Rect, Rect] {
  const clamped = Math.min(0.95, Math.max(0.05, ratio));
  if (direction === 'right') {
    const firstWidth = rect.w * clamped;
    return [
      { x: rect.x, y: rect.y, w: firstWidth, h: rect.h },
      { x: rect.x + firstWidth, y: rect.y, w: rect.w - firstWidth, h: rect.h },
    ];
  }
  const firstHeight = rect.h * clamped;
  return [
    { x: rect.x, y: rect.y, w: rect.w, h: firstHeight },
    { x: rect.x, y: rect.y + firstHeight, w: rect.w, h: rect.h - firstHeight },
  ];
}

export function buildTree(
  node: LayoutNode | null | undefined,
  rect: Rect = FULL_RECT,
  path: boolean[] = [],
): TreeNode | null {
  if (!node) return null;
  if (node.type === 'pane') {
    return {
      id: `pane:${node.pane_id ?? ''}`,
      kind: 'pane',
      rect,
      path,
      paneId: node.pane_id ?? undefined,
      command: node.command ?? null,
      cwd: node.cwd ?? null,
      label: node.label ?? null,
    };
  }
  const [firstRect, secondRect] = splitRect(rect, node.direction, node.ratio);
  const first = buildTree(node.first, firstRect, [...path, false]);
  const second = buildTree(node.second, secondRect, [...path, true]);
  if (!first || !second) return first ?? second;
  return {
    id: pathId(path),
    kind: 'split',
    rect,
    path,
    direction: node.direction,
    ratio: node.ratio,
    first,
    second,
  };
}

/** Hojas en orden de lectura (izquierda→derecha, arriba→abajo). */
export function paneNodes(root: TreeNode | null): TreeNode[] {
  if (!root) return [];
  if (root.kind === 'pane') return [root];
  return [...paneNodes(root.first ?? null), ...paneNodes(root.second ?? null)];
}

export function findPane(root: TreeNode | null, paneId: string): TreeNode | null {
  return paneNodes(root).find((node) => node.paneId === paneId) ?? null;
}

/** Divisores del árbol, con su geometría en coordenadas normalizadas. */
export function dividersOf(root: TreeNode | null): Divider[] {
  if (!root || root.kind === 'pane') return [];
  const direction = root.direction ?? 'right';
  const ratio = root.ratio ?? 0.5;
  const first = root.first?.rect;
  const second = root.second?.rect;
  const own: Divider[] = [];
  // La raíz lleva path [] y también tiene divisor: `layout.set_split_ratio` lo
  // direcciona con la ruta vacía.
  if (first && second) {
    own.push(
      direction === 'right'
        ? {
            path: root.path,
            direction,
            ratio,
            x1: first.x + first.w,
            y1: first.y,
            x2: first.x + first.w,
            y2: first.y + first.h,
          }
        : {
            path: root.path,
            direction,
            ratio,
            x1: first.x,
            y1: first.y + first.h,
            x2: first.x + first.w,
            y2: first.y + first.h,
          },
    );
  }
  return [...own, ...dividersOf(root.first ?? null), ...dividersOf(root.second ?? null)];
}

/** Con `zoomed`, el tab muestra solo el panel enfocado. */
export function zoomedTree(root: TreeNode | null, focusedPaneId: string | null): TreeNode | null {
  if (!root) return null;
  if (!focusedPaneId) return root;
  const pane = findPane(root, focusedPaneId);
  return pane ? { ...pane, rect: root.rect, path: [] } : root;
}

/** Ruta de `layout.set_split_ratio` para el divisor más cercano a un punto. */
export function dividerAt(
  root: TreeNode | null,
  x: number,
  y: number,
  tolerance = 0.02,
): Divider | null {
  const dividers = dividersOf(root);
  let best: Divider | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const divider of dividers) {
    const distance =
      divider.direction === 'right' ? Math.abs(divider.x1 - x) : Math.abs(divider.y1 - y);
    const withinSpan =
      divider.direction === 'right'
        ? y >= divider.y1 - tolerance && y <= divider.y2 + tolerance
        : x >= divider.x1 - tolerance && x <= divider.x2 + tolerance;
    if (withinSpan && distance <= tolerance && distance < bestDistance) {
      best = divider;
      bestDistance = distance;
    }
  }
  return best;
}

/** ¿El árbol tiene algún panel? */
export function hasPanes(root: TreeNode | null): boolean {
  return paneNodes(root).length > 0;
}

/**
 * Panel vecino en una dirección, calculado en local (R11: sin tocar el estado
 * compartido). Se queda con el candidato más cercano y, a igualdad, con el que
 * más solape tiene en el eje perpendicular.
 */
export function neighborPane(
  root: TreeNode | null,
  paneId: string,
  direction: 'left' | 'right' | 'up' | 'down',
): TreeNode | null {
  const source = findPane(root, paneId);
  if (!source) return null;
  const epsilon = 1e-6;

  let best: TreeNode | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of paneNodes(root)) {
    if (candidate.paneId === paneId) continue;
    const rect = candidate.rect;
    const sourceRect = source.rect;

    // Regla de mosaico: el candidato tiene que estar de ese lado y solapar en el
    // eje perpendicular; si no, un panel que ocupa toda la altura tendría vecino
    // "arriba" solo por estar su centro más arriba.
    const horizontal = direction === 'left' || direction === 'right';
    const [startSrc, endSrc] = horizontal
      ? [sourceRect.y, sourceRect.y + sourceRect.h]
      : [sourceRect.x, sourceRect.x + sourceRect.w];
    const [startCand, endCand] = horizontal ? [rect.y, rect.y + rect.h] : [rect.x, rect.x + rect.w];
    const overlap = Math.max(0, Math.min(endSrc, endCand) - Math.max(startSrc, startCand));
    if (overlap <= 0) continue;

    const gap = horizontal
      ? direction === 'left'
        ? sourceRect.x - (rect.x + rect.w)
        : rect.x - (sourceRect.x + sourceRect.w)
      : direction === 'up'
        ? sourceRect.y - (rect.y + rect.h)
        : rect.y - (sourceRect.y + sourceRect.h);
    if (gap < -epsilon) continue;

    // El candidato más cercano gana; con empate (mosaico adyacente) gana el
    // primero en orden de árbol, que es lo que hace la TUI.
    const score = Math.max(0, gap);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
