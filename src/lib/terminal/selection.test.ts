// T4k — Tests de la traducción viewport ↔ absoluto y del recorte a lo visible.

import { describe, expect, it } from 'vitest';

import { absolutePoint, topAbsoluteRow, visibleSelection } from './selection';

const scroll = { offset_from_bottom: 0, max_offset_from_bottom: 10, viewport_rows: 5 };

describe('T4k — selección con autoscroll', () => {
  it('la fila visible de arriba es max_offset - offset', () => {
    expect(topAbsoluteRow(scroll)).toBe(10);
    expect(topAbsoluteRow({ ...scroll, offset_from_bottom: 4 })).toBe(6);
    expect(topAbsoluteRow({ ...scroll, offset_from_bottom: 10 })).toBe(0);
  });

  it('traduce una celda del viewport a punto absoluto', () => {
    expect(absolutePoint(scroll, 0, 0)).toEqual({ row: 10, col: 0 });
    expect(absolutePoint(scroll, 2, 7)).toEqual({ row: 12, col: 7 });
    expect(absolutePoint({ ...scroll, offset_from_bottom: 4 }, 1, 3)).toEqual({
      row: 7,
      col: 3,
    });
  });

  it('selecciona el rango visible completo', () => {
    expect(visibleSelection({ row: 10, col: 2 }, { row: 12, col: 4 }, scroll, 10)).toEqual({
      column: 2,
      row: 0,
      length: 23,
    });
  });

  it('invierte la selección si se arrastra hacia arriba', () => {
    expect(visibleSelection({ row: 12, col: 4 }, { row: 10, col: 2 }, scroll, 10)).toEqual({
      column: 2,
      row: 0,
      length: 23,
    });
  });

  it('recorta arriba y abajo cuando el cursor sale del viewport', () => {
    expect(visibleSelection({ row: 2, col: 1 }, { row: 40, col: 9 }, scroll, 10)).toEqual({
      column: 0,
      row: 0,
      length: 50,
    });
    expect(visibleSelection({ row: 12, col: 4 }, { row: 20, col: 0 }, scroll, 10)).toEqual({
      column: 4,
      row: 2,
      length: 26,
    });
  });

  it('devuelve null si la selección no toca el viewport', () => {
    expect(visibleSelection({ row: 0, col: 0 }, { row: 3, col: 2 }, scroll, 10)).toBeNull();
    expect(visibleSelection({ row: 20, col: 0 }, { row: 22, col: 2 }, scroll, 10)).toBeNull();
  });
});
