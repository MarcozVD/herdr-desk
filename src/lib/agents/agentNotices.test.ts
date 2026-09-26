// T2.5 — Avisos de agente: diferencia entre snapshots, filtro por atención del
// usuario y agrupado de ráfagas.

import { describe, expect, it, vi } from 'vitest';

import type { AgentInfo } from '../herdr/types';
import {
  diffAgentNotices,
  groupNotices,
  NoticeBuffer,
  noticeText,
  shouldNotify,
  type AgentNotice,
} from './agentNotices';

function agent(paneId: string, status: AgentInfo['agent_status'], extra: Partial<AgentInfo> = {}) {
  return {
    pane_id: paneId,
    terminal_id: `term_${paneId}`,
    workspace_id: 'w1',
    tab_id: 'w1:t1',
    focused: false,
    agent_status: status,
    revision: 0,
    ...extra,
  } as unknown as AgentInfo;
}

describe('diferencia entre snapshots (T2.5)', () => {
  it('avisa de bloqueado, terminado y de empezar a producir salida', () => {
    const previous = [
      agent('w1:p1', 'working', { display_agent: 'Claude' }),
      agent('w1:p2', 'working', { name: 'hd-bot' }),
      agent('w1:p3', 'idle', { agent: 'opencode' }),
      agent('w1:p4', 'idle'),
    ];
    const next = [
      agent('w1:p1', 'blocked', { display_agent: 'Claude' }),
      agent('w1:p2', 'done', { name: 'hd-bot' }),
      agent('w1:p3', 'working', { agent: 'opencode' }),
      agent('w1:p4', 'idle'),
    ];
    expect(diffAgentNotices(previous, next)).toEqual([
      { kind: 'blocked', paneId: 'w1:p1', name: 'Claude' },
      { kind: 'done', paneId: 'w1:p2', name: 'hd-bot' },
      { kind: 'output', paneId: 'w1:p3', name: 'opencode' },
    ]);
  });

  it('un agente nuevo no avisa: lo acaba de pedir el usuario', () => {
    const previous = [agent('w1:p1', 'idle')];
    const next = [agent('w1:p1', 'idle'), agent('w1:p2', 'blocked'), agent('w1:p3', 'done')];
    expect(diffAgentNotices(previous, next)).toEqual([]);
  });

  it('sin cambios no hay avisos; volver de bloqueado a trabajar sí lo es', () => {
    const previous = [agent('w1:p1', 'blocked'), agent('w1:p2', 'working')];
    expect(diffAgentNotices(previous, previous)).toEqual([]);
    // El usuario respondió al agente y volvió a producir: es llegada de salida.
    // Pasar a inactivo, en cambio, no avisa de nada.
    expect(diffAgentNotices(previous, [agent('w1:p1', 'working'), agent('w1:p2', 'idle')])).toEqual(
      [{ kind: 'output', paneId: 'w1:p1', name: 'w1:p1' }],
    );
  });
});

describe('filtro por atención (T2.5)', () => {
  const notice: AgentNotice = { kind: 'blocked', paneId: 'w1:p1', name: 'hd-bot' };

  it('no avisa de lo que el usuario está mirando', () => {
    expect(shouldNotify(notice, { focusedPaneId: 'w1:p1', windowFocused: true })).toBe(false);
    // Con la ventana de fondo sí avisa aunque sea el panel enfocado.
    expect(shouldNotify(notice, { focusedPaneId: 'w1:p1', windowFocused: false })).toBe(true);
    // Otro panel siempre avisa.
    expect(shouldNotify(notice, { focusedPaneId: 'w1:p2', windowFocused: true })).toBe(true);
    expect(shouldNotify(notice, { focusedPaneId: null, windowFocused: true })).toBe(true);
  });
});

describe('texto de los avisos (T2.5)', () => {
  it('uno solo dice quién; varios se agrupan por tipo', () => {
    expect(noticeText([{ kind: 'blocked', paneId: 'w1:p1', name: 'hd-bot' }])).toBe(
      '«hd-bot» está esperando tu respuesta.',
    );
    expect(noticeText([{ kind: 'done', paneId: 'w1:p1', name: 'hd-bot' }])).toBe(
      '«hd-bot» terminó.',
    );
    expect(noticeText([{ kind: 'output', paneId: 'w1:p1', name: 'hd-bot' }])).toBe(
      '«hd-bot» empezó a producir salida.',
    );

    const burst: AgentNotice[] = [
      { kind: 'blocked', paneId: 'w1:p1', name: 'a' },
      { kind: 'blocked', paneId: 'w1:p2', name: 'b' },
      { kind: 'blocked', paneId: 'w1:p3', name: 'c' },
      { kind: 'done', paneId: 'w1:p4', name: 'd' },
      { kind: 'done', paneId: 'w1:p5', name: 'e' },
    ];
    const groups = groupNotices(burst);
    expect(groups).toHaveLength(2);
    expect(noticeText(groups[0]!)).toBe('3 agentes están esperando tu respuesta.');
    expect(noticeText(groups[1]!)).toBe('2 agentes terminaron.');
    expect(noticeText([])).toBe('');
  });
});

describe('agrupado de ráfagas (T2.5)', () => {
  it('junta lo que llega seguido y espera el retardo antes de sacarlo', () => {
    vi.useFakeTimers();
    try {
      const flushes: AgentNotice[][] = [];
      const buffer = new NoticeBuffer((groups) => {
        for (const group of groups) flushes.push(group);
      }, 1000);

      buffer.push([{ kind: 'blocked', paneId: 'w1:p1', name: 'a' }]);
      buffer.push([{ kind: 'blocked', paneId: 'w1:p2', name: 'b' }]);
      expect(flushes).toHaveLength(0);
      expect(buffer.size).toBe(2);

      vi.advanceTimersByTime(1000);
      expect(flushes).toHaveLength(1);
      expect(flushes[0]).toHaveLength(2);
      expect(buffer.size).toBe(0);

      // Vacío no programa nada.
      buffer.push([]);
      vi.advanceTimersByTime(1000);
      expect(flushes).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('respeta el retardo que se le pasa (delay_seconds de la config)', () => {
    vi.useFakeTimers();
    try {
      const flushes: AgentNotice[][] = [];
      const buffer = new NoticeBuffer((groups) => flushes.push(...groups), 1000);
      buffer.push([{ kind: 'done', paneId: 'w1:p1', name: 'a' }], 200);
      vi.advanceTimersByTime(199);
      expect(flushes).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(flushes).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushNow saca lo pendiente en el momento', () => {
    const flushes: AgentNotice[][] = [];
    const buffer = new NoticeBuffer((groups) => flushes.push(...groups), 60_000);
    buffer.push([{ kind: 'done', paneId: 'w1:p1', name: 'a' }]);
    buffer.flushNow();
    expect(flushes).toHaveLength(1);
    // ya no queda nada: el temporizador está cancelado
    buffer.flushNow();
    expect(flushes).toHaveLength(1);
  });
});
