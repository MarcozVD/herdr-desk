import { describe, expect, it } from 'vitest';

import { es } from '../i18n/es';
import { describeApiError, isApiError, parseApiError } from './errors';

describe('parseApiError', () => {
  it('acepta el ApiError de los commands', () => {
    expect(parseApiError({ code: 'not_found', message: 'pane w1:p9' })).toEqual({
      code: 'not_found',
      message: 'pane w1:p9',
    });
  });

  it('acepta un string suelto', () => {
    expect(parseApiError('boom')).toEqual({ code: 'unknown', message: 'boom' });
  });

  it('acepta un Error de JS', () => {
    expect(parseApiError(new Error('sin conexión'))).toEqual({
      code: 'unknown',
      message: 'sin conexión',
    });
  });

  it('detecta la forma de ApiError', () => {
    expect(isApiError({ code: 'timeout', message: 'x' })).toBe(true);
    expect(isApiError({ message: 'x' })).toBe(false);
    expect(isApiError(null)).toBe(false);
  });
});

describe('describeApiError (Anexo C)', () => {
  it('traduce los códigos conocidos', () => {
    expect(describeApiError({ code: 'not_found', message: 'x' })).toBe(es.errors.not_found);
    expect(describeApiError({ code: 'stream_conflict', message: 'x' })).toBe(
      es.errors.stream_conflict,
    );
    expect(describeApiError({ code: 'popup_not_open', message: 'x' })).toBe(
      es.errors.popup_not_open,
    );
    expect(describeApiError({ code: 'agent_blocked', message: 'x' })).toBe(es.errors.agent_blocked);
  });

  it('rellena las plantillas con el contexto', () => {
    expect(describeApiError({ code: 'invalid_params', message: 'cols fuera de rango' })).toBe(
      'Datos inválidos: cols fuera de rango',
    );
    expect(describeApiError({ code: 'timeout', message: 'x' }, { method: 'pane.split' })).toBe(
      'herdr no respondió a tiempo (pane.split).',
    );
    expect(
      describeApiError({ code: 'transport', message: 'x' }, { session: 'herdr-desk-dev' }),
    ).toBe('No hay conexión con el servidor herdr (sesión herdr-desk-dev). ¿Está corriendo?');
    expect(
      describeApiError({ code: 'bridge_closed', message: 'x' }, { reason: 'stream_conflict' }),
    ).toBe('La terminal se desconectó (stream_conflict).');
  });

  it('un método no soportado muestra el aviso y el message crudo', () => {
    const text = describeApiError(
      { code: 'unsupported_method', message: 'unknown method pane.graphics.stream' },
      { method: 'pane.graphics.stream' },
    );
    expect(text).toContain('Esta versión de herdr no soporta «pane.graphics.stream»');
    expect(text).toContain('unknown method pane.graphics.stream');
  });

  it('nunca filtra el texto crudo en códigos desconocidos', () => {
    expect(describeApiError({ code: 'raro', message: 'stack interno' })).toBe(
      'Error inesperado: stack interno',
    );
  });
});
