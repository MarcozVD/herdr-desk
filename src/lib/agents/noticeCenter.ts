// T2.5 — Une los avisos de agente con los toasts de la UI y con la preferencia
// del usuario (`[ui.toast] delivery`). El orden de las comprobaciones importa:
// primero se guarda el snapshot nuevo (para no avisar dos veces de lo mismo) y
// después se decide si toca avisar.

import type { AgentInfo } from '../herdr/types';
import { settings } from '../stores/settings.svelte';
import { ui } from '../stores/ui.svelte';
import {
  captureAgentStates,
  diffAgentNotices,
  NoticeBuffer,
  noticeText,
  shouldNotify,
  type AgentNotice,
  type AgentState,
  type NoticeContext,
} from './agentNotices';

class NoticeCenter {
  #previous: AgentState[] = [];
  #lastRevision = 0;
  #buffer = new NoticeBuffer((groups) => {
    for (const group of groups) {
      const kind = group[0]?.kind;
      ui.notify(noticeText(group), kind === 'blocked' ? 'warn' : 'info');
    }
  });

  /**
   * Se llama con cada refresco del store (el snapshot es la fuente de verdad).
   * `revision` es la del snapshot: si repite, este refresco ya se miró.
   */
  observe(agents: readonly AgentInfo[], context: NoticeContext, revision = 0): void {
    if (revision > 0 && revision === this.#lastRevision) return;
    this.#lastRevision = revision;
    // Por VALOR: el store reescribe los objetos de agente en su sitio, así que
    // guardar la lista por referencia dejaría «lo anterior» ya cambiado.
    const previous = this.#previous;
    const next = captureAgentStates(agents);
    this.#previous = next;
    if (settings.values.toast_delivery !== 'herdr') return;
    if (previous.length === 0) return;
    const notices = diffAgentNotices(previous, next).filter((notice) =>
      shouldNotify(notice, context),
    );
    this.#buffer.push(notices, settings.values.toast_group_ms);
  }

  /** Cambio de sesión: no hay nada con lo que comparar. */
  reset(): void {
    this.#previous = [];
    this.#lastRevision = 0;
    this.#buffer.flushNow();
  }

  /** Solo para los tests. */
  flushNow(): void {
    this.#buffer.flushNow();
  }

  /** Aviso suelto (los tests y el botón de la campana). */
  show(notices: readonly AgentNotice[]): void {
    for (const group of notices.length === 0 ? [] : [notices]) {
      const kind = group[0]?.kind;
      ui.notify(noticeText(group), kind === 'blocked' ? 'warn' : 'info');
    }
  }
}

export const noticeCenter = new NoticeCenter();
