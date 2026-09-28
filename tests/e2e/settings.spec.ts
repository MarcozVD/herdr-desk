// T3.5/T3.6 — Ajustes: formulario generado desde config_default, escritura con
// config_write, pestaña de atajos y reset con confirmación.

import { expect, test, type Page } from '@playwright/test';

import { bootApp, recordedCalls } from './harness';

test.use({ viewport: { width: 1280, height: 800 } });

async function openSettings(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+P');
  await page.getByTestId('palette-input').fill('ajustes');
  await expect(page.locator('[data-testid="palette-item"][data-active="true"]')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
}

test('el formulario escribe config.toml con config_write', async ({ page }) => {
  await bootApp(page);
  await openSettings(page);

  // Tema (select de la sección GUI de temas): persiste al cambiar.
  await page.getByTestId('settings-theme-name').selectOption('dracula');
  await expect
    .poll(async () => (await recordedCalls(page, 'config_write')).at(-1))
    .toMatchObject({ changes: [{ path: 'theme.name', value: '"dracula"' }] });

  // Clave de herdr: se edita en borrador y se guarda con el botón.
  const row = page.locator('[data-testid="settings-key"][data-path="ui.sidebar_width"]');
  await row.getByTestId('settings-number').fill('40');
  await expect(page.getByTestId('settings-dirty')).toBeVisible();
  await page.getByTestId('settings-save').click();
  await expect
    .poll(async () => (await recordedCalls(page, 'config_write')).at(-1))
    .toMatchObject({ changes: [{ path: 'ui.sidebar_width', value: '40' }] });
});

test('la pestaña de atajos lista acciones y el reset confirma', async ({ page }) => {
  await bootApp(page);
  await openSettings(page);

  await page.getByTestId('settings-tab-keys').click();
  await expect(page.getByTestId('keymap-table')).toBeVisible();
  await expect(page.getByTestId('keymap-row').first()).toBeVisible();

  await page.getByTestId('keymap-reset').click();
  await expect(page.getByTestId('confirm-accept')).toBeVisible();
  await page.getByTestId('confirm-cancel').click();
});

test('el botón de la titlebar abre y cierra los ajustes', async ({ page }) => {
  await bootApp(page);
  const button = page.getByTestId('settings-button');
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
});

test('el fondo acrílico se aplica en vivo y pide el efecto a la ventana', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('settings-button').click();
  await page.getByTestId('settings-backdrop').selectOption('acrylic');
  await expect(page.locator('html')).toHaveAttribute('data-backdrop', 'acrylic');
  await expect(page.locator('.bg-mesh')).toBeHidden();
  await expect
    .poll(async () => (await recordedCalls(page, 'set_mica')).some((args) => args.acrylic === true))
    .toBe(true);
});

test('el nivel de cristal (1-100) cambia la opacidad en vivo', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('settings-button').click();
  const slider = page.getByTestId('settings-glass-level');
  await slider.fill('100');
  await expect(page.getByTestId('settings-glass-level-value')).toHaveText('100');
  const alpha = () =>
    page.evaluate(() => document.documentElement.style.getPropertyValue('--glass-alpha-surface'));
  await expect.poll(alpha).toBe('0.12');
  await slider.fill('1');
  await expect.poll(alpha).toBe('0.9');
});
