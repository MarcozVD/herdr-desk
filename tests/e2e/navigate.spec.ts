// T4a — Modo navegar (`goto`): Hint con los atajos del ámbito `navigate`, las
// teclas mueven el foco local sin llegar a la terminal y Esc sale del modo.

import { expect, test } from '@playwright/test';

import { bootApp, readLayoutFixture } from './harness';

test.use({ viewport: { width: 1280, height: 800 } });

test('goto abre el Hint y h/l mueven el foco entre paneles sin tocar la terminal', async ({
  page,
}) => {
  await bootApp(page, { layoutTree: readLayoutFixture() });
  await expect(page.getByTestId('pane-frame')).toHaveCount(2);
  await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p1"]')).toHaveAttribute(
    'data-active',
    'true',
  );

  await page.keyboard.press('Control+b');
  await page.keyboard.press('g');
  const hint = page.getByTestId('navigate-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Modo navegar');
  await expect(hint).toContainText('Panel derecha');

  // «l» enfoca el panel de la derecha (foco local; no manda pane.focus al server).
  await page.keyboard.press('l');
  await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p2"]')).toHaveAttribute(
    'data-active',
    'true',
  );

  // El Hint sigue visible tras moverse; Esc lo cierra.
  await expect(hint).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(hint).toHaveCount(0);
});
