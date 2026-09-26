// T2.2/T2.3 — Piezas puras de las acciones de agente.

import { describe, expect, it } from 'vitest';

import type { AgentInfo } from '../herdr/types';
import {
  AGENT_KEY,
  AGENT_NAME_PATTERN,
  agentAtAttentionIndex,
  agentLabel,
  clampAgentStartTimeout,
  countMatches,
  cycleAgent,
  DEFAULT_AGENT_START_TIMEOUT_MS,
  defaultAgentName,
  prettyJson,
  splitByQuery,
  validAgentStartTimeout,
  validateAgentName,
} from './agentActions';

function agent(paneId: string, status: AgentInfo['agent_status'], name?: string): AgentInfo {
  return {
    pane_id: paneId,
    terminal_id: 'term',
    workspace_id: 'w1',
    tab_id: 'w1:t1',
    focused: false,
    agent_status: status,
    revision: 0,
    name: name ?? null,
  } as AgentInfo;
}

describe('validación del nombre de agente (T2.2)', () => {
  it('acepta el patrón del plan y rechaza lo demás', () => {
    expect(validateAgentName('claude')).toBeNull();
    expect(validateAgentName('hd-bot_2')).toBeNull();
    expect(validateAgentName('a'.repeat(32))).toBeNull();

    expect(validateAgentName('')).toContain('Escribe');
    expect(validateAgentName('1bot')).toContain('minúsculas');
    expect(validateAgentName('Bot')).toContain('minúsculas');
    expect(validateAgentName('bot.uno')).toContain('minúsculas');
    expect(validateAgentName('a'.repeat(33))).toContain('32');
  });

  it('el patrón es el del plan', () => {
    expect(AGENT_NAME_PATTERN.source).toBe('^[a-z][a-z0-9_-]{0,31}$');
  });
});

describe('timeout de arranque (T2.3)', () => {
  it('acota al rango que acepta el backend (3000 < t ≤ 300000)', () => {
    expect(validAgentStartTimeout(DEFAULT_AGENT_START_TIMEOUT_MS)).toBe(true);
    expect(validAgentStartTimeout(3000)).toBe(false);
    expect(validAgentStartTimeout(3001)).toBe(true);
    expect(validAgentStartTimeout(300_000)).toBe(true);
    expect(validAgentStartTimeout(300_001)).toBe(false);
    expect(validAgentStartTimeout(null)).toBe(false);

    expect(clampAgentStartTimeout(1)).toBe(3001);
    expect(clampAgentStartTimeout(999_999)).toBe(300_000);
    expect(clampAgentStartTimeout(null)).toBe(DEFAULT_AGENT_START_TIMEOUT_MS);
  });
});

describe('nombre por defecto (T2.3)', () => {
  it('sale del tipo, saneado y sin chocar con los que ya hay', () => {
    expect(defaultAgentName('claude', [])).toBe('claude');
    expect(defaultAgentName('OpenCode', [])).toBe('opencode');
    expect(defaultAgentName('hd bot!', [])).toBe('hdbot');
    expect(defaultAgentName('claude', ['claude'])).toBe('claude-2');
    expect(defaultAgentName('claude', ['claude', 'claude-2'])).toBe('claude-3');
    // El nombre tiene que ser válido (empezar por letra): si el tipo no lo
    // permite, cae a «agente».
    expect(defaultAgentName('123', [])).toBe('agente');
    expect(defaultAgentName('!!!', [])).toBe('agente');
    // Y lo que devuelve siempre pasa la validación.
    for (const kind of ['claude', 'OpenCode', '123', '!!!', 'hd bot', 'a'.repeat(40)]) {
      expect(validateAgentName(defaultAgentName(kind, []))).toBeNull();
    }
  });
});

describe('búsqueda del visor (T2.2)', () => {
  it('marca las coincidencias y no toca el resto', () => {
    const segments = splitByQuery('hola mundo hola', 'HOLA');
    expect(segments.map((segment) => segment.text).join('')).toBe('hola mundo hola');
    expect(segments.filter((segment) => segment.hit)).toHaveLength(2);
    expect(countMatches('hola mundo hola', 'hola')).toBe(2);
  });

  it('sin consulta devuelve el texto entero y casos borde', () => {
    expect(splitByQuery('texto', '  ')).toEqual([{ text: 'texto', hit: false }]);
    expect(splitByQuery('', 'x')).toEqual([]);
    expect(countMatches('texto', 'zzz')).toBe(0);
    // Coincidencias solapadas: se cuentan las que empiezan tras cada hallazgo.
    expect(countMatches('aaaa', 'aa')).toBe(2);
  });

  it('prettyJson deja el JSON legible y no revienta con ciclos', () => {
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(typeof prettyJson(cyclic)).toBe('string');
  });
});

describe('navegación por la cola de atención (T2.2)', () => {
  const ordered = [
    agent('w1:p1', 'blocked'),
    agent('w1:p2', 'done'),
    agent('w1:p3', 'working', 'hd-bot'),
  ];

  it('focus_agent:N es 1-based y fuera de rango no hace nada', () => {
    expect(agentAtAttentionIndex(ordered, 1)?.pane_id).toBe('w1:p1');
    expect(agentAtAttentionIndex(ordered, 3)?.pane_id).toBe('w1:p3');
    expect(agentAtAttentionIndex(ordered, 0)).toBeNull();
    expect(agentAtAttentionIndex(ordered, 4)).toBeNull();
    expect(agentAtAttentionIndex([], 1)).toBeNull();
  });

  it('next/previous dan la vuelta a la lista', () => {
    expect(cycleAgent(ordered, 'w1:p1', 1)?.pane_id).toBe('w1:p2');
    expect(cycleAgent(ordered, 'w1:p1', -1)?.pane_id).toBe('w1:p3');
    expect(cycleAgent(ordered, 'w1:p3', 1)?.pane_id).toBe('w1:p1');
    // Sin agente enfocado, el siguiente es el primero de la cola.
    expect(cycleAgent(ordered, null, 1)?.pane_id).toBe('w1:p1');
    expect(cycleAgent(ordered, null, -1)?.pane_id).toBe('w1:p3');
    expect(cycleAgent(ordered, 'w9:p9', 1)?.pane_id).toBe('w1:p1');
    expect(cycleAgent([], 'w1:p1', 1)).toBeNull();
  });

  it('las teclas del plan son las canónicas de herdr', () => {
    expect(AGENT_KEY.escape).toBe('esc');
    expect(AGENT_KEY.interrupt).toBe('ctrl+c');
  });

  it('agentLabel prefiere display_agent y cae al nombre, agente o id', () => {
    expect(agentLabel({ ...agent('w1:p1', 'idle'), display_agent: 'Claude' })).toBe('Claude');
    expect(agentLabel(agent('w1:p1', 'idle', 'hd-bot'))).toBe('hd-bot');
    expect(agentLabel({ ...agent('w1:p1', 'idle'), agent: 'opencode' })).toBe('opencode');
    expect(agentLabel(agent('w1:p1', 'idle'))).toBe('w1:p1');
  });
});
