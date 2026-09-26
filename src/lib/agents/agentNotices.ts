// T2.5 — Avisos de agente para los toasts in-app: qué cambió entre dos
// snapshots, si merece interrumpir al usuario y cómo se resume cuando llegan
// varios en ráfaga.
//
// El overlay de la barra de tareas solo lleva el CONTEO de bloqueados; el toast
// lleva el detalle (quién y qué pasó), así que no se duplican: uno es el
// indicador de vistazo y el otro la notificación.
//
// La preferencia del usuario manda: con `[ui.toast] delivery = "off"` (el valor
// por defecto de herdr) no se avisa de nada.

import type { AgentInfo } from '../herdr/types';

export type AgentNoticeKind = 'blocked' | 'done' | 'output';

export interface AgentNotice {
  kind: AgentNoticeKind;
  paneId: string;
  name: string;
}

export interface NoticeContext {
  focusedPaneId: string | null;
  windowFocused: boolean;
}

/**
 * Cambios de estado que merecen un aviso: un agente que pasa a bloqueado o a
 * terminado, y uno que empieza a producir salida (idle/unknown → trabajando).
 * Un agente nuevo (reportado o arrancado) no avisa: lo acaba de pedir el usuario.
 */
export function diffAgentNotices(
  previous: readonly AgentInfo[],
  next: readonly AgentInfo[],
): AgentNotice[] {
  const before = new Map(previous.map((agent) => [agent.pane_id, agent.agent_status]));
  const notices: AgentNotice[] = [];
  for (const agent of next) {
    const was = before.get(agent.pane_id);
    if (was === undefined || was === agent.agent_status) continue;
    const name = agent.display_agent ?? agent.name ?? agent.agent ?? agent.pane_id;
    if (agent.agent_status === 'blocked') {
      notices.push({ kind: 'blocked', paneId: agent.pane_id, name });
    } else if (agent.agent_status === 'done') {
      notices.push({ kind: 'done', paneId: agent.pane_id, name });
    } else if (agent.agent_status === 'working' && was !== 'working') {
      notices.push({ kind: 'output', paneId: agent.pane_id, name });
    }
  }
  return notices;
}

/**
 * No se avisa de lo que el usuario ya está mirando: el panel enfocado con la
 * ventana en primer plano. Todo lo demás sí (otros paneles, otras pestañas,
 * ventana de fondo).
 */
export function shouldNotify(notice: AgentNotice, context: NoticeContext): boolean {
  return !(notice.paneId === context.focusedPaneId && context.windowFocused);
}

/** Avisos del mismo tipo, ya filtrados, resumidos en una línea. */
export function noticeText(notices: readonly AgentNotice[]): string {
  const kind = notices[0]?.kind;
  if (kind === undefined) return '';
  const count = notices.length;
  if (count === 1) {
    const one = notices[0] as AgentNotice;
    switch (one.kind) {
      case 'blocked':
        return `«${one.name}» está esperando tu respuesta.`;
      case 'done':
        return `«${one.name}» terminó.`;
      case 'output':
        return `«${one.name}» empezó a producir salida.`;
    }
  }
  switch (kind) {
    case 'blocked':
      return `${count} agentes están esperando tu respuesta.`;
    case 'done':
      return `${count} agentes terminaron.`;
    case 'output':
      return `${count} agentes empezaron a producir salida.`;
  }
}

/** Agrupa por tipo, respetando el orden de llegada de los tipos. */
export function groupNotices(notices: readonly AgentNotice[]): AgentNotice[][] {
  const order: AgentNoticeKind[] = [];
  const groups = new Map<AgentNoticeKind, AgentNotice[]>();
  for (const notice of notices) {
    const group = groups.get(notice.kind);
    if (group) group.push(notice);
    else {
      groups.set(notice.kind, [notice]);
      order.push(notice.kind);
    }
  }
  return order.map((kind) => groups.get(kind) as AgentNotice[]);
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * Junta los avisos que llegan seguidos (una ráfaga de agentes que se bloquean a
 * la vez) en un solo resumen por tipo, tras `delayMs` — el `delay_seconds` de
 * herdr, pensado justo para esto.
 */
export class NoticeBuffer {
  #pending: AgentNotice[] = [];
  #timer: Timer | null = null;

  constructor(
    private readonly flush: (groups: AgentNotice[][]) => void,
    private readonly delayMs = 1000,
    // Las funciones se resuelven en cada llamada (no al construir): así los
    // temporizadores falsos de los tests también valen para este buffer.
    private readonly schedule: (callback: () => void, ms: number) => Timer = (callback, ms) =>
      setTimeout(callback, ms),
    private readonly cancel: (timer: Timer) => void = (timer) => clearTimeout(timer),
  ) {}

  push(notices: readonly AgentNotice[], delayMs = this.delayMs): void {
    if (notices.length === 0) return;
    this.#pending.push(...notices);
    if (this.#timer === null) {
      this.#timer = this.schedule(() => this.flushNow(), delayMs);
    }
  }

  /** Fuerza la salida de lo pendiente (tests y cierre de la app). */
  flushNow(): void {
    if (this.#timer !== null) {
      this.cancel(this.#timer);
      this.#timer = null;
    }
    const pending = this.#pending;
    this.#pending = [];
    if (pending.length === 0) return;
    this.flush(groupNotices(pending));
  }

  get size(): number {
    return this.#pending.length;
  }
}
