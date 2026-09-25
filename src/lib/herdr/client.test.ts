import { describe, expect, it } from 'vitest';

import { normalizeStoreMessage } from './client';

const snapshot = {
  version: '0.8.0-preview',
  protocol: 19,
  focused_workspace_id: 'w1',
  focused_tab_id: 'w1:t1',
  focused_pane_id: 'w1:p1',
  workspaces: [],
  tabs: [],
  panes: [],
  layouts: [],
  agents: [],
};

describe('normalizeStoreMessage', () => {
  it('acepta el snapshot crudo envuelto en {type, snapshot}', () => {
    const message = normalizeStoreMessage(JSON.stringify({ type: 'session_snapshot', snapshot }));
    expect(message.kind).toBe('snapshot');
    if (message.kind !== 'snapshot') return;
    expect(message.snapshot.protocol).toBe(19);
  });

  it('acepta el snapshot sin envoltorio', () => {
    const message = normalizeStoreMessage(JSON.stringify(snapshot));
    expect(message.kind).toBe('snapshot');
  });

  it('acepta el snapshot como bytes (Channel Raw)', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ type: 'session_snapshot', snapshot }));
    const message = normalizeStoreMessage(bytes.buffer as ArrayBuffer);
    expect(message.kind).toBe('snapshot');
  });

  it('reconoce los mensajes de estado de conexión', () => {
    expect(normalizeStoreMessage(JSON.stringify({ state: 'offline' }))).toEqual({
      kind: 'state',
      state: 'offline',
    });
  });

  it('marca como desconocido lo que no reconoce', () => {
    expect(normalizeStoreMessage('no es json').kind).toBe('unknown');
    expect(normalizeStoreMessage(JSON.stringify({ hola: 1 })).kind).toBe('unknown');
  });
});
