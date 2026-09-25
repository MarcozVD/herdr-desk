// T1.5 — Reconexión: estado visible, backoff y botón «Iniciar servidor».

import { expect, test } from '@playwright/test';

import { bootApp, readSnapshotFixture, recordedCalls } from './harness';

test('sin snapshot la franja avisa, reintenta con backoff y ofrece arrancar el servidor', async ({
  page,
}) => {
  await bootApp(page, { autoSnapshot: false });
  const banner = page.getByTestId('reconnect-banner');
  await expect(banner).toBeVisible();

  // «conectando» dura lo que tarda el watchdog (2,5 s): el estado estable sin
  // snapshot es «desconectado · reintentando» con el backoff a la vista.
  await expect(page.getByTestId('reconnect-text')).toContainText('reintentando', {
    timeout: 8000,
  });
  await expect(page.getByTestId('reconnect-text')).toContainText('intento');
  await expect(page.getByTestId('reconnect-start-server')).toBeVisible();
  await expect(page.getByTestId('connection-pill')).toContainText('desconectado');
});

test('«Iniciar servidor» llama a session_start y reintenta', async ({ page }) => {
  await bootApp(page, { autoSnapshot: false, sessionName: 'herdr-desk-dev' });
  await expect(page.getByTestId('reconnect-text')).toContainText('reintentando', {
    timeout: 8000,
  });
  await page.getByTestId('reconnect-start-server').click();
  await expect.poll(async () => (await recordedCalls(page, 'session_start')).length).toBe(1);
  const [call] = await recordedCalls(page, 'session_start');
  expect(call).toMatchObject({ name: 'herdr-desk-dev' });
  await expect
    .poll(async () => (await recordedCalls(page, 'store_subscribe')).length)
    .toBeGreaterThan(1);
});

test('al llegar el snapshot la franja desaparece y la conexión queda en línea', async ({
  page,
}) => {
  await bootApp(page, { autoSnapshot: false });
  await expect(page.getByTestId('reconnect-banner')).toBeVisible();

  await page.evaluate((snapshot) => {
    window.__HD_TEST__?.pushSnapshot(snapshot);
  }, readSnapshotFixture());

  await expect(page.getByTestId('reconnect-banner')).toHaveCount(0);
  await expect(page.getByTestId('connection-pill')).toContainText('en línea');
  await expect(page.getByTestId('pane-frame')).toHaveCount(1);
});

test('tras reconectar se vuelve a pedir el layout y el bridge', async ({ page }) => {
  await bootApp(page, { autoSnapshot: false });
  await expect(page.getByTestId('reconnect-banner')).toBeVisible();
  await page.evaluate((snapshot) => {
    window.__HD_TEST__?.pushSnapshot(snapshot);
  }, readSnapshotFixture());
  await expect(page.getByTestId('terminal-host')).toHaveAttribute('data-bridge', 'open');
  await expect
    .poll(async () => (await recordedCalls(page, 'terminal_open')).length)
    .toBeGreaterThan(0);
});
