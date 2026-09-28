// T2.1 — Panel de agentes: orden (spaces/priority), filtro, filas de la config y
// tokens. El snapshot del fixture tiene 2 agentes: w1:p1 (working, «hd-bot») y
// w2:p1 (blocked, «hd-bot»).

import { expect, test } from '@playwright/test';

import { bootApp, readSnapshotFixture, recordedCalls } from './harness';

/** Empuja un snapshot por el canal del store del arnés. */
async function push(page: import('@playwright/test').Page, snapshot: unknown): Promise<void> {
  await page.evaluate((value) => window.__HD_TEST__?.pushSnapshot(value), snapshot);
}

test('el panel agrupa por espacio y ordena por prioridad dentro del grupo', async ({ page }) => {
  await bootApp(page);

  await expect(page.getByTestId('agent-panel')).toHaveAttribute('data-sort', 'spaces');
  await expect(page.getByTestId('agent-section')).toHaveCount(2);
  await expect(page.getByTestId('agent-section').nth(0)).toHaveAttribute('data-workspace-id', 'w1');
  await expect(page.getByTestId('agent-section-title').nth(0)).toContainText('spike');
  await expect(page.getByTestId('agent-section').nth(1)).toHaveAttribute('data-workspace-id', 'w2');

  // Filas por defecto de la config: [estado, espacio, pestaña] + [agente].
  const first = page.getByTestId('agent-row').nth(0);
  await expect(first.locator('[data-token="workspace"]')).toContainText('spike');
  await expect(first.locator('[data-token="tab"]')).toContainText('1');
  await expect(first.locator('[data-token="agent"]')).toContainText('hd-bot');
  await expect(first.locator('.agent-dot')).toHaveCount(1);
});

test('el botón de orden pasa a la cola de prioridad y lo persiste', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('agent-panel-sort').click();

  await expect(page.getByTestId('agent-panel')).toHaveAttribute('data-sort', 'priority');
  // Una sola sección (cola de atención) y blocked primero.
  await expect(page.getByTestId('agent-section')).toHaveCount(1);
  await expect(page.getByTestId('agent-row').nth(0)).toHaveAttribute('data-status', 'blocked');
  await expect(page.getByTestId('agent-row').nth(1)).toHaveAttribute('data-status', 'working');

  // Queda guardado en config.toml (T3.5) y al recargar sigue en priority.
  expect(await recordedCalls(page, 'config_write')).toContainEqual({
    changes: [{ path: 'ui.agent_panel_sort', value: '"priority"' }],
  });
  await page.reload();
  await expect(page.getByTestId('agent-panel')).toHaveAttribute('data-sort', 'priority');
});

test('el filtro deja solo los agentes que coinciden y avisa si no hay ninguno', async ({
  page,
}) => {
  await bootApp(page);
  await expect(page.getByTestId('agent-row')).toHaveCount(2);

  await page.getByTestId('agent-panel-filter').fill('docs');
  await expect(page.getByTestId('agent-row')).toHaveCount(1);
  await expect(page.getByTestId('agent-section')).toHaveCount(1);
  await expect(page.getByTestId('agent-section')).toHaveAttribute('data-workspace-id', 'w2');

  await page.getByTestId('agent-panel-filter').fill('no-existe-este-agente');
  await expect(page.getByTestId('agent-row')).toHaveCount(0);
  await expect(page.getByTestId('agents-empty')).toContainText('coincide');

  await page.getByTestId('agent-panel-filter').fill('');
  await expect(page.getByTestId('agent-row')).toHaveCount(2);
});

test('el chip de bloqueados cuenta los agentes en blocked', async ({ page }) => {
  await bootApp(page);
  await expect(page.getByTestId('agents-blocked')).toContainText('1');

  // Dos blocked: el chip y el contador suben.
  const fixture = readSnapshotFixture() as {
    agents: Array<Record<string, unknown>>;
  };
  await push(page, {
    ...fixture,
    agents: [
      ...fixture.agents,
      { ...fixture.agents[0], pane_id: 'w1:p3', agent_status: 'blocked' },
    ],
  });

  await expect(page.getByTestId('agents-blocked')).toContainText('2');

  // Sin bloqueados el chip desaparece.
  await push(page, {
    ...fixture,
    agents: fixture.agents.map((agent) => ({ ...agent, agent_status: 'working' })),
  });
  await expect(page.getByTestId('agents-blocked')).toHaveCount(0);
});

test('las filas salen de `[ui.sidebar.agents]`: rows, rows_by_agent y el token $name', async ({
  page,
}) => {
  const fixture = readSnapshotFixture() as { agents: Array<Record<string, unknown>> };
  await bootApp(page, {
    configEntries: {
      'ui.sidebar.agents.rows': '[["state_icon", "agent", "$jj_status"]]',
      'ui.sidebar.agents.rows_by_agent':
        '{ "hd-bot" = [["state_icon"], ["terminal_title_stripped"]] }',
      'ui.sidebar.agents.row_gap': '1',
    },
    snapshot: {
      ...fixture,
      agents: fixture.agents.map((agent) => ({
        ...agent,
        terminal_title_stripped: 'hd-bot en docs',
        tokens: { jj_status: 'rebase' },
      })),
    } as never,
  });

  // rows_by_agent manda: el agente canónico «hd-bot» usa sus dos filas.
  const first = page.getByTestId('agent-row').nth(0);
  await expect(first.locator('[data-token="terminal_title_stripped"]')).toContainText(
    'hd-bot en docs',
  );
  await expect(first.locator('[data-token="agent"]')).toHaveCount(0);
  // row_gap = 1: una fila en blanco por agente.
  await expect(first.getByTestId('agent-row-gap')).toHaveCount(1);
});

test('el panel no se escapa del ancho de la sidebar y en compacto deja solo los iconos', async ({
  page,
}) => {
  await bootApp(page);
  const panel = page.getByTestId('agent-panel');
  const sidebar = page.getByTestId('sidebar');
  const [panelBox, sidebarBox] = await Promise.all([panel.boundingBox(), sidebar.boundingBox()]);
  expect(panelBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect((panelBox?.width ?? 0) + 2).toBeLessThanOrEqual(sidebarBox?.width ?? 0);

  // Compacto: el título de sección y los tokens de texto desaparecen, el icono se queda.
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed-mode', 'compact');
  await expect(page.locator('.agent-panel__section-title').first()).toBeHidden();
  await expect(page.locator('.agent-panel__tools')).toBeHidden();
  const row = page.getByTestId('agent-row').nth(0);
  await expect(row.locator('.agent-dot')).toBeVisible();
  await expect(row.locator('[data-token="agent"]')).toBeHidden();
});
