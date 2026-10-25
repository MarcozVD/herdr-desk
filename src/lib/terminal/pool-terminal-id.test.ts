// @vitest-environment jsdom
// BUG 6 punto 8 — Ids de pane estables. El pool asume que un `pane_id` no se
// recicla para otra terminal; si el servidor lo hace (`terminal_id` distinto),
// la entrada vieja (bridge + vista) es de OTRA terminal y hay que recrearla.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSnapshot } from '../herdr/types';

vi.mock('../herdr/client', () => ({
  terminalOpen: vi.fn(async () => 1),
  terminalClose: vi.fn(async () => undefined),
  terminalInput: vi.fn(async () => undefined),
  terminalInputBytes: vi.fn(async () => undefined),
  terminalResize: vi.fn(async () => undefined),
  terminalScroll: vi.fn(async () => undefined),
}));

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const { pool } = await import('./pool');
const { session } = await import('../stores/session.svelte');

beforeAll(() => {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
});

function snapshot(terminalId: string): SessionSnapshot {
  return {
    version: '0.8.0-preview.test',
    protocol: 19,
    focused_workspace_id: 'w1',
    focused_tab_id: 'w1:t1',
    focused_pane_id: 'w1:p1',
    workspaces: [
      {
        workspace_id: 'w1',
        number: 1,
        label: 'spike',
        focused: true,
        pane_count: 1,
        tab_count: 1,
        active_tab_id: 'w1:t1',
        agent_status: 'unknown',
      },
    ],
    tabs: [
      {
        tab_id: 'w1:t1',
        workspace_id: 'w1',
        number: 1,
        label: '1',
        focused: true,
        pane_count: 1,
        agent_status: 'unknown',
      },
    ],
    panes: [
      {
        pane_id: 'w1:p1',
        terminal_id: terminalId,
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        focused: true,
        agent_status: 'unknown',
        revision: 0,
      },
    ],
    agents: [],
    layouts: [],
  } as unknown as SessionSnapshot;
}

beforeEach(() => {
  session.reset();
});

afterEach(() => {
  pool.disposeAll();
  session.reset();
  document.body.innerHTML = '';
});

describe('punto 8 — pane_id reciclado para otra terminal', () => {
  it('recrea la entrada (vista nueva) cuando cambia el terminal_id', () => {
    session.applySnapshot(snapshot('term_1'));
    const host = document.createElement('div');
    document.body.append(host);

    const first = pool.mountView('w1:p1', host);
    const firstTerminal = first.view?.terminal;
    expect(first.terminalId).toBe('term_1');

    // Mismo terminal_id: se reutiliza la entrada y la vista.
    const same = pool.mountView('w1:p1', host);
    expect(same).toBe(first);
    expect(same.view?.terminal).toBe(firstTerminal);

    // El servidor recicla w1:p1 para otra terminal: la vista vieja muere.
    session.applySnapshot(snapshot('term_2'));
    const host2 = document.createElement('div');
    document.body.append(host2);

    const second = pool.mountView('w1:p1', host2);
    expect(second.terminalId).toBe('term_2');
    expect(second.view?.terminal).not.toBe(firstTerminal);
  });
});
