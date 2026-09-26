// T2.4 — Estado visual: glow por estado en el marco, rollups en sidebar y tabs,
// y el conteo de bloqueados al overlay del icono de la barra de tareas.

import { expect, test } from '@playwright/test';

import { bootApp, readLayoutFixture, readSnapshotFixture, recordedCalls } from './harness';

interface TestSnapshot {
  panes: Array<Record<string, unknown>>;
  workspaces: Array<Record<string, unknown>>;
  tabs: Array<Record<string, unknown>>;
  agents: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

const FIXTURE = readSnapshotFixture() as TestSnapshot;

/**
 * El snapshot del fixture con TODOS los agentes en el estado pedido (y los
 * rollups del backend a juego): así el conteo de bloqueados es determinista.
 */
function withStatus(status: string): TestSnapshot {
  return {
    ...FIXTURE,
    panes: FIXTURE.panes.map((pane) => ({ ...pane, agent_status: status })),
    agents: FIXTURE.agents.map((agent) => ({ ...agent, agent_status: status })),
    workspaces: FIXTURE.workspaces.map((workspace) => ({ ...workspace, agent_status: status })),
    tabs: FIXTURE.tabs.map((tab) => ({ ...tab, agent_status: status })),
  };
}

/** Un snapshot con w1 trabajando (0 bloqueados) y w2 bloqueado (1 bloqueado). */
function mixed(): TestSnapshot {
  const working = withStatus('working');
  return {
    ...working,
    agents: working.agents.map((agent) =>
      agent.workspace_id === 'w2' ? { ...agent, agent_status: 'blocked' } : agent,
    ),
    workspaces: working.workspaces.map((workspace) =>
      workspace.workspace_id === 'w2' ? { ...workspace, agent_status: 'blocked' } : workspace,
    ),
  };
}

async function push(page: import('@playwright/test').Page, snapshot: unknown): Promise<void> {
  await page.evaluate((value) => window.__HD_TEST__?.pushSnapshot(value), snapshot);
}

/** Estado del glow calculado del marco de un pane. */
async function glowOf(page: import('@playwright/test').Page, paneId: string) {
  return page.evaluate((id) => {
    const frame = document.querySelector(`[data-testid="pane-frame"][data-pane-id="${id}"]`);
    if (!frame) return null;
    const after = getComputedStyle(frame, '::after');
    return {
      status: frame.getAttribute('data-status'),
      opacity: Number(after.opacity),
      shadow: after.boxShadow,
      color: getComputedStyle(frame).getPropertyValue('--pane-glow').trim(),
    };
  }, paneId);
}

test('el glow del marco sigue el estado del pane y se apaga en unknown', async ({ page }) => {
  await bootApp(page, { snapshot: withStatus('working'), layoutTree: readLayoutFixture() });

  const working = await glowOf(page, 'w1:p1');
  expect(working?.status).toBe('working');
  expect(working?.opacity).toBeGreaterThan(0);
  // El color computado de un `color-mix(in oklab, …)` sale como `oklab(…)`.
  expect(working?.shadow).toMatch(/oklab|rgb|color\(/);
  // El segundo pane del árbol también tiene agente en el fixture: brilla igual.
  expect((await glowOf(page, 'w1:p2'))?.opacity).toBeGreaterThan(0);

  // blocked: cambia el token y el glow sigue encendido.
  await push(page, withStatus('blocked'));
  await expect.poll(async () => (await glowOf(page, 'w1:p1'))?.status).toBe('blocked');
  const blocked = await glowOf(page, 'w1:p1');
  expect(blocked?.opacity).toBeGreaterThan(0);
  expect(blocked?.color).not.toBe(working?.color);
  expect(blocked?.shadow).not.toBe(working?.shadow);

  // done: otro token más.
  await push(page, withStatus('done'));
  await expect.poll(async () => (await glowOf(page, 'w1:p1'))?.color).not.toBe(blocked?.color);

  // unknown: el marco deja de brillar (es el estado de un panel sin agente).
  await push(page, withStatus('unknown'));
  await expect.poll(async () => (await glowOf(page, 'w1:p1'))?.status).toBe('unknown');
  await expect.poll(async () => (await glowOf(page, 'w1:p1'))?.opacity).toBe(0);
  await expect.poll(async () => (await glowOf(page, 'w1:p2'))?.opacity).toBe(0);
  // Y el token queda sin color (transparent por defecto).
  expect((await glowOf(page, 'w1:p1'))?.color).toBe('');
});

test('la sidebar y las tabs llevan el rollup con el conteo de bloqueados', async ({ page }) => {
  await bootApp(page, { snapshot: mixed(), layoutTree: readLayoutFixture() });

  const spaceRow = page.locator('[data-testid="workspace-row"][data-workspace-id="w2"]');
  await expect(spaceRow.getByTestId('status-rollup')).toHaveAttribute('data-status', 'blocked');
  await expect(spaceRow.getByTestId('status-rollup')).toHaveAttribute('data-blocked', '1');
  await expect(spaceRow.getByTestId('rollup-blocked')).toHaveText('1');

  // w1 no tiene bloqueados: punto sí, conteo no.
  const cleanRow = page.locator('[data-testid="workspace-row"][data-workspace-id="w1"]');
  await expect(cleanRow.getByTestId('status-rollup')).toHaveAttribute('data-status', 'working');
  await expect(cleanRow.getByTestId('rollup-blocked')).toHaveCount(0);

  // La tab bar pinta las pestañas del espacio enfocado: con w1 bloqueado, su
  // pestaña lleva el conteo.
  const tab = page.locator('[data-testid="tab"][data-tab-id="w1:t1"]');
  await push(page, withStatus('blocked'));
  await expect(tab.getByTestId('status-rollup')).toHaveAttribute('data-blocked', '1');
  await expect(tab.getByTestId('rollup-blocked')).toHaveText('1');

  // Al resolverse, desaparece el conteo (el punto sigue).
  await push(page, withStatus('working'));
  await expect(tab.getByTestId('rollup-blocked')).toHaveCount(0);
  await expect(spaceRow.getByTestId('rollup-blocked')).toHaveCount(0);
  await expect(spaceRow.getByTestId('status-rollup')).toHaveAttribute('data-status', 'working');
});

test('el conteo de bloqueados llega al overlay del icono de la barra de tareas', async ({
  page,
}) => {
  await bootApp(page, { snapshot: withStatus('working'), layoutTree: readLayoutFixture() });
  // Sin bloqueados el primer envío es `null` (quita el overlay).
  await expect.poll(async () => (await recordedCalls(page, 'taskbar_overlay')).length).toBe(1);
  expect((await recordedCalls(page, 'taskbar_overlay'))[0]).toMatchObject({ count: null });

  await push(page, withStatus('blocked'));
  await expect.poll(async () => (await recordedCalls(page, 'taskbar_overlay')).length).toBe(2);
  // Los dos agentes del fixture están bloqueados.
  expect((await recordedCalls(page, 'taskbar_overlay'))[1]).toMatchObject({ count: 2 });

  // Un refresco con el MISMO número no vuelve a llamar (cero IPC por snapshot).
  await push(page, withStatus('blocked'));
  await page.waitForTimeout(200);
  expect((await recordedCalls(page, 'taskbar_overlay')).length).toBe(2);

  // Y al resolverse (done) se quita el overlay.
  await push(page, withStatus('done'));
  await expect.poll(async () => (await recordedCalls(page, 'taskbar_overlay')).length).toBe(3);
  expect((await recordedCalls(page, 'taskbar_overlay'))[2]).toMatchObject({ count: null });
});
