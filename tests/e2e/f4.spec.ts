// F4 — Superficies nuevas: plugins, integraciones, servidor/update/canal, consola
// API (con eventos) y avanzado. Todo contra el arnés (IPC mockeado).

import { expect, test, type Page } from '@playwright/test';

import { bootApp, recordedCalls, recordedMethodCalls } from './harness';

test.use({ viewport: { width: 1360, height: 860 } });

async function paletteRun(page: Page, query: string): Promise<void> {
  await page.keyboard.press('Control+Shift+P');
  await page.getByTestId('palette-input').fill(query);
  const active = page.locator('[data-testid="palette-item"][data-active="true"]');
  await expect(active).toHaveCount(1);
  await active.click();
  await expect(page.getByTestId('palette')).toHaveCount(0);
}

test('plugins: lista, toggle, acciones, logs y desvincular', async ({ page }) => {
  await bootApp(page);
  await paletteRun(page, 'plugins');
  await expect(page.getByTestId('plugins-dialog')).toBeVisible();
  await expect(page.getByTestId('plugin-row')).toHaveCount(2);

  // Desactivar el activo.
  await page.getByTestId('plugin-row').first().getByTestId('plugin-toggle').click();
  await expect
    .poll(async () => (await recordedCalls(page, 'plugin_disable')).length)
    .toBeGreaterThan(0);

  // Acciones: expandir, invocar.
  await page.getByTestId('plugin-row').first().getByTestId('plugin-details').click();
  await expect(page.getByTestId('plugin-action')).toHaveCount(1);
  await page.getByTestId('plugin-invoke').click();
  await expect
    .poll(async () => (await recordedCalls(page, 'plugin_action_invoke')).length)
    .toBeGreaterThan(0);

  // Logs en el visor.
  await page.getByTestId('plugin-row').first().getByTestId('plugin-logs').click();
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expect(page.getByTestId('viewer-body')).toContainText('salida');
  await page.getByTestId('viewer-close').click();
  await expect(page.getByTestId('viewer')).toHaveCount(0);

  // Desvincular con confirmación (el command exige confirm=true).
  await page.getByTestId('plugin-row').nth(1).getByTestId('plugin-unlink').click();
  await page.getByTestId('confirm-accept').click();
  const unlinks = await recordedCalls(page, 'plugin_unlink');
  expect(unlinks.length).toBeGreaterThan(0);
  expect(JSON.stringify(unlinks.at(-1))).toContain('"confirm":true');
});

test('integraciones: instala y desinstala con confirmación', async ({ page }) => {
  await bootApp(page);
  await paletteRun(page, 'integraciones');
  await expect(page.getByTestId('integrations-dialog')).toBeVisible();
  await expect(page.getByTestId('integration-row')).toHaveCount(2);

  await page.getByTestId('integration-row').nth(1).getByTestId('integration-install').click();
  await page.getByTestId('confirm-accept').click();
  await expect
    .poll(async () => (await recordedCalls(page, 'integration_install')).length)
    .toBeGreaterThan(0);

  await page.getByTestId('integration-row').first().getByTestId('integration-uninstall').click();
  await page.getByTestId('confirm-accept').click();
  await expect
    .poll(async () => (await recordedCalls(page, 'integration_uninstall')).length)
    .toBeGreaterThan(0);
});

test('servidor: estado, manifiestos, update, canal y stop con doble aviso', async ({ page }) => {
  await bootApp(page);
  await paletteRun(page, 'manifiestos');
  await expect(page.getByTestId('server-dialog')).toBeVisible();
  await expect(page.getByTestId('server-live')).toContainText('0.8.0');
  await expect(page.getByTestId('manifest-row')).toHaveCount(1);

  await page.getByTestId('server-reload-manifests').click();
  await expect
    .poll(async () => (await recordedCalls(page, 'agent_manifests_reload')).length)
    .toBeGreaterThan(0);

  await page.getByTestId('server-update').click();
  await expect
    .poll(async () =>
      (await recordedCalls(page, 'cli_run')).some(
        (call) => JSON.stringify(call.argv) === JSON.stringify(['herdr', 'update']),
      ),
    )
    .toBe(true);

  // La salida del update se abre en el visor (por encima): se cierra para seguir.
  await page.getByTestId('viewer-close').click();
  await expect(page.getByTestId('viewer')).toHaveCount(0);

  await page.getByTestId('server-channel-preview').click();
  await expect
    .poll(async () =>
      (await recordedCalls(page, 'cli_run')).some(
        (call) =>
          JSON.stringify(call.argv) === JSON.stringify(['herdr', 'channel', 'set', 'preview']),
      ),
    )
    .toBe(true);

  // Stop: dos confirmaciones antes de llamar a server.stop.
  await page.getByTestId('server-stop').click();
  await page.getByTestId('confirm-accept').click();
  await page.getByTestId('confirm-accept').click();
  await expect
    .poll(async () => (await recordedMethodCalls(page, 'server.stop')).length)
    .toBeGreaterThan(0);
});

test('consola API: catálogo, formulario y eventos en vivo', async ({ page }) => {
  await bootApp(page);
  await paletteRun(page, 'consola api');
  await expect(page.getByTestId('console-dialog')).toBeVisible();
  await expect(page.getByTestId('console-method')).toHaveCount(2);

  // Selecciona workspace.list (tiene un bool) y ejecuta.
  await page.locator('[data-testid="console-method"][data-method="workspace.list"]').click();
  await expect(page.getByTestId('console-param')).toHaveCount(1);
  await page.getByTestId('console-run').click();
  await expect(page.getByTestId('console-response')).toContainText('workspace_list');
  await expect
    .poll(async () => (await recordedMethodCalls(page, 'workspace.list')).length)
    .toBeGreaterThan(0);

  // Visor de eventos: pide la suscripción al backend.
  await page.getByTestId('console-events-toggle').click();
  await expect
    .poll(async () => (await recordedCalls(page, 'events_watch')).length)
    .toBeGreaterThan(0);
  const watch = (await recordedCalls(page, 'events_watch')).at(-1);
  expect((watch?.types as string[]).length).toBe(24);
});

test('avanzado: notificación de prueba y skill', async ({ page }) => {
  await bootApp(page);
  await paletteRun(page, 'avanzado');
  await expect(page.getByTestId('advanced-dialog')).toBeVisible();

  await page.getByTestId('advanced-notify').click();
  await expect
    .poll(async () => (await recordedCalls(page, 'notification_show')).length)
    .toBeGreaterThan(0);

  await page.getByTestId('advanced-view-clear').click();
  await expect
    .poll(async () => (await recordedMethodCalls(page, 'agent.view.clear')).length)
    .toBeGreaterThan(0);
});
