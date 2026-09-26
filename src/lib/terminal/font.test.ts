import { beforeEach, describe, expect, it, vi } from 'vitest';

const guiDefaultsMock = vi.hoisted(() => vi.fn());

// El módulo de fuente habla con el backend por `gui_defaults`; aquí se mockea.
vi.mock('../herdr/client', () => ({ guiDefaults: guiDefaultsMock }));

import {
  currentTerminalFont,
  fontFromGuiDefaults,
  fontStack,
  loadTerminalFont,
  localTerminalFont,
  setTerminalFont,
  subscribeTerminalFont,
  TERMINAL_LINE_HEIGHT,
  terminalOptions,
} from './font';

const STACK_COMPLETA = "'Cascadia Code', 'Cascadia Mono', Consolas, monospace";

beforeEach(() => {
  guiDefaultsMock.mockReset();
  setTerminalFont(localTerminalFont());
});

describe('fontStack', () => {
  it('sin familia devuelve la pila de la terminal de Windows', () => {
    expect(fontStack()).toBe(STACK_COMPLETA);
  });

  it('pone la familia pedida delante y no repite fallbacks', () => {
    expect(fontStack('Consolas')).toBe("Consolas, 'Cascadia Code', 'Cascadia Mono', monospace");
    expect(fontStack('Cascadia Code')).toBe(
      "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    );
  });

  it('acepta una pila ya compuesta y las comillas vienen normalizadas', () => {
    expect(fontStack('"Cascadia Mono", Consolas')).toBe(
      "'Cascadia Mono', Consolas, 'Cascadia Code', monospace",
    );
    expect(fontStack('  ')).toBe(STACK_COMPLETA);
    expect(fontStack(undefined)).toBe(STACK_COMPLETA);
  });

  it('no cita las familias genéricas', () => {
    expect(fontStack('monospace')).toBe("monospace, 'Cascadia Code', 'Cascadia Mono', Consolas");
  });
});

describe('fontFromGuiDefaults', () => {
  it('acepta una cadena suelta como familia', () => {
    const font = fontFromGuiDefaults('Cascadia Mono');
    expect(font?.family).toBe("'Cascadia Mono', 'Cascadia Code', Consolas, monospace");
    expect(font?.source).toBe('backend');
  });

  it('interpreta el payload REAL del backend (`gui_defaults`)', () => {
    // Contrato del backend (src-tauri/src/commands/system.rs::GuiDefaults).
    const real = fontFromGuiDefaults({
      terminal_font_family: 'Cascadia Code',
      terminal_font_size_px: 13,
      terminal_line_height: 1,
    });
    expect(real).toEqual({
      family: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
      size: 13,
      lineHeight: 1,
      source: 'backend',
    });
  });

  it('acepta snake_case y camelCase, con el tamaño y el interlineado', () => {
    const snake = fontFromGuiDefaults({
      terminal_font_family: 'Cascadia Code',
      terminal_font_size_px: 14,
      terminal_line_height: 1.25,
    });
    expect(snake).toMatchObject({ size: 14, lineHeight: 1.25, source: 'backend' });

    const camel = fontFromGuiDefaults({ fontFamily: 'Consolas', fontSize: '15' });
    expect(camel).toMatchObject({
      size: 15,
      family: "Consolas, 'Cascadia Code', 'Cascadia Mono', monospace",
    });
  });

  it('usa el tamaño y el interlineado por defecto si no vienen', () => {
    const font = fontFromGuiDefaults({ terminal_font_family: 'Consolas' });
    expect(font?.size).toBe(localTerminalFont().size);
    expect(font?.lineHeight).toBe(TERMINAL_LINE_HEIGHT);
  });

  it('ignora valores que no tienen sentido y devuelve null si no hay nada', () => {
    expect(fontFromGuiDefaults(null)).toBeNull();
    expect(fontFromGuiDefaults('')).toBeNull();
    expect(fontFromGuiDefaults(42)).toBeNull();
    expect(fontFromGuiDefaults({})).toBeNull();
    expect(fontFromGuiDefaults({ terminal_font_size_px: 0, font_family: '   ' })).toBeNull();
  });
});

describe('loadTerminalFont', () => {
  it('usa la tipografía del backend cuando el command responde', async () => {
    guiDefaultsMock.mockResolvedValue({
      ok: true,
      value: { terminal_font_family: 'Cascadia Code', terminal_font_size: 14 },
    });
    const font = await loadTerminalFont();
    expect(font).toMatchObject({ size: 14, source: 'backend' });
    expect(currentTerminalFont().size).toBe(14);
  });

  it('cae al fallback local si el command todavía no existe', async () => {
    guiDefaultsMock.mockResolvedValue({
      ok: false,
      kind: 'missing',
      error: { code: 'missing_command', message: 'Command gui_defaults not found' },
    });
    const font = await loadTerminalFont();
    expect(font.source).toBe('local');
    expect(font.family).toBe(STACK_COMPLETA);
  });

  it('cae al fallback local si el command falla o revienta', async () => {
    guiDefaultsMock.mockResolvedValue({
      ok: false,
      kind: 'error',
      error: { code: 'unknown', message: 'boom' },
    });
    expect((await loadTerminalFont()).source).toBe('local');

    guiDefaultsMock.mockRejectedValue(new Error('sin puente IPC'));
    expect((await loadTerminalFont()).source).toBe('local');
  });

  it('avisa a quien esté aplicando la fuente a instancias vivas', async () => {
    const vistos: string[] = [];
    const stop = subscribeTerminalFont((font) => vistos.push(font.source));
    guiDefaultsMock.mockResolvedValue({ ok: true, value: 'Consolas' });
    await loadTerminalFont();
    stop();
    expect(vistos).toEqual(['backend']);
  });
});

describe('terminalOptions', () => {
  it('deriva familia, tamaño e interlineado del mismo preset', () => {
    const options = terminalOptions({
      family: "'Cascadia Code', monospace",
      size: 14,
      lineHeight: 1.3,
      source: 'backend',
    });
    expect(options).toEqual({
      fontFamily: "'Cascadia Code', monospace",
      fontSize: 14,
      lineHeight: 1.3,
    });
  });

  it('por defecto usa el preset vigente (nunca `var(--font-mono)`)', () => {
    const options = terminalOptions();
    expect(options.fontFamily).toBe(STACK_COMPLETA);
    expect(options.fontFamily).not.toContain('var(');
    expect(options.fontSize).toBe(localTerminalFont().size);
  });
});
