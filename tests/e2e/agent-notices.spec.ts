// T2.5 — Avisos de agente en toasts: respetan la preferencia, agrupan ráfagas,
// no avisan de lo que el usuario está mirando y no se solapan con el contador
// del overlay de la barra de tareas.

import { expect, test } from '@playwright/test';

import { bootApp, readSnapshotFixture, recordedCalls } from './harness';

interface TestSnapshot {
  panes: Array<Record<string, unknown>>;
  workspaces: Array<Record<string, unknown>>;
  tabs: Array<Record<string, unknown>>;
  agents: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

const FIXTURE = readSnapshotFixture() as TestSnapshot;

/** Snapshot del fixture con los agentes en el estado pedido por panel. */
function withStates(states: Record<string, string>): TestSnapshot {
  return {
    ...FIXTURE,
    panes: FIXTURE.panes.map((pane) => ({
      ...pane,
      agent_status: states[String(pane.pane_id)] ?? pane.agent_status,
    })),
    agents: FIXTURE.agents.map((agent) => ({
      ...agent,
      agent_status: states[String(agent.pane_id)] ?? agent.agent_status,
    })),
  };
}

/**
 * Snapshot con los agentes de `states` (y solo esos): los de `w1` están en el
 * panel enfocado y los de otros espacios, fuera de la vista del usuario.
 */
function noticeSnapshot(states: Record<string, string>): TestSnapshot {
  return {
    ...FIXTURE,
    agents: Object.entries(states).map(([paneId, status], index) => ({
      pane_id: paneId,
      terminal_id: `term_${paneId}`,
      agent: 'hd-bot',
      agent_status: status,
      workspace_id: paneId.split(':')[0],
      tab_id: `${paneId.split(':')[0]}:t1`,
      focused: paneId === 'w1:p1',
      state_change_seq: index + 1,
      revision: 0,
    })),
  };
}

async function push(page: import('@playwright/test').Page, snapshot: TestSnapshot): Promise<void> {
  await page.evaluate((value) => window.__HD_TEST__?.pushSnapshot(value), snapshot);
}

/** Enciende la campana del panel de agentes (preferencia del usuario). */
async function enableNotices(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('agent-panel-bell').click();
  await expect(page.getByTestId('agent-panel-bell')).toHaveAttribute('data-on', 'true');
}

test('con la preferencia apagada (por defecto) no hay toasts de agente', async ({ page }) => {
  await bootApp(page);
  await expect(page.getByTestId('agent-panel-bell')).toHaveAttribute('data-on', 'false');

  // w2:p1 (el bloqueado del fixture) pasa a terminado: no avisa nadie.
  await push(page, withStates({ 'w2:p1': 'done' }));
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('con los avisos activados, un agente que termina avisa', async ({ page }) => {
  await bootApp(page);
  await enableNotices(page);

  // w1:p1 está enfocado (la ventana tiene el foco): no avisa.
  await push(page, withStates({ 'w1:p1': 'done', 'w2:p1': 'blocked' }));
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('toast')).toHaveCount(0);

  // w2:p1 no está a la vista: avisa.
  await push(page, withStates({ 'w1:p1': 'done', 'w2:p1': 'done' }));
  await expect(page.getByTestId('toast')).toHaveCount(1);
  await expect(page.getByTestId('toast')).toContainText('terminó');
});

test('una ráfaga sale en un solo toast agrupado', async ({ page }) => {
  await bootApp(page);
  // Fuera de la vista: w1:p1 está enfocado, w2:p1 y w3:p1 no.
  await push(page, noticeSnapshot({ 'w1:p1': 'working', 'w2:p1': 'working', 'w3:p1': 'working' }));
  await enableNotices(page);

  // Los dos de fuera se bloquean en refrescos seguidos (una ráfaga).
  await push(page, noticeSnapshot({ 'w1:p1': 'working', 'w2:p1': 'blocked', 'w3:p1': 'working' }));
  await push(page, noticeSnapshot({ 'w1:p1': 'working', 'w2:p1': 'blocked', 'w3:p1': 'blocked' }));

  await expect(page.getByTestId('toast')).toHaveCount(1);
  // El texto del toast incluye el botón de cerrar «×».
  await expect(page.getByTestId('toast')).toContainText('2 agentes están esperando tu respuesta.');
});

test('el overlay lleva el conteo y el toast el detalle (sin solaparse)', async ({ page }) => {
  await bootApp(page);
  await push(page, noticeSnapshot({ 'w1:p1': 'working', 'w2:p1': 'working', 'w3:p1': 'working' }));
  await enableNotices(page);

  // w2:p1 se bloquea y w3:p1 termina.
  await push(page, noticeSnapshot({ 'w1:p1': 'working', 'w2:p1': 'blocked', 'w3:p1': 'done' }));

  // El overlay recibe solo el número de bloqueados…
  await expect
    .poll(async () => (await recordedCalls(page, 'taskbar_overlay')).map((call) => call.count))
    .toContain(1);
  // …y los toasts dicen quién y qué: dos avisos distintos, no repetidos.
  await expect(page.getByTestId('toast')).toHaveCount(2);
  await expect(page.getByTestId('toast').first()).toContainText(
    '«hd-bot» está esperando tu respuesta.',
  );
  await expect(page.getByTestId('toast').nth(1)).toContainText('«hd-bot» terminó.');
});

test('la campana recuerda la preferencia entre arranques', async ({ page }) => {
  await bootApp(page);
  await enableNotices(page);
  // T3.5: la preferencia se persiste en config.toml (config_write).
  await expect
    .poll(async () =>
      (await recordedCalls(page, 'config_write')).some((call) =>
        JSON.stringify(call).includes('ui.toast.delivery'),
      ),
    )
    .toBe(true);

  // Al recargar, la preferencia sigue puesta.
  await page.reload();
  await page.waitForSelector('[data-testid="titlebar"]');
  await expect(page.getByTestId('agent-panel-bell')).toHaveAttribute('data-on', 'true');
});
