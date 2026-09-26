// @vitest-environment jsdom
// El canal del store del backend solo empuja cuando el backend refresca su
// snapshot (su kick de eventos se dispara al cerrar la conexión, no por evento).
// Para que la UI no se quede congelada, el latido pide `session.snapshot` cuando
// no ha habido pushes, y las acciones de la GUI refrescan tras mutar.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ method: string }> = [];

vi.mock('../herdr/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../herdr/client')>();
  return {
    ...actual,
    call: vi.fn(async (method: string) => {
      calls.push({ method });
      if (method === 'ping') {
        return { type: 'pong', protocol: 19, version: '0.8.0-preview.test' };
      }
      if (method === 'session.snapshot') {
        return { type: 'session_snapshot', snapshot: snapshot(['w1:p1', 'w1:p2']) };
      }
      return { type: 'ok' };
    }),
    storeSubscribe: vi.fn(async () => undefined),
    sessionCurrent: vi.fn(async () => ({ ok: true, value: 'herdr-desk-dev' })),
  };
});

import type { SessionSnapshot } from '../herdr/types';
import { session, HEARTBEAT_MS } from './session.svelte';

function snapshot(paneIds: string[]): SessionSnapshot {
  return {
    version: '0.8.0-preview.test',
    protocol: 19,
    focused_workspace_id: 'w1',
    focused_tab_id: 'w1:t1',
    focused_pane_id: paneIds[0] ?? null,
    workspaces: [],
    tabs: [],
    panes: paneIds.map((paneId) => ({
      pane_id: paneId,
      terminal_id: `term_${paneId}`,
      workspace_id: 'w1',
      tab_id: 'w1:t1',
      focused: false,
      agent_status: 'unknown',
      revision: 0,
    })),
    agents: [],
    layouts: [],
  } as unknown as SessionSnapshot;
}

function snapshotCalls(): number {
  return calls.filter((call) => call.method === 'session.snapshot').length;
}

beforeEach(() => {
  calls.length = 0;
  session.reset();
});

afterEach(() => {
  session.stop();
  vi.useRealTimers();
});

describe('catch-up del snapshot (latido y acciones)', () => {
  it('refreshSnapshot aplica el snapshot que devuelve el server', async () => {
    expect(session.panes).toEqual([]);

    await session.refreshSnapshot();

    expect(snapshotCalls()).toBe(1);
    expect(session.panes.map((pane) => pane.pane_id)).toEqual(['w1:p1', 'w1:p2']);
    expect(session.connection).toBe('online');
  });

  it('el latido pide el snapshot cuando el store no ha empujado nada', async () => {
    vi.useFakeTimers();
    await session.connect();
    await session.refreshSnapshot(); // deja la sesión «en línea»
    expect(snapshotCalls()).toBe(1);
    // Simula un intervalo entero sin mensajes del store.
    session.lastMessageAt = null;

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS + 50);

    expect(snapshotCalls()).toBe(2);
  });

  it('el latido no pide snapshot si el store acaba de empujar', async () => {
    vi.useFakeTimers();
    await session.connect();
    await session.refreshSnapshot();
    expect(snapshotCalls()).toBe(1);
    // Un push del store dentro del intervalo del latido.
    session.lastMessageAt = performance.now();

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS - 2_000);

    expect(snapshotCalls()).toBe(1);
  });

  // El catch-up es un PARCHE TEMPORAL por el backend (el kick del store solo se
  // dispara al cerrar la conexión de eventos). Tiene que poder apagarse de una
  // pieza: `session.setSnapshotCatchUp(false)`.
  it('el parche se apaga de una pieza con setSnapshotCatchUp(false)', async () => {
    await session.refreshSnapshot();
    expect(snapshotCalls()).toBe(1);

    session.setSnapshotCatchUp(false);
    expect(session.snapshotCatchUp).toBe(false);

    // Ni la llamada directa ni las acciones refrescan.
    await session.refreshSnapshot();
    expect(snapshotCalls()).toBe(1);

    session.setSnapshotCatchUp(true);
    await session.refreshSnapshot();
    expect(snapshotCalls()).toBe(2);
  });

  it('con el parche apagado el latido sigue comprobando el server pero no pide snapshot', async () => {
    vi.useFakeTimers();
    await session.connect();
    await session.refreshSnapshot();
    expect(snapshotCalls()).toBe(1);

    session.setSnapshotCatchUp(false);
    session.lastMessageAt = null;

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS + 50);

    // Solo el ping del latido (detección de caída, no es parte del parche).
    expect(snapshotCalls()).toBe(1);
    expect(calls.filter((call) => call.method === 'ping').length).toBeGreaterThan(1);
  });
});
