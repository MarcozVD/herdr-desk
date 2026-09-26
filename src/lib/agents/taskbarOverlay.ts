// T2.4 — Conteo de agentes bloqueados en el overlay del icono de la barra de
// tareas.
//
// El backend pinta el overlay (`taskbar_overlay` en `src-tauri/src/overlay.rs`);
// aquí solo se le manda el número. Va aparte del resto de la UI por dos motivos:
//   1. el command puede NO existir (backend anterior a T2.4, o plataforma sin
//      overlay): el conteo es decorativo, así que si falta se sigue sin overlay
//      y se avisa una sola vez por consola;
//   2. cada snapshot traería el mismo número: se cachea el último valor enviado
//      y solo se llama al backend cuando CAMBIA (cero IPC por refresco).

import { taskbarOverlay } from '../herdr/client';

/** Último conteo enviado: `undefined` = todavía no se ha hablado con el backend. */
let lastSent: number | null | undefined;
let warned = false;

/**
 * Manda al backend el conteo de agentes bloqueados (0 → quita el overlay).
 * Devuelve `true` si se llamó al backend y `false` si no había nada que enviar.
 */
export async function syncBlockedOverlay(blocked: number): Promise<boolean> {
  const next = blocked > 0 ? Math.trunc(blocked) : null;
  if (next === lastSent) return false;
  lastSent = next;
  const outcome = await taskbarOverlay(next);
  if (!outcome.ok && !warned) {
    warned = true;
    const why =
      outcome.kind === 'missing' ? 'el command no está en este backend' : outcome.error.message;
    console.warn(`[T2.4] sin overlay en la barra de tareas: ${why}`);
  }
  return true;
}

/** Solo para tests: olvida el último valor enviado y el aviso. */
export function resetBlockedOverlay(): void {
  lastSent = undefined;
  warned = false;
}
