// R11 (lado UI): el foco de la GUI no debe mover la TUI salvo que el usuario
// active «Sincronizar foco con TUI». Por defecto todo es foco local.

import { expect, test } from '@playwright/test';

import { bootApp } from './harness';

async function focusCalls(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() =>
    (window.__HD_TEST__?.calls ?? [])
      .filter((call) => call.cmd === 'herdr_call')
      .map((call) => String((call.args as { method?: unknown }).method ?? ''))
      .filter((method) => method === 'workspace.focus' || method === 'pane.focus'),
  );
}

test('R11: con el ajuste por defecto el clic en un espacio NO llama a workspace.focus', async ({
  page,
}) => {
  await bootApp(page);

  await page.getByTestId('workspace-row').nth(1).click();
  await expect(page.getByTestId('workspace-row').nth(1)).toHaveAttribute('aria-current', 'true');

  expect(await focusCalls(page)).toEqual([]);
});

test('R11: el clic dentro de la terminal no manda foco a herdr', async ({ page }) => {
  await bootApp(page);
  await expect(page.getByTestId('terminal-host')).toHaveAttribute('data-bridge', 'open');

  await page.getByTestId('terminal-host').click();
  await page.keyboard.press('ArrowUp');

  expect(await focusCalls(page)).toEqual([]);
  // El clic no debe cerrar ni reabrir el bridge (R3: clic dentro de opencode).
  expect(await page.evaluate(() => window.__HD_TEST__?.bridgeCount())).toBe(1);
});

test('R11: con «Sincronizar foco con TUI» activo sí llama a workspace.focus', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('herdr-desk.settings', JSON.stringify({ sync_focus_with_tui: true }));
  });
  await bootApp(page);

  await page.getByTestId('workspace-row').nth(1).click();
  await expect.poll(async () => (await focusCalls(page)).length).toBeGreaterThan(0);
  expect(await focusCalls(page)).toContain('workspace.focus');
});
