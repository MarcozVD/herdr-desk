import { describe, expect, it } from 'vitest';

import { defaultAssign, reconcileById } from './reconcile';

interface Row {
  id: string;
  label: string;
  count?: number;
  tokens?: Record<string, string>;
}

const key = (row: Row) => row.id;

function rows(...items: Row[]): Row[] {
  return items;
}

describe('reconcileById', () => {
  it('1. alta: crea solo el objeto nuevo y conserva la identidad del resto', () => {
    const first: Row = { id: 'a', label: 'uno' };
    const second: Row = { id: 'b', label: 'dos' };
    const { items, stats } = reconcileById({
      current: rows(first, second),
      next: rows(first, second, { id: 'c', label: 'tres' }),
      key,
    });
    expect(items.map(key)).toEqual(['a', 'b', 'c']);
    expect(items[0]).toBe(first);
    expect(items[1]).toBe(second);
    expect(stats).toMatchObject({ added: 1, removed: 0, changed: 0, unchanged: 2, dirty: true });
  });

  it('2. baja: quita el objeto y deja intactos los que siguen', () => {
    const first: Row = { id: 'a', label: 'uno' };
    const second: Row = { id: 'b', label: 'dos' };
    const { items, stats } = reconcileById({
      current: rows(first, second),
      next: rows(second),
      key,
    });
    expect(items).toEqual([second]);
    expect(items[0]).toBe(second);
    expect(stats).toMatchObject({ added: 0, removed: 1, changed: 0, unchanged: 1, dirty: true });
  });

  it('3. reorden: mismo contenido, distinto orden, identidad preservada', () => {
    const first: Row = { id: 'a', label: 'uno' };
    const second: Row = { id: 'b', label: 'dos' };
    const third: Row = { id: 'c', label: 'tres' };
    const { items, stats } = reconcileById({
      current: rows(first, second, third),
      next: rows(third, first, second),
      key,
    });
    expect(items).toEqual([third, first, second]);
    expect(items[0]).toBe(third);
    expect(stats.reordered).toBe(true);
    expect(stats.changed).toBe(0);
    expect(stats.dirty).toBe(true);
  });

  it('4. cambio de campo: muta en sitio el objeto existente', () => {
    const first: Row = { id: 'a', label: 'uno', count: 1 };
    const { items, stats } = reconcileById({
      current: rows(first),
      next: rows({ id: 'a', label: 'uno', count: 2 }),
      key,
    });
    expect(items[0]).toBe(first);
    expect(first.count).toBe(2);
    expect(stats).toMatchObject({ added: 0, removed: 0, changed: 1, unchanged: 0, dirty: true });
  });

  it('5. sin cambios: no toca nada ni marca dirty', () => {
    const first: Row = { id: 'a', label: 'uno', tokens: { branch: 'main' } };
    const { items, stats } = reconcileById({
      current: rows(first),
      next: rows({ id: 'a', label: 'uno', tokens: { branch: 'main' } }),
      key,
    });
    expect(items[0]).toBe(first);
    expect(stats).toMatchObject({ changed: 0, unchanged: 1, added: 0, removed: 0, dirty: false });
  });

  it('6. cambio en un objeto anidado cuenta como cambio y muta en sitio', () => {
    const first: Row = { id: 'a', label: 'uno', tokens: { branch: 'main', git_status: 'clean' } };
    const { items, stats } = reconcileById({
      current: rows(first),
      next: rows({ id: 'a', label: 'uno', tokens: { branch: 'feat', git_status: 'clean' } }),
      key,
    });
    expect(items[0]).toBe(first);
    expect(first.tokens).toEqual({ branch: 'feat', git_status: 'clean' });
    expect(stats.changed).toBe(1);
  });

  it('7. todos nuevos: no conserva nada del array anterior', () => {
    const { items, stats } = reconcileById({
      current: rows({ id: 'a', label: 'uno' }),
      next: rows({ id: 'x', label: 'equis' }, { id: 'y', label: 'ye' }),
      key,
    });
    expect(items.map(key)).toEqual(['x', 'y']);
    expect(stats).toMatchObject({ added: 2, removed: 1, unchanged: 0, changed: 0 });
  });

  it('8. lista vacía: quita todo', () => {
    const { items, stats } = reconcileById({
      current: rows({ id: 'a', label: 'uno' }, { id: 'b', label: 'dos' }),
      next: rows(),
      key,
    });
    expect(items).toEqual([]);
    expect(stats).toMatchObject({ added: 0, removed: 2, dirty: true });
  });

  it('9. claves repetidas en la entrada: gana la última y no se duplica', () => {
    const { items, stats } = reconcileById({
      current: rows(),
      next: rows({ id: 'a', label: 'uno' }, { id: 'a', label: 'uno bis' }),
      key,
    });
    expect(items.map(key)).toEqual(['a']);
    expect(items[0]?.label).toBe('uno bis');
    expect(stats.added).toBe(1);
  });

  it('10. claves repetidas en el estado actual: no se duplican al reconciliar', () => {
    const first: Row = { id: 'a', label: 'uno' };
    const { items } = reconcileById({
      current: rows(first, { id: 'a', label: 'uno bis' }),
      next: rows({ id: 'a', label: 'uno' }),
      key,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toBe(first);
  });

  it('11. un campo que desaparece se borra del objeto existente', () => {
    const first: Row = { id: 'a', label: 'uno', count: 7 };
    reconcileById({ current: rows(first), next: rows({ id: 'a', label: 'uno' }), key });
    expect('count' in first).toBe(false);
  });

  it('12. el array devuelto es nuevo aunque no haya cambios (para $state)', () => {
    const current = rows({ id: 'a', label: 'uno' });
    const { items } = reconcileById({ current, next: rows({ id: 'a', label: 'uno' }), key });
    expect(items).not.toBe(current);
    expect(items[0]).toBe(current[0]);
  });
});

describe('defaultAssign', () => {
  it('copia solo los campos que cambian y borra los que sobran', () => {
    const target: Row = { id: 'a', label: 'uno', count: 1 };
    const source: Row = { id: 'a', label: 'dos' };
    defaultAssign(target, source);
    expect(target).toEqual({ id: 'a', label: 'dos' });
  });
});
