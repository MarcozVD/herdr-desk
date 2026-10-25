// BUG 5 — Helpers del ratón sintético (SGR 1006). Puros: formato exacto de la
// secuencia, códigos de botón/modificador, celda 1-based y gating por agente.

import { describe, expect, it } from 'vitest';

import {
  agentPane,
  cellAt,
  isLinkClick,
  mouseSequence,
  sgrButton,
  sgrModifiers,
  wantsLocalSelection,
} from './mouse';

const alterno = { buffer: { active: { type: 'alternate' } } };
const normal = { buffer: { active: { type: 'normal' } } };

describe('agentPane (gating compartido con la rueda)', () => {
  it('es agente si el pane lo dice, aunque el buffer sea normal', () => {
    expect(agentPane({ agent: 'opencode' }, normal)).toBe(true);
  });

  it('es agente si el buffer activo es el alterno, aunque no haya campo agent', () => {
    expect(agentPane(null, alterno)).toBe(true);
  });

  it('no es agente en un shell normal', () => {
    expect(agentPane({ agent: null }, normal)).toBe(false);
    expect(agentPane(undefined, undefined)).toBe(false);
  });
});

describe('códigos y modificadores SGR', () => {
  it('mapea botones a 0/1/2', () => {
    expect(sgrButton(0)).toBe(0);
    expect(sgrButton(1)).toBe(1);
    expect(sgrButton(2)).toBe(2);
    expect(sgrButton(5)).toBe(0); // desconocido → izquierda
  });

  it('suma shift 4, alt 8 y ctrl 16', () => {
    expect(sgrModifiers({ shiftKey: false, altKey: false, ctrlKey: false })).toBe(0);
    expect(sgrModifiers({ shiftKey: true, altKey: true, ctrlKey: true })).toBe(28);
  });

  it('formatea press, motion (+32) y release (m)', () => {
    expect(mouseSequence({ button: 0, col: 6, row: 13 })).toBe('\x1b[<0;6;13M');
    expect(mouseSequence({ button: 0, col: 6, row: 13, motion: true })).toBe('\x1b[<32;6;13M');
    expect(mouseSequence({ button: 2, col: 1, row: 1, release: true })).toBe('\x1b[<2;1;1m');
    expect(mouseSequence({ button: 0, col: 2, row: 3, modifiers: 8 })).toBe('\x1b[<8;2;3M');
  });
});

describe('cellAt', () => {
  const rect = { left: 0, top: 0, width: 800, height: 480 };

  it('da la celda 1-based del puntero', () => {
    expect(cellAt(rect, 80, 24, 0, 0)).toEqual({ col: 1, row: 1 });
    expect(cellAt(rect, 80, 24, 50, 240)).toEqual({ col: 6, row: 13 });
  });

  it('recorta a la rejilla', () => {
    expect(cellAt(rect, 80, 24, -10, -10)).toEqual({ col: 1, row: 1 });
    expect(cellAt(rect, 80, 24, 1000, 1000)).toEqual({ col: 80, row: 24 });
  });

  it('no divide por cero si la vista no tiene rejilla', () => {
    expect(cellAt({ left: 0, top: 0, width: 0, height: 0 }, 0, 0, 5, 5)).toEqual({
      col: 0,
      row: 0,
    });
  });
});

describe('modificadores reservados para la GUI', () => {
  it('shift pide selección local', () => {
    expect(wantsLocalSelection({ shiftKey: true })).toBe(true);
    expect(wantsLocalSelection({ shiftKey: false })).toBe(false);
  });

  it('ctrl o cmd es clic de link', () => {
    expect(isLinkClick({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(isLinkClick({ ctrlKey: false, metaKey: true })).toBe(true);
    expect(isLinkClick({ ctrlKey: false, metaKey: false })).toBe(false);
  });
});
