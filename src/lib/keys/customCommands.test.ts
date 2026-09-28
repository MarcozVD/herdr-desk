// T3.8 — Comandos personalizados: parser de [[keys.command]].

import { describe, expect, it } from 'vitest';

import { parseCustomCommands } from './customCommands';

describe('parseCustomCommands', () => {
  it('parsea una entrada completa con comentarios', () => {
    const raw = [
      '[[keys.command]]',
      '# tecla del comando',
      'key = "prefix+alt+g" # comentario final',
      'type = "popup"',
      'command = "lazygit"',
      'width = "80%"',
      'height = "80%"',
    ].join('\n');
    expect(parseCustomCommands(raw)).toEqual([
      {
        key: 'prefix+alt+g',
        type: 'popup',
        command: 'lazygit',
        width: '80%',
        height: '80%',
      },
    ]);
  });

  it('parsea varias entradas y aplica defaults', () => {
    const raw = [
      '[[keys.command]]',
      'key = "prefix+alt+t"',
      'command = "btop"',
      '',
      '[[keys.command]]',
      "key = 'prefix+alt+h'",
      'type = "pane"',
      'command = "htop"',
    ].join('\n');
    const parsed = parseCustomCommands(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe('shell');
    expect(parsed[1]).toMatchObject({ key: 'prefix+alt+h', type: 'pane', command: 'htop' });
  });

  it('ignora entradas sin key o sin command', () => {
    const raw = [
      '[[keys.command]]',
      'type = "shell"',
      'command = "sin-tecla"',
      '',
      '[[keys.command]]',
      'key = "prefix+alt+x"',
    ].join('\n');
    expect(parseCustomCommands(raw)).toEqual([]);
  });

  it('sin tabla devuelve lista vacía', () => {
    expect(parseCustomCommands(null)).toEqual([]);
    expect(parseCustomCommands('')).toEqual([]);
    expect(parseCustomCommands('# solo comentarios')).toEqual([]);
  });
});
