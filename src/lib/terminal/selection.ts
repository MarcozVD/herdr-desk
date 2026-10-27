// T4k — Geometría de la selección con autoscroll.
//
// xterm no tiene scrollback local (`scrollback: 0`): al arrastrar fuera del
// borde hay que pedir al server que mueva su viewport y leer la selección con
// `pane.selection.read`, que trabaja con puntos ABSOLUTOS del buffer. Estas
// funciones puras traducen viewport → absoluto y recortan la selección a lo que
// se ve para poder pintarla en xterm.

export interface ScrollInfo {
  offset_from_bottom: number;
  max_offset_from_bottom: number;
  viewport_rows: number;
}

export interface TextPoint {
  row: number;
  col: number;
}

/** Fila absoluta (0 = primera del scrollback) de la primera fila visible. */
export function topAbsoluteRow(scroll: ScrollInfo): number {
  return Math.max(0, scroll.max_offset_from_bottom - scroll.offset_from_bottom);
}

/** Punto absoluto a partir de una celda 0-based del viewport. */
export function absolutePoint(scroll: ScrollInfo, viewportRow: number, col: number): TextPoint {
  return {
    row: topAbsoluteRow(scroll) + Math.max(0, viewportRow),
    col: Math.max(0, col),
  };
}

function order(a: TextPoint, b: TextPoint): [TextPoint, TextPoint] {
  if (a.row !== b.row) return a.row < b.row ? [a, b] : [b, a];
  return a.col <= b.col ? [a, b] : [b, a];
}

/**
 * Rango que xterm puede pintar: intersección de la selección absoluta con el
 * viewport actual. `null` si la selección quedó entera fuera de la vista.
 * Devuelve los argumentos de `terminal.select(column, row, length)` (0-based).
 */
export function visibleSelection(
  anchor: TextPoint,
  cursor: TextPoint,
  scroll: ScrollInfo,
  cols: number,
): { column: number; row: number; length: number } | null {
  if (cols <= 0 || scroll.viewport_rows <= 0) return null;
  const [start, end] = order(anchor, cursor);
  const top = topAbsoluteRow(scroll);
  const bottom = top + scroll.viewport_rows - 1;
  if (end.row < top || start.row > bottom) return null;

  const firstRow = Math.max(start.row, top);
  const lastRow = Math.min(end.row, bottom);
  const firstCol = start.row < top ? 0 : Math.min(start.col, cols - 1);
  const lastCol = end.row > bottom ? cols - 1 : Math.min(end.col, cols - 1);
  const length = (lastRow - firstRow) * cols + (lastCol - firstCol) + 1;
  return { column: firstCol, row: firstRow - top, length: Math.max(1, length) };
}
