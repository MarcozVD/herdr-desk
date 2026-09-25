// T1.11 — Selector de sesiones: listar, conectar, iniciar, detener y borrar.

import { expect, test } from '@playwright/test';

import { bootApp, recordedCalls } from './harness';

test('lista las sesiones del CLI y marca la activa', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('session-label').click();

  await expect(page.getByTestId('session-list')).toBeVisible();
  await expect(page.getByTestId('session-row')).toHaveCount(3);
  await expect(page.getByTestId('session-row').nth(0)).toHaveAttribute(
    'data-name',
    'herdr-desk-dev',
  );
  await expect(page.getByTestId('session-row').nth(0).getByTestId('session-current')).toBeVisible();
});

test('conectar a una sesión detenida la arranca primero', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('session-label').click();
  await page
    .getByTestId('session-row')
    .filter({ hasText: 'hd-test-x' })
    .getByTestId('session-connect')
    .click();

  await expect.poll(async () => (await recordedCalls(page, 'session_start')).length).toBe(1);
  await expect.poll(async () => (await recordedCalls(page, 'session_connect')).length).toBe(1);
  const [start] = await recordedCalls(page, 'session_start');
  expect(start).toMatchObject({ name: 'hd-test-x' });
});

test('borrar exige escribir el nombre exacto', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('session-label').click();
  await page
    .getByTestId('session-row')
    .filter({ hasText: 'hd-test-x' })
    .getByTestId('session-delete')
    .click();

  const accept = page.getByTestId('confirm-accept');
  await expect(accept).toBeDisabled();
  await page.getByTestId('confirm-text').fill('otra-cosa');
  await expect(accept).toBeDisabled();
  await page.getByTestId('confirm-text').fill('hd-test-x');
  await expect(accept).toBeEnabled();
  await accept.click();

  await expect.poll(async () => (await recordedCalls(page, 'session_delete')).length).toBe(1);
  const [call] = await recordedCalls(page, 'session_delete');
  expect(call).toMatchObject({ name: 'hd-test-x' });
});

test('detener pide confirmación y llama a session_stop', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('session-label').click();
  await page
    .getByTestId('session-row')
    .filter({ hasText: 'herdr-desk-dev' })
    .getByTestId('session-stop')
    .click();
  await page.getByTestId('confirm-accept').click();
  await expect.poll(async () => (await recordedCalls(page, 'session_stop')).length).toBe(1);
});

test('crear una sesión nueva valida el nombre y llama a session_start', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('session-label').click();
  await page.getByTestId('sessions-new').click();
  await page.getByTestId('prompt-input').fill('mi sesion!');
  await expect(page.getByTestId('prompt-accept')).toBeDisabled();
  await page.getByTestId('prompt-input').fill('mi-sesion');
  await page.getByTestId('prompt-accept').click();

  await expect.poll(async () => (await recordedCalls(page, 'session_start')).length).toBe(1);
  const [call] = await recordedCalls(page, 'session_start');
  expect(call).toMatchObject({ name: 'mi-sesion' });
});

test('recargar la lista vuelve a llamar a session_list', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('session-label').click();
  await expect.poll(async () => (await recordedCalls(page, 'session_list')).length).toBe(1);
  await page.getByTestId('sessions-reload').click();
  await expect.poll(async () => (await recordedCalls(page, 'session_list')).length).toBe(2);
});
