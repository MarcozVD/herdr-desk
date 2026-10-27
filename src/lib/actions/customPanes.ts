// T4b — Cierre automático de los paneles que abren los comandos `pane`/`popup`
// de `[[keys.command]]`. El servidor avisa con `pane.exited`; se sigue el id del
// panel creado (nunca "el último abierto") y se cierra si el server aún lo
// mantiene en el snapshot.

import { paneApi } from '../herdr/actions';
import { watchEvents, type EventWatch } from '../herdr/client';
import type { EventEnvelope } from '../herdr/types.gen';
import { layout } from '../stores/layout.svelte';
import { session } from '../stores/session.svelte';

const tracked = new Set<string>();
let watch: EventWatch | null = null;
let starting = false;
/** T4b — Los cambios de sesión invalidan una apertura que aún no ha vuelto. */
let generation = 0;

function stopIfIdle(): void {
  if (tracked.size > 0 || !watch) return;
  watch.close();
  watch = null;
}

function onEvent(event: EventEnvelope): void {
  // El core normaliza a `pane.exited`, pero el tipo generado del wire usa
  // snake_case: se aceptan las dos formas para no depender del transporte.
  const kind = String(event.event);
  if (kind !== 'pane.exited' && kind !== 'pane_exited') return;
  const paneId = (event.data as { pane_id?: unknown } | null)?.pane_id;
  if (typeof paneId !== 'string' || !tracked.delete(paneId)) return;
  // La salida del proceso no siempre cierra el pane (el server puede dejarlo
  // para que se lea su última salida): si sigue en el snapshot, se cierra.
  if (session.panes.some((pane) => pane.pane_id === paneId)) {
    void paneApi
      .close(paneId)
      .catch(() => undefined)
      .finally(() => void layout.refreshNow());
  }
  stopIfIdle();
}

function ensureWatch(): void {
  if (watch !== null || starting) return;
  starting = true;
  const current = generation;
  void watchEvents(['pane.exited'], onEvent)
    .then((handle) => {
      if (current !== generation) {
        handle.close();
        return;
      }
      watch = handle;
      starting = false;
      stopIfIdle();
    })
    .catch(() => {
      // Backend viejo sin events_watch: no se puede cerrar solo; el panel se
      // queda como hasta ahora (cierre manual), sin romper el comando.
      if (current === generation) starting = false;
    });
}

/** Registra el pane creado por un comando personalizado para cerrarlo al salir. */
export function trackCustomPane(paneId: string): void {
  tracked.add(paneId);
  ensureWatch();
}

/** Suelta la suscripción (al desmontar la app o cambiar de sesión). */
export function stopCustomPaneWatch(): void {
  generation += 1;
  tracked.clear();
  watch?.close();
  watch = null;
  starting = false;
}
