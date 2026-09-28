// F3 — Superficies nuevas: presets de layout, modo resize, mover panel y
// worktrees. Los datos salen del arnés (config/worktree mockeados).

import { expect, test, type Page } from '@playwright/test';

import { bootApp, readLayoutFixture, recordedMethodCalls } from './harness';

test.use({ viewport: { width: 1280, height: 800 } });

async function paletteRun(page: Page, query: string): Promise<void> {
  await page.keyboard.press('Control+Shift+P');
  await page.getByTestId('palette-input').fill(query);
  await expect(page.locator('[data-testid="palette-item"][data-active="true"]')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('palette')).toHaveCount(0);
}

test('guardar y aplicar un preset de layout', async ({ page }) => {
  await bootApp(page, { layoutTree: readLayoutFixture() });
  // El árbol llega por RPC: sin paneles montados no hay layout que guardar.
  await expect(page.getByTestId('pane-frame')).toHaveCount(2);

  await paletteRun(page, 'guardar el layout del tab');
  await page.getByTestId('prompt-input').fill('e2e');
  await page.getByTestId('prompt-accept').click();

  await paletteRun(page, 'aplicar el layout');
  await expect
    .poll(async () => (await recordedMethodCalls(page, 'layout.apply')).length)
    .toBeGreaterThan(0);
});

test('modo redimensionar: flechas llaman a pane.resize', async ({ page }) => {
  await bootApp(page, { layoutTree: readLayoutFixture() });

  await page.getByTestId('pane-menu').first().click();
  await page.getByTestId('context-item').filter({ hasText: 'Modo redimensionar' }).click();
  await expect(page.getByTestId('resize-chip')).toBeVisible();

  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(async () => (await recordedMethodCalls(page, 'pane.resize')).length)
    .toBeGreaterThan(0);
  // Salir del modo: cualquier otra tecla.
  await page.keyboard.press('x');
  await expect(page.getByTestId('resize-chip')).toHaveCount(0);
});

test('mover un panel a una pestaña nueva usa pane.move', async ({ page }) => {
  await bootApp(page, { layoutTree: readLayoutFixture() });

  await page.getByTestId('pane-menu').first().click();
  await page.getByTestId('context-item').filter({ hasText: 'Mover a pestaña nueva' }).click();
  await expect
    .poll(async () => (await recordedMethodCalls(page, 'pane.move')).length)
    .toBeGreaterThan(0);
});

test('el diálogo de worktrees lista el repo y sus checkouts', async ({ page }) => {
  await bootApp(page);

  await paletteRun(page, 'worktrees del espacio');
  await expect(page.getByTestId('worktrees-dialog')).toBeVisible();
  await expect(page.getByTestId('worktree-row')).toHaveCount(2);
  await expect(page.getByTestId('worktree-row').first()).toContainText('main');

  await page.getByTestId('worktree-new').click();
  await page.getByTestId('worktree-branch').fill('dev-2');
  await page.getByTestId('worktree-create').click();
  await expect(page.getByTestId('worktrees-dialog')).toBeVisible();
});
