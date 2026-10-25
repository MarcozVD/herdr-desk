// Punto 7 (BUG 6) — Una sola implementación de «¿este id LOCAL sigue existiendo?».
//
// `visible` valida el foco local contra las colecciones reconciliadas de `session`
// y `ui.actionTarget` contra las listas que le pasa cada llamador. Eran dos
// implementaciones de la misma pregunta que podían divergir; ahora comparten este
// predicado.

/** ¿`local` es uno de los ids conocidos? `null` nunca lo es. */
export function isKnownId(local: string | null, known: readonly string[]): boolean {
  return local !== null && known.includes(local);
}

/** Devuelve `local` si sigue existiendo; si no, el respaldo. */
export function pickKnownId<T extends string>(
  local: T | null,
  known: readonly string[],
  fallback: T | null,
): T | null {
  return isKnownId(local, known) ? local : fallback;
}
