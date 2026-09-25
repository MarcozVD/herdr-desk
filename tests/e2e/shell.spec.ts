// Shell del spike: titlebar, sidebar con el snapshot en vivo y status bar.
// Cubre el lado UI de R2 (ventana sin marco: drag region + controles) y la
// métrica «evento -> UI» del §4.

import { expect, test } from '@playwright/test';

import { bootApp, readSnapshotFixture } from './harness';

test('la sidebar pinta los espacios y los agentes del snapshot', async ({ page }) => {
  await bootApp(page);

  await expect(page.getByTestId('workspaces-count')).toHaveText('2');
  const rows = page.getByTestId('workspace-row');
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('workspace-row').nth(0)).toContainText('spike');
  await expect(page.getByTestId('workspace-row').nth(1)).toContainText('docs');

  // El estado de agente llega al DOM como atributo (lo consume el glow del §3).
  await expect(
    page.locator('[data-testid="workspace-row"][data-workspace-id="w1"]'),
  ).toHaveAttribute('data-status', 'working');
  await expect(
    page.locator('[data-testid="workspace-row"][data-workspace-id="w2"]'),
  ).toHaveAttribute('data-status', 'blocked');

  await expect(page.getByTestId('agents-count')).toHaveText('2');
  await expect(page.getByTestId('agent-row')).toHaveCount(2);
  // Orden por prioridad: blocked antes que working.
  await expect(page.getByTestId('agent-row').nth(0)).toHaveAttribute('data-status', 'blocked');
  await expect(page.getByTestId('agent-row').nth(1)).toHaveAttribute('data-status', 'working');

  // Status bar con el panel enfocado del fixture.
  await expect(page.getByTestId('status-pane')).toContainText('w1:p1');
  await expect(page.getByTestId('status-cwd')).toContainText('Documents/herdr');
});

test('R2: la ventana sin marcos tiene drag region y controles propios', async ({ page }) => {
  await bootApp(page);

  const titlebar = page.getByTestId('titlebar');
  await expect(titlebar).toHaveAttribute('data-tauri-drag-region', '');
  await expect(page.getByTestId('window-minimize')).toBeVisible();
  await expect(page.getByTestId('window-maximize')).toBeVisible();
  await expect(page.getByTestId('window-close')).toBeVisible();

  // Los botones hablan con el plugin de ventana de Tauri (mockIPC los registra).
  await page.getByTestId('window-minimize').click();
  const minimizeCalls = await page.evaluate(() =>
    (window.__HD_TEST__?.calls ?? []).map((call) => call.cmd).filter((cmd) => /minimize/.test(cmd)),
  );
  expect(minimizeCalls.length).toBeGreaterThan(0);

  // Glass aplicado: atributos que consumen los tokens del §3.
  await expect(page.locator('html')).toHaveAttribute('data-glass', 'on');
  await expect(page.locator('html')).toHaveAttribute('data-mica', 'on');
  await expect(titlebar).toHaveClass(/glass/);
  const backdrop = await titlebar.evaluate((element) => getComputedStyle(element).backdropFilter);
  expect(backdrop).toContain('blur');
});

test('la paleta se abre con Ctrl+Shift+P y con el botón', async ({ page }) => {
  await bootApp(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.keyboard.press('Control+Shift+P');
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByTestId('palette-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('métrica evento -> UI: un snapshot nuevo pinta el estado en menos de 50 ms', async ({
  page,
}) => {
  await bootApp(page);
  await expect(
    page.locator('[data-testid="workspace-row"][data-workspace-id="w2"]'),
  ).toHaveAttribute('data-status', 'blocked');

  const next = readSnapshotFixture() as {
    workspaces: Array<{ workspace_id: string; agent_status: string }>;
    agents: Array<{ pane_id: string; agent_status: string }>;
  };
  for (const workspace of next.workspaces) {
    if (workspace.workspace_id === 'w2') workspace.agent_status = 'done';
  }
  for (const agent of next.agents) {
    if (agent.pane_id === 'w2:p1') agent.agent_status = 'done';
  }

  const deltaMs = await page.evaluate(async (snapshot) => {
    const readStatus = () =>
      document
        .querySelector('[data-testid="workspace-row"][data-workspace-id="w2"]')
        ?.getAttribute('data-status');
    const start = performance.now();
    window.__HD_TEST__?.pushSnapshot(snapshot);
    return await new Promise<number>((resolve) => {
      const check = () => {
        if (readStatus() === 'done') resolve(performance.now() - start);
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }, next);

  // §4: evento -> UI (glow de estado) <= 50 ms.
  console.log(`[hd-perf] evento->UI (snapshot -> atributo en el DOM): ${deltaMs.toFixed(1)} ms`);
  expect(deltaMs).toBeLessThan(50);
});
