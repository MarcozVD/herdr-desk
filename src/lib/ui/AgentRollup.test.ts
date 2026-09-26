// @vitest-environment jsdom
// T2.4 — Rollup de estado (punto + conteo de bloqueados) en filas de lista.

import { flushSync, mount, unmount } from 'svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import AgentRollup from './AgentRollup.svelte';
import type { AgentInfo } from '../herdr/types';

function agent(status: AgentInfo['agent_status'], paneId = 'w1:p1'): AgentInfo {
  return {
    pane_id: paneId,
    terminal_id: 'term',
    workspace_id: 'w1',
    tab_id: 'w1:t1',
    focused: false,
    agent_status: status,
    revision: 0,
  } as AgentInfo;
}

let instance: Record<string, unknown> | null = null;
let target: HTMLElement | null = null;

function mountRollup(props: { agents: AgentInfo[]; status?: AgentInfo['agent_status'] | null }) {
  target = document.createElement('div');
  document.body.append(target);
  instance = mount(AgentRollup, { target, props }) as Record<string, unknown>;
  flushSync();
  return document.querySelector<HTMLElement>('[data-testid="status-rollup"]');
}

afterEach(() => {
  if (instance) unmount(instance);
  instance = null;
  target?.remove();
  target = null;
});

describe('rollup de estado (T2.4)', () => {
  it('pinta el punto con el estado del backend y el conteo de bloqueados', () => {
    const rollup = mountRollup({
      agents: [agent('blocked'), agent('blocked', 'w1:p2'), agent('working', 'w1:p3')],
      status: 'blocked',
    });

    expect(rollup?.dataset.status).toBe('blocked');
    expect(rollup?.dataset.blocked).toBe('2');
    expect(rollup?.querySelector('.agent-dot')?.getAttribute('data-state')).toBe('blocked');
    expect(rollup?.querySelector('[data-testid="rollup-blocked"]')?.textContent).toBe('2');
  });

  it('calcula el estado si el backend no lo da (el peor manda)', () => {
    const rollup = mountRollup({ agents: [agent('working'), agent('done', 'w1:p2')] });
    expect(rollup?.dataset.status).toBe('done');
    // El punto sigue el estado del contenedor, no el conteo.
    expect(rollup?.querySelector('.agent-dot')?.getAttribute('data-state')).toBe('done');
  });

  it('sin bloqueados no hay chip y sin agentes el rollup es unknown', () => {
    const withAgents = mountRollup({ agents: [agent('working')] });
    expect(withAgents?.querySelector('[data-testid="rollup-blocked"]')).toBeNull();

    if (instance) unmount(instance);
    instance = null;
    const empty = mountRollup({ agents: [] });
    expect(empty?.dataset.status).toBe('unknown');
    expect(empty?.dataset.blocked).toBe('0');
  });

  it('es una fila de lista: sin backdrop-filter', () => {
    // Se miran solo los estilos: el comentario del componente nombra justo la
    // regla que este test prohíbe.
    const source = readFileSync(resolve(process.cwd(), 'src/lib/ui/AgentRollup.svelte'), 'utf-8');
    const style = source
      .slice(source.indexOf('<style>'), source.lastIndexOf('</style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(style).not.toContain('backdrop-filter');
    expect(style).not.toContain('glass');
  });
});
