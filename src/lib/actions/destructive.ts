// T4g — Un solo helper para las acciones destructivas de la GUI: normaliza el
// `danger: true` y encadena los avisos (algunas acciones piden dos). Los flujos
// que lo usan siguen decidiendo cuándo llamarlo y qué hacer con el resultado.

import { ui } from '../stores/ui.svelte';
import type { ConfirmRequest } from '../stores/ui.svelte';

/**
 * Pide confirmación para `request` (o para cada aviso de la lista, en orden).
 * Devuelve `false` en el primer aviso cancelado; no ejecuta nada por sí mismo.
 */
export async function confirmDestructive(
  request: ConfirmRequest | readonly ConfirmRequest[],
): Promise<boolean> {
  const requests = Array.isArray(request) ? request : [request];
  for (const item of requests) {
    const accepted = await ui.confirm({ ...item, danger: true });
    if (!accepted) return false;
  }
  return true;
}
