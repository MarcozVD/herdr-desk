// T2.6 — Búsqueda fuzzy de la paleta: normalización sin acentos, puntuación por
// coincidencia y orden por uso reciente. Sin runas ni DOM: se puede probar a
// fondo en vitest.

/**
 * Normaliza para buscar: minúsculas, sin diacríticos (NFD + quitar marcas) y
 * espacios colapsados. Así «Pestaña» encuentra «pestana» y al revés.
 */
export function normalizeQuery(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const WORD_START = /[^a-z0-9]/;

/**
 * Puntuación de una consulta contra un texto: `null` si no coincide.
 *
 * Reglas (de mayor a menor peso): la consulta entera como subcadena gana a
 * cualquier subsecuencia; dentro de las subcadenas, empezar en un límite de
 * palabra suma; en las subsecuencias suman los caracteres contiguos y los
 * inicios de palabra, y restan los huecos.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const needle = normalizeQuery(query);
  if (needle.length === 0) return 0;
  const haystack = normalizeQuery(target);
  if (haystack.length === 0) return null;

  const direct = haystack.indexOf(needle);
  if (direct >= 0) {
    const atWordStart = direct === 0 || WORD_START.test(haystack[direct - 1] ?? '');
    // Cuanto antes aparezca y más corta sea la etiqueta, mejor.
    return 1000 + (atWordStart ? 120 : 0) - direct * 2 - Math.min(80, haystack.length);
  }

  // Subsecuencia: todos los caracteres en orden, sin exigir contigüidad.
  let score = 300;
  let cursor = 0;
  let previousIndex = -1;
  let gaps = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found < 0) return null;
    if (previousIndex >= 0) {
      if (found === previousIndex + 1)
        score += 18; // contiguo
      else {
        gaps += found - previousIndex - 1;
        score -= 4;
      }
    }
    if (found === 0 || WORD_START.test(haystack[found - 1] ?? '')) score += 24;
    previousIndex = found;
    cursor = found + 1;
  }
  return Math.max(1, score - gaps * 3);
}

export interface Scored<T> {
  item: T;
  score: number;
}

/**
 * Ordena por puntuación y, a igualdad, por uso reciente. Con la consulta vacía
 * manda el uso reciente: es lo que el usuario hizo las últimas veces.
 */
export function rankByScore<T>(
  items: readonly T[],
  scoreOf: (item: T) => number | null,
  recencyOf: (item: T) => number,
): Scored<T>[] {
  const scored: Scored<T>[] = [];
  for (const item of items) {
    const score = scoreOf(item);
    if (score === null) continue;
    scored.push({ item, score });
  }
  return scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return recencyOf(a.item) - recencyOf(b.item);
  });
}

/** Índice de recencia: 0 el más reciente, `recent.length` los no usados. */
export function recencyIndex(recent: readonly string[], id: string): number {
  const index = recent.indexOf(id);
  return index < 0 ? recent.length : index;
}

/** Mete un id al principio de la lista de recientes (sin repetir, tope `max`). */
export function pushRecent(recent: readonly string[], id: string, max = 12): string[] {
  return [id, ...recent.filter((entry) => entry !== id)].slice(0, max);
}
