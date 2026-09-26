// @vitest-environment jsdom
// T2.5 — El centro de avisos: respeta la preferencia del usuario, no avisa de lo
// que ya está en pantalla y agrupa las ráfagas.

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentInfo } from '../herdr/types';
import { noticeCenter } from './noticeCenter';
import { noticeSound } from './noticeSound';
import { settings } from '../stores/settings.svelte';
import { ui } from '../stores/ui.svelte';

function agent(paneId: string, status: AgentInfo['agent_status']) {
  return {
    pane_id: paneId,
    terminal_id: `term_${paneId}`,
    workspace_id: 'w1',
    tab_id: 'w1:t1',
    focused: false,
    agent_status: status,
    revision: 0,
  } as unknown as AgentInfo;
}

const context = { focusedPaneId: 'w1:p9', windowFocused: true };

function clearToasts(): void {
  for (const toast of [...ui.toasts]) ui.dismissToast(toast.id);
}

const toneSpy = vi.spyOn(noticeSound, 'play').mockResolvedValue(true);

afterEach(() => {
  toneSpy.mockClear();
  noticeCenter.reset();
  clearToasts();
  settings.values.toast_delivery = 'off';
  settings.values.toast_group_ms = 1000;
  vi.useRealTimers();
});

describe('preferencia de notificaciones (T2.5)', () => {
  it('apagada (el valor por defecto de herdr) no avisa de nada', () => {
    settings.values.toast_delivery = 'off';
    noticeCenter.reset();
    noticeCenter.observe([agent('w1:p1', 'working')], context);
    noticeCenter.observe([agent('w1:p1', 'blocked')], context);
    noticeCenter.flushNow();
    expect(ui.toasts).toHaveLength(0);
  });

  it('activada avisa del cambio de estado', () => {
    settings.values.toast_delivery = 'herdr';
    noticeCenter.reset();
    noticeCenter.observe([agent('w1:p1', 'working')], context);
    noticeCenter.observe([agent('w1:p1', 'blocked')], context);
    noticeCenter.flushNow();
    expect(ui.toasts).toHaveLength(1);
    expect(ui.toasts[0]?.text).toBe('«w1:p1» está esperando tu respuesta.');
    expect(ui.toasts[0]?.kind).toBe('warn');
  });

  it('el primer snapshot solo sirve de referencia', () => {
    settings.values.toast_delivery = 'herdr';
    noticeCenter.reset();
    noticeCenter.observe([agent('w1:p1', 'blocked'), agent('w1:p2', 'done')], context);
    noticeCenter.flushNow();
    expect(ui.toasts).toHaveLength(0);
  });

  it('no avisa del panel que el usuario está mirando', () => {
    settings.values.toast_delivery = 'herdr';
    noticeCenter.reset();
    noticeCenter.observe([agent('w1:p1', 'working')], {
      focusedPaneId: 'w1:p1',
      windowFocused: true,
    });
    noticeCenter.observe([agent('w1:p1', 'done')], { focusedPaneId: 'w1:p1', windowFocused: true });
    noticeCenter.flushNow();
    expect(ui.toasts).toHaveLength(0);

    // Con la ventana de fondo sí avisa (es el caso de herdr: no estás mirando).
    noticeCenter.observe([agent('w1:p1', 'blocked')], {
      focusedPaneId: 'w1:p1',
      windowFocused: false,
    });
    noticeCenter.flushNow();
    expect(ui.toasts).toHaveLength(1);
  });
});

describe('sonido de los avisos (T2.5)', () => {
  it('bloqueado y terminado suenan; la salida no', () => {
    settings.values.toast_delivery = 'herdr';
    noticeCenter.reset();
    noticeCenter.observe([agent('w1:p1', 'idle')], context);

    noticeCenter.observe([agent('w1:p1', 'working')], context);
    expect(toneSpy).not.toHaveBeenCalled(); // empezar a trabajar no suena

    noticeCenter.observe([agent('w1:p1', 'blocked')], context);
    expect(toneSpy).toHaveBeenLastCalledWith('request');

    noticeCenter.observe([agent('w1:p1', 'working')], context);
    noticeCenter.observe([agent('w1:p1', 'done')], context);
    expect(toneSpy).toHaveBeenLastCalledWith('done');
  });

  it('el sonido NO depende del reparto de toasts', () => {
    settings.values.toast_delivery = 'off';
    noticeCenter.reset();
    noticeCenter.observe([agent('w1:p1', 'working')], context);
    noticeCenter.observe([agent('w1:p1', 'blocked')], context);
    noticeCenter.flushNow();

    expect(toneSpy).toHaveBeenLastCalledWith('request');
    expect(ui.toasts).toHaveLength(0); // sin toasts, pero con sonido
  });
});

describe('agrupado de ráfagas (T2.5)', () => {
  it('tres agentes que se bloquean a la vez salen en un solo toast', () => {
    vi.useFakeTimers();
    try {
      settings.values.toast_delivery = 'herdr';
      settings.values.toast_group_ms = 1000;
      noticeCenter.reset();
      // Los tres agentes ya existían (el primer snapshot solo referencia).
      noticeCenter.observe(
        [agent('w1:p1', 'working'), agent('w1:p2', 'working'), agent('w1:p3', 'working')],
        context,
      );
      // La ráfaga llega repartida en tres refrescos seguidos del store.
      noticeCenter.observe(
        [agent('w1:p1', 'blocked'), agent('w1:p2', 'working'), agent('w1:p3', 'working')],
        context,
      );
      noticeCenter.observe(
        [agent('w1:p1', 'blocked'), agent('w1:p2', 'blocked'), agent('w1:p3', 'working')],
        context,
      );
      noticeCenter.observe(
        [agent('w1:p1', 'blocked'), agent('w1:p2', 'blocked'), agent('w1:p3', 'done')],
        context,
      );
      expect(ui.toasts).toHaveLength(0);

      vi.advanceTimersByTime(1000);
      // Un toast por tipo: los bloqueados agrupados y el terminado aparte.
      expect(ui.toasts).toHaveLength(2);
      expect(ui.toasts[0]?.text).toBe('2 agentes están esperando tu respuesta.');
      expect(ui.toasts[1]?.text).toBe('«w1:p3» terminó.');
    } finally {
      vi.useRealTimers();
    }
  });
});
