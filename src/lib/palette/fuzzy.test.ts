// T2.6 — Búsqueda de la paleta: normalización, puntuación y uso reciente.

import { describe, expect, it } from 'vitest';

import { fuzzyScore, normalizeQuery, pushRecent, rankByScore, recencyIndex } from './fuzzy';

describe('normalización', () => {
  it('quita acentos, mayúsculas y espacios de más', () => {
    expect(normalizeQuery('  Pestaña  ')).toBe('pestana');
    expect(normalizeQuery('Añadir ÁRBOL')).toBe('anadir arbol');
    expect(normalizeQuery('')).toBe('');
    expect(normalizeQuery('   ')).toBe('');
  });
});

describe('puntuación fuzzy', () => {
  it('sin consulta todo puntúa 0 (la lista la ordena el uso reciente)', () => {
    expect(fuzzyScore('', 'Nuevo espacio')).toBe(0);
    expect(fuzzyScore('   ', 'Nuevo espacio')).toBe(0);
  });

  it('la subcadena gana a la subsecuencia', () => {
    const substring = fuzzyScore('espacio', 'Nuevo espacio');
    const subsequence = fuzzyScore('espacio', 'Enviar salida pacífica a otro');
    expect(substring).not.toBeNull();
    expect(subsequence).not.toBeNull();
    expect(substring as number).toBeGreaterThan(subsequence as number);
  });

  it('ignora acentos y mayúsculas en los dos lados', () => {
    expect(fuzzyScore('pestana', 'Pestaña siguiente')).not.toBeNull();
    expect(fuzzyScore('PESTAÑA', 'pestana')).not.toBeNull();
  });

  it('devuelve null si no coincide, y el orden de los caracteres importa', () => {
    expect(fuzzyScore('zzz', 'Nuevo espacio')).toBeNull();
    expect(fuzzyScore('ez', 'Nuevo espacio')).toBeNull(); // no hay «z» después de la «e»
    // Subsecuencia con el espacio en medio (búsqueda por iniciales).
    expect(fuzzyScore('ne es', 'Nuevo espacio')).not.toBeNull();
  });

  it('premia empezar en un límite de palabra', () => {
    const atWordStart = fuzzyScore('esp', 'Nuevo espacio');
    const inMiddle = fuzzyScore('spa', 'Nuevo espacio');
    expect(atWordStart as number).toBeGreaterThan(inMiddle as number);
  });
});

describe('orden por puntuación y uso reciente', () => {
  const items = [
    { id: 'a', text: 'Cerrar pestaña' },
    { id: 'b', text: 'Cerrar panel' },
    { id: 'c', text: 'Cerrar espacio' },
  ];

  it('la puntuación manda (la etiqueta más corta gana) y el reciente desempata', () => {
    const ranked = rankByScore(
      items,
      (item) => fuzzyScore('cerrar', item.text),
      (item) => recencyIndex(['c', 'b'], item.id),
    );
    // Las tres empiezan por «Cerrar»: gana la más corta y, a igualdad de
    // longitud, la usada más recientemente («Cerrar espacio» antes que «Cerrar
    // pestaña»).
    expect(ranked.map((entry) => entry.item.id)).toEqual(['b', 'c', 'a']);
  });

  it('a igual puntuación decide el uso reciente', () => {
    const ranked = rankByScore(
      items,
      () => 1,
      (item) => recencyIndex(['c', 'b'], item.id),
    );
    expect(ranked.map((entry) => entry.item.id)).toEqual(['c', 'b', 'a']);
  });

  it('descarta lo que no puntúa', () => {
    const ranked = rankByScore(
      items,
      (item) => fuzzyScore('panel', item.text),
      () => 0,
    );
    expect(ranked.map((entry) => entry.item.id)).toEqual(['b']);
  });
});

describe('lista de recientes', () => {
  it('mete el nuevo delante, sin repetir y con tope', () => {
    expect(pushRecent([], 'a')).toEqual(['a']);
    expect(pushRecent(['a', 'b'], 'b')).toEqual(['b', 'a']);
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });

  it('el índice de recencia deja los no usados al final', () => {
    expect(recencyIndex(['x', 'y'], 'x')).toBe(0);
    expect(recencyIndex(['x', 'y'], 'y')).toBe(1);
    expect(recencyIndex(['x', 'y'], 'z')).toBe(2);
  });
});
