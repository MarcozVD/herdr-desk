// @vitest-environment jsdom
// T2.2/T2.3 — Las acciones de agente, con el cliente RPC mockeado: fija los
// PARÁMETROS exactos que salen hacia herdr y el manejo de errores (un aviso en
// español, sin romper la UI). El `target` de las acciones de agente es el id
// del panel (comprobado contra el servidor).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

interface RecordedCall {
  method: string;
  params: unknown;
}

const calls: RecordedCall[] = [];
const errors: Record<string, unknown> = {};
const replies: Record<string, unknown> = {};

vi.mock('../herdr/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../herdr/client')>();
  return {
    ...actual,
    call: vi.fn(async (method: string, params: unknown) => {
      calls.push({ method, params });
      if (method in errors) throw errors[method];
      if (method in replies) return replies[method];
      return { type: 'ok' };
    }),
    storeSubscribe: vi.fn(async () => undefined),
    sessionCurrent: vi.fn(async () => ({ ok: true, value: 'herdr-desk-dev' })),
  };
});

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

import type { AgentInfo, SessionSnapshot } from '../herdr/types';
import { flows } from './flows';
import { es } from '../i18n/es';
import { session } from '../stores/session.svelte';
import { settings } from '../stores/settings.svelte';
import { ui } from '../stores/ui.svelte';

beforeAll(() => {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
});

function agentInfo(paneId: string, status: AgentInfo['agent_status'], name?: string): AgentInfo {
  return {
    pane_id: paneId,
    terminal_id: `term_${paneId}`,
    workspace_id: 'w1',
    tab_id: 'w1:t1',
    focused: false,
    agent_status: status,
    revision: 0,
    agent: 'opencode',
    name: name ?? null,
  } as unknown as AgentInfo;
}

function snapshot(agents: AgentInfo[]): SessionSnapshot {
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
        label: 'uno',
        focused: true,
        pane_count: 3,
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
        pane_count: 3,
        agent_status: 'unknown',
      },
    ],
    panes: ['w1:p1', 'w1:p2', 'w1:p3'].map((paneId) => ({
      pane_id: paneId,
      terminal_id: `term_${paneId}`,
      workspace_id: 'w1',
      tab_id: 'w1:t1',
      focused: paneId === 'w1:p1',
      agent_status: 'unknown',
      revision: 0,
    })),
    agents,
    layouts: [],
  } as unknown as SessionSnapshot;
}

function lastCall(method: string): RecordedCall | undefined {
  return [...calls].reverse().find((entry) => entry.method === method);
}

beforeEach(() => {
  calls.length = 0;
  for (const key of Object.keys(errors)) delete errors[key];
  for (const key of Object.keys(replies)) delete replies[key];
  session.applySnapshot(
    snapshot([
      agentInfo('w1:p1', 'blocked', 'hd-bot'),
      agentInfo('w1:p2', 'done'),
      agentInfo('w1:p3', 'working'),
    ]),
  );
});

afterEach(() => {
  session.reset();
  ui.resetSessionState();
});

describe('enfocar agente (T2.2)', () => {
  it('marca el agente como visto y enfoca su panel', async () => {
    flows.focusAgent('w1:p2');
    await vi.waitFor(() => expect(lastCall('agent.focus')).toBeDefined());
    expect(lastCall('agent.focus')?.params).toEqual({ target: 'w1:p2' });
    expect(ui.localFocusedPaneId).toBe('w1:p2');
  });

  it('los atajos van por la cola de atención', async () => {
    // La cola de atención ordena blocked > done > working.
    expect(session.agentsByPriority.map((agent) => agent.pane_id)).toEqual([
      'w1:p1',
      'w1:p2',
      'w1:p3',
    ]);

    // El panel enfocado del snapshot es w1:p1 (el primero de la cola): el
    // siguiente en la cola de atención es w1:p2.
    flows.nextAgent(1);
    await vi.waitFor(() => expect(lastCall('agent.focus')).toBeDefined());
    expect(lastCall('agent.focus')?.params).toEqual({ target: 'w1:p2' });

    calls.length = 0;
    flows.nextAgent(-1);
    await vi.waitFor(() => expect(lastCall('agent.focus')).toBeDefined());
    expect(lastCall('agent.focus')?.params).toEqual({ target: 'w1:p1' });

    calls.length = 0;
    flows.focusAgentNumber(3);
    await vi.waitFor(() => expect(lastCall('agent.focus')).toBeDefined());
    expect(lastCall('agent.focus')?.params).toEqual({ target: 'w1:p3' });
  });

  it('un fallo de agent.focus se cuenta solo cuando hay sincronía con la TUI', async () => {
    errors['agent.focus'] = { code: 'not_found', message: 'pane w1:p2 not found' };
    // Sin sincronía (por defecto) el foco de la TUI no se toca: el fallo se calla.
    flows.focusAgent('w1:p2');
    await vi.waitFor(() => expect(lastCall('agent.focus')).toBeDefined());
    expect(ui.toasts.some((toast) => toast.text === es.errors.not_found)).toBe(false);

    calls.length = 0;
    settings.values.sync_focus_with_tui = true;
    try {
      flows.focusAgent('w1:p2');
      // El aviso sale en el microtask del rechazo: se espera a que llegue.
      await vi.waitFor(() =>
        expect(ui.toasts.some((toast) => toast.text === es.errors.not_found)).toBe(true),
      );
    } finally {
      settings.values.sync_focus_with_tui = false;
    }
  });
});

describe('prompt al agente (T2.2)', () => {
  it('manda texto y la espera opcional con los parámetros exactos', async () => {
    const sent = await flows.promptAgent('w1:p1', '  arregla el test  ', {
      until: ['done'],
      timeout_ms: 30_000,
    });
    expect(sent).toBe(true);
    expect(lastCall('agent.prompt')?.params).toEqual({
      target: 'w1:p1',
      text: 'arregla el test',
      wait: { until: ['done'], timeout_ms: 30_000 },
    });
  });

  it('sin espera manda `wait: null` y con texto vacío no llama', async () => {
    await flows.promptAgent('w1:p1', 'hola');
    expect(lastCall('agent.prompt')?.params).toEqual({
      target: 'w1:p1',
      text: 'hola',
      wait: null,
    });

    calls.length = 0;
    expect(await flows.promptAgent('w1:p1', '   ')).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('los errores del backend salen en español y no revientan', async () => {
    errors['agent.prompt'] = { code: 'agent_blocked', message: 'agent is blocked' };
    expect(await flows.promptAgent('w1:p1', 'hola')).toBe(false);
    expect(ui.toasts.at(-1)?.text).toBe(es.errors.agent_blocked);

    errors['agent.prompt'] = { code: 'agent_prompt_stalled', message: 'no reaction' };
    expect(await flows.promptAgent('w1:p1', 'hola')).toBe(false);
    expect(ui.toasts.at(-1)?.text).toBe(es.errors.agent_prompt_stalled);

    errors['agent.prompt'] = { code: 'agent_not_ready', message: 'not an active agent' };
    expect(await flows.promptAgent('w1:p1', 'hola')).toBe(false);
    expect(ui.toasts.at(-1)?.text).toBe(es.errors.agent_not_ready);
  });
});

describe('teclas al agente (T2.2)', () => {
  it('Escape y Ctrl+C van con el nombre canónico de herdr', async () => {
    await flows.sendAgentKey('w1:p3', 'esc');
    expect(lastCall('agent.send_keys')?.params).toEqual({ target: 'w1:p3', keys: ['esc'] });

    await flows.sendAgentKey('w1:p3', 'ctrl+c');
    expect(lastCall('agent.send_keys')?.params).toEqual({ target: 'w1:p3', keys: ['ctrl+c'] });
  });
});

describe('renombrar (T2.2)', () => {
  it('valida el nombre y renombra', async () => {
    const pending = flows.renameAgent('w1:p1');
    await vi.waitFor(() => expect(ui.pendingPrompt).not.toBeNull());
    // El nombre actual viene precargado.
    expect(ui.pendingPrompt?.value).toBe('hd-bot');
    expect(ui.pendingPrompt?.validate?.('MAL') ?? null).not.toBeNull();
    ui.resolvePrompt('nuevo-nombre');
    await pending;
    expect(lastCall('agent.rename')?.params).toEqual({
      target: 'w1:p1',
      name: 'nuevo-nombre',
    });
  });

  it('vacío quita el nombre; cancelar no llama a nadie', async () => {
    const pending = flows.renameAgent('w1:p1');
    await vi.waitFor(() => expect(ui.pendingPrompt).not.toBeNull());
    ui.resolvePrompt('  ');
    await pending;
    expect(lastCall('agent.rename')?.params).toEqual({ target: 'w1:p1', name: null });

    calls.length = 0;
    const cancelled = flows.renameAgent('w1:p1');
    await vi.waitFor(() => expect(ui.pendingPrompt).not.toBeNull());
    ui.resolvePrompt(null);
    await cancelled;
    expect(calls).toHaveLength(0);
  });
});

describe('transcript y explain en el visor (T2.2)', () => {
  it('pide 200 líneas recent_unwrapped y abre el visor', async () => {
    replies['agent.read'] = {
      type: 'pane_read',
      read: { pane_id: 'w1:p1', text: 'linea uno\nlinea dos' },
    };
    await flows.showAgentTranscript('w1:p1');
    expect(lastCall('agent.read')?.params).toEqual({
      target: 'w1:p1',
      source: 'recent_unwrapped',
      lines: 200,
      format: 'text',
      strip_ansi: true,
    });
    expect(ui.viewer?.text).toContain('linea dos');
    expect(ui.viewer?.kind).toBe('text');
    expect(ui.viewer?.title).toContain('hd-bot');
  });

  it('explain abre el visor como JSON legible', async () => {
    replies['agent.explain'] = { type: 'agent_explain', explain: { matched_rule: 'opencode' } };
    await flows.explainAgent('w1:p1');
    expect(lastCall('agent.explain')?.params).toEqual({ target: 'w1:p1' });
    expect(ui.viewer?.kind).toBe('json');
    expect(ui.viewer?.text).toContain('"matched_rule": "opencode"');
  });

  it('un fallo del transcript deja el visor cerrado y avisa', async () => {
    errors['agent.read'] = { code: 'not_found', message: 'pane gone' };
    await flows.showAgentTranscript('w1:p1');
    expect(ui.viewer).toBeNull();
    expect(ui.toasts.at(-1)?.text).toBe(es.errors.not_found);
  });
});

describe('esperar a un estado (T2.2)', () => {
  it('espera con el timeout por defecto y avisa al llegar', async () => {
    replies['agent.wait'] = { type: 'agent_info', agent: agentInfo('w1:p1', 'idle') };
    await flows.waitAgent('w1:p1', 'idle');
    expect(lastCall('agent.wait')?.params).toEqual({
      target: 'w1:p1',
      until: ['idle'],
      timeout_ms: 30_000,
    });
    expect(ui.toasts.at(-1)?.text).toContain('hd-bot');
  });

  it('el timeout del servidor se cuenta en español', async () => {
    errors['agent.wait'] = { code: 'timeout', message: 'timed out waiting for agent status' };
    await flows.waitAgent('w1:p1', 'idle');
    expect(ui.toasts.at(-1)?.text).toContain('no respondió a tiempo');
  });
});

describe('soltar agente (T2.2)', () => {
  it('pide confirmación y suelta con la fuente de la GUI', async () => {
    const pending = flows.releaseAgent('w1:p1');
    await vi.waitFor(() => expect(ui.pendingConfirm).not.toBeNull());
    ui.resolveConfirm(true);
    await pending;
    expect(lastCall('pane.release_agent')?.params).toEqual({
      pane_id: 'w1:p1',
      source: 'custom:herdr-desk',
      agent: 'opencode',
    });
    expect(ui.toasts.at(-1)?.text).toContain('hd-bot');
  });

  it('si el usuario cancela no se llama', async () => {
    const pending = flows.releaseAgent('w1:p1');
    await vi.waitFor(() => expect(ui.pendingConfirm).not.toBeNull());
    ui.resolveConfirm(false);
    await pending;
    expect(calls).toHaveLength(0);
  });
});

describe('arrancar agente (T2.3)', () => {
  it('arranca con el timeout acotado y lo reporta con la fuente de la GUI', async () => {
    replies['agent.start'] = {
      type: 'agent_started',
      agent: agentInfo('w1:p3', 'working'),
      argv: ['opencode', '--flag'],
    };
    const started = await flows.startAgent('w1:p3', {
      kind: 'opencode',
      name: 'hd-nuevo',
      args: ['--flag'],
      timeoutMs: 1,
    });
    expect(started).toBe(true);
    expect(lastCall('agent.start')?.params).toEqual({
      pane_id: 'w1:p3',
      kind: 'opencode',
      name: 'hd-nuevo',
      args: ['--flag'],
      timeout_ms: 3001,
    });
    expect(lastCall('pane.report_agent')?.params).toEqual({
      pane_id: 'w1:p3',
      source: 'custom:herdr-desk',
      agent: 'opencode',
      state: 'working',
    });
    expect(lastCall('agent.focus')?.params).toEqual({ target: 'w1:p3' });
  });

  it('con un nombre inválido no llama al backend', async () => {
    expect(
      await flows.startAgent('w1:p3', { kind: 'opencode', name: 'MAL', args: [], timeoutMs: null }),
    ).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('un fallo de arranque se cuenta y no reporta nada', async () => {
    errors['agent.start'] = { code: 'cli_failed', message: 'kind desconocido' };
    expect(
      await flows.startAgent('w1:p3', {
        kind: 'opencode',
        name: 'hd-nuevo',
        args: [],
        timeoutMs: null,
      }),
    ).toBe(false);
    expect(lastCall('pane.report_agent')).toBeUndefined();
    expect(ui.toasts.at(-1)?.text).toContain('CLI de herdr');
  });
});

describe('menú del panel de agentes (T2.2)', () => {
  it('ofrece todas las acciones del plan', () => {
    flows.openAgentMenu(
      { preventDefault: () => {}, stopPropagation: () => {}, clientX: 10, clientY: 20 } as never,
      'w1:p1',
    );
    const ids = ui.contextMenu?.items.map((item) => item.id) ?? [];
    expect(ids).toEqual([
      'agent-focus',
      'agent-prompt',
      'agent-escape',
      'agent-interrupt',
      'agent-rename',
      'agent-transcript',
      'agent-wait-idle',
      'agent-wait-done',
      'agent-explain',
      'agent-release',
    ]);
    ui.closeContextMenu();
  });
});
