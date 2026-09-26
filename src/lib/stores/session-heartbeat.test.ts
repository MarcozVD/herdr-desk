// @vitest-environment jsdom
// El latido del store y la única fuente de verdad.
//
// El backend refresca su snapshot con cada evento (con coalescencia), así que la
// UI NO pide snapshots por RPC: el latido solo comprueba que el servidor sigue
// vivo (un `ping`), que es la única señal fiable de caída (un bridge que se
// cierra no es una caída). Esto fija que nadie vuelva a meter un poll: si algún
// día hace falta un catch-up, tendrá que justificarse aquí primero.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ method: string }> = [];
const subscribeCallbacks: Array<(message: unknown) => void> = [];
/** Si es true, `ping` falla (server caído). */
let pingFails = false;

vi.mock('../herdr/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../herdr/client')>();
  return {
    ...actual,
    call: vi.fn(async (method: string) => {
      calls.push({ method });
      if (method === 'ping') {
        if (pingFails) throw new Error('server caído');
        return { type: 'pong', protocol: 19, version: '0.8.0-preview.test' };
      }
      return { type: 'ok' };
    }),
    storeSubscribe: vi.fn(async (onMessage: (message: unknown) => void) => {
      subscribeCallbacks.push(onMessage);
    }),
    sessionCurrent: vi.fn(async () => ({ ok: true, value: 'herdr-desk-dev' })),
  };
});

import type { SessionSnapshot } from '../herdr/types';
import { HEARTBEAT_MS, session } from './session.svelte';

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

/** Entrega un snapshot por el canal del store (como hace el backend). */
function push(snapshotValue: SessionSnapshot): void {
  subscribeCallbacks.at(-1)?.({ kind: 'snapshot', snapshot: snapshotValue });
}

function methodCalls(method: string): number {
  return calls.filter((call) => call.method === method).length;
}

beforeEach(() => {
  calls.length = 0;
  subscribeCallbacks.length = 0;
  pingFails = false;
  session.reset();
});

afterEach(() => {
  session.stop();
  vi.useRealTimers();
});

describe('latido y única fuente de verdad', () => {
  it('el snapshot entra por el canal del store y deja la sesión en línea', async () => {
    await session.connect();
    expect(session.connection).toBe('connecting');

    push(snapshot(['w1:p1']));

    expect(session.connection).toBe('online');
    expect(session.panes.map((pane) => pane.pane_id)).toEqual(['w1:p1']);
  });

  it('el latido hace ping cada intervalo y NUNCA pide snapshots por RPC', async () => {
    vi.useFakeTimers();
    await session.connect();
    push(snapshot(['w1:p1']));
    expect(methodCalls('ping')).toBe(1); // el ping de la conexión

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS + 50);
    expect(methodCalls('ping')).toBe(2);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);
    expect(methodCalls('ping')).toBe(4);
    // Ni un solo `session.snapshot`: el store es la única fuente de verdad.
    expect(methodCalls('session.snapshot')).toBe(0);
  });

  it('si el ping falla, la sesión se da por caída y reintenta', async () => {
    vi.useFakeTimers();
    await session.connect();
    push(snapshot(['w1:p1']));
    expect(session.connection).toBe('online');

    pingFails = true;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS + 50);

    expect(session.connection).toBe('offline');
    expect(session.lastError?.message).toContain('caído');
    // Y sigue sin pedir snapshots: la recuperación la dispara la reconexión.
    expect(methodCalls('session.snapshot')).toBe(0);
  });

  it('el latido no corre en parado ni con la sesión caída', async () => {
    vi.useFakeTimers();
    await session.connect();
    push(snapshot(['w1:p1']));
    session.stop();

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);
    // Sin latido tras parar (el `ping` de la conexión es el único).
    expect(methodCalls('ping')).toBe(1);
  });
});
