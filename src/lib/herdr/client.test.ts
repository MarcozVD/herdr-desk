import { describe, expect, it } from 'vitest';

import { classifyCommandError, normalizeStoreMessage } from './client';
import { isMissingTauriBridge } from './errors';

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

describe('classifyCommandError', () => {
  it('los tres formatos reales de Tauri son «command inexistente»', () => {
    const strings = [
      'Command session_start not found',
      'Command not found',
      'myplugin.unknown-command not allowed. Command not found',
    ];
    for (const raw of strings) {
      const outcome = classifyCommandError(raw);
      expect(outcome.kind, raw).toBe('missing');
      expect(outcome.error.code).toBe('missing_command');
    }
  });

  it('un error de negocio que menciona «not found» NO es un command que falta', () => {
    const outcome = classifyCommandError('la sesion hd-test-x not found');
    expect(outcome.kind).toBe('error');
  });

  it('un ApiError del backend es un error real y conserva SU mensaje', () => {
    const outcome = classifyCommandError({
      code: 'invalid_params',
      message: 'no se permite iniciar la sesion default desde la GUI',
    });
    expect(outcome.kind).toBe('error');
    expect(outcome.error.code).toBe('invalid_params');
    expect(outcome.error.message).toBe('no se permite iniciar la sesion default desde la GUI');
  });

  it('un error de negocio nunca se confunde con un command que falta', () => {
    const outcome = classifyCommandError({
      code: 'invalid_request',
      message: 'la sesion hd-test-x ya esta corriendo',
    });
    expect(outcome.kind).toBe('error');
    expect(outcome.error.message).toContain('ya esta corriendo');
  });

  it('los args mal formados son error del cliente, no command inexistente', () => {
    const outcome = classifyCommandError(
      'invalid args `name` for command `session_start`: command session_start missing required key name',
    );
    expect(outcome.kind).toBe('error');
    expect(outcome.error.code).toBe('invalid_args');
  });

  it('un string cualquiera es error (nunca «missing») y se muestra tal cual', () => {
    const outcome = classifyCommandError('exploto el bridge');
    expect(outcome.kind).toBe('error');
    expect(outcome.error.message).toBe('exploto el bridge');
  });
});

describe('isMissingTauriBridge', () => {
  it('detecta el TypeError de abrir la UI fuera de Tauri', () => {
    expect(
      isMissingTauriBridge(
        new TypeError("Cannot read properties of undefined (reading 'transformCallback')"),
      ),
    ).toBe(true);
    expect(isMissingTauriBridge('window.__TAURI_INTERNALS__ is undefined')).toBe(true);
  });

  it('un error normal del backend no se confunde con el puente ausente', () => {
    expect(isMissingTauriBridge({ code: 'transport', message: 'no hay conexion' })).toBe(false);
  });
});
