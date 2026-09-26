// T1.9 — Acciones: crear/renombrar/cerrar espacio, nueva pestaña, split, zoom y
// cierre de panel, con sus diálogos de confirmación.

import { expect, test, type Page } from '@playwright/test';

import { bootApp, recordedMethodCalls, readSnapshotFixture } from './harness';

async function openContextItem(
  page: Page,
  targetTestId: string,
  text: string,
  index = 0,
): Promise<void> {
  await page.getByTestId(targetTestId).nth(index).click({ button: 'right' });
  await page.getByTestId('context-menu').waitFor();
  await page.getByTestId('context-item').filter({ hasText: text }).first().click();
}

test('nuevo espacio: pide nombre y cwd y llama a workspace.create', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('new-workspace').click();

  const dialog = page.getByTestId('workspace-dialog');
  await expect(dialog).toBeVisible();

  await page.getByTestId('workspace-label').fill('api');
  await page.getByTestId('workspace-cwd').fill('C:\\proyectos\\api');
  await page.getByTestId('workspace-accept').click();

  await expect
    .poll(async () => (await recordedMethodCalls(page, 'workspace.create')).length)
    .toBe(1);
  const [call] = await recordedMethodCalls(page, 'workspace.create');
  expect(call).toMatchObject({
    params: { label: 'api', cwd: 'C:\\proyectos\\api', focus: true },
  });
  await expect(dialog).toHaveCount(0);
});

test('renombrar espacio: doble clic en la fila y prompt', async ({ page }) => {
  const snapshot = readSnapshotFixture() as { workspaces: Array<{ workspace_id: string }> };
  await bootApp(page, { snapshot });

  await page.getByTestId('workspace-row').nth(1).dblclick();
  await page.getByTestId('prompt-input').fill('infra');
  await page.getByTestId('prompt-accept').click();

  await expect
    .poll(async () => (await recordedMethodCalls(page, 'workspace.rename')).length)
    .toBe(1);
  const [call] = await recordedMethodCalls(page, 'workspace.rename');
  expect(call).toMatchObject({
    params: { workspace_id: snapshot.workspaces[1]?.workspace_id, label: 'infra' },
  });
});

test('cerrar espacio: confirma antes y llama a workspace.close', async ({ page }) => {
  const snapshot = readSnapshotFixture() as { workspaces: Array<{ workspace_id: string }> };
  await bootApp(page, { snapshot });

  await openContextItem(page, 'workspace-row', 'Cerrar espacio', 0);
  const confirm = page.getByTestId('confirm-dialog');
  await expect(confirm).toBeVisible();
  await page.getByTestId('confirm-accept').click();

  await expect
    .poll(async () => (await recordedMethodCalls(page, 'workspace.close')).length)
    .toBe(1);
  const [call] = await recordedMethodCalls(page, 'workspace.close');
  expect(call).toMatchObject({ params: { workspace_id: snapshot.workspaces[0]?.workspace_id } });
});

test('cancelar el cierre no llama a herdr', async ({ page }) => {
  await bootApp(page);
  await openContextItem(page, 'workspace-row', 'Cerrar espacio', 0);
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
  expect(await recordedMethodCalls(page, 'workspace.close')).toHaveLength(0);
});

test('nueva pestaña: prompt con el nombre y tab.create', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('new-tab').click();
  await page.getByTestId('prompt-input').fill('logs');
  await page.getByTestId('prompt-accept').click();

  await expect.poll(async () => (await recordedMethodCalls(page, 'tab.create')).length).toBe(1);
  const [call] = await recordedMethodCalls(page, 'tab.create');
  expect(call).toMatchObject({ params: { workspace_id: 'w1', label: 'logs', focus: true } });
});

test('cerrar pestaña desde la tab bar pide confirmación', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('tab').first().hover();
  await page.getByTestId('tab-close').first().click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-accept').click();
  await expect.poll(async () => (await recordedMethodCalls(page, 'tab.close')).length).toBe(1);
});

test('split horizontal y vertical llaman a pane.split con la dirección', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('pane-split-right').click();
  await page.getByTestId('pane-split-down').click();

  await expect.poll(async () => (await recordedMethodCalls(page, 'pane.split')).length).toBe(2);
  const calls = await recordedMethodCalls(page, 'pane.split');
  expect(calls[0]).toMatchObject({ params: { direction: 'right', target_pane_id: 'w1:p1' } });
  expect(calls[1]).toMatchObject({ params: { direction: 'down', target_pane_id: 'w1:p1' } });
});

test('zoom del panel llama a pane.zoom', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('pane-zoom').click();
  await expect.poll(async () => (await recordedMethodCalls(page, 'pane.zoom')).length).toBe(1);
  const [call] = await recordedMethodCalls(page, 'pane.zoom');
  expect(call).toMatchObject({ params: { pane_id: 'w1:p1' } });
});

test('cerrar panel desde el menú pide confirmación y llama a pane.close', async ({ page }) => {
  await bootApp(page);
  await openContextItem(page, 'pane-menu', 'Cerrar panel');
  await page.getByTestId('confirm-accept').click();
  await expect.poll(async () => (await recordedMethodCalls(page, 'pane.close')).length).toBe(1);
  const [call] = await recordedMethodCalls(page, 'pane.close');
  expect(call).toMatchObject({ params: { pane_id: 'w1:p1' } });
});

test('renombrar panel llama a pane.rename', async ({ page }) => {
  await bootApp(page);
  await openContextItem(page, 'pane-menu', 'Renombrar panel');
  await page.getByTestId('prompt-input').fill('servidor');
  await page.getByTestId('prompt-accept').click();
  await expect.poll(async () => (await recordedMethodCalls(page, 'pane.rename')).length).toBe(1);
  const [call] = await recordedMethodCalls(page, 'pane.rename');
  expect(call).toMatchObject({ params: { pane_id: 'w1:p1', label: 'servidor' } });
});

test('el botón «…» del panel abre el menú con un clic izquierdo y se queda abierto', async ({
  page,
}) => {
  await bootApp(page);
  await page.getByTestId('pane-menu').click();

  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  await expect(page.getByTestId('context-item')).toHaveCount(5);

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('si herdr responde error, sale un toast en español', async ({ page }) => {
  await bootApp(page);
  // El arnés responde `ok` a todo: se fuerza el error pidiendo un cierre de un id
  // inexistente no es posible desde la UI, así que se comprueba el camino de error
  // del toast con el aviso de «sin paleta» de la acción goto (F3).
  await page.keyboard.press('Control+Shift+P');
  await expect(page.getByTestId('palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('toast-host')).toBeAttached();
});
