// T1.6 — Shell de UI: sidebar (ancho y modos), tab bar (posición y ocultado),
// status bar y las superficies glass.

import { expect, test } from '@playwright/test';

import { bootApp, readSnapshotFixture } from './harness';

test('la sidebar respeta sidebar_width y los modos de colapsada', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'herdr-desk.settings',
      JSON.stringify({ sidebar_width: 30, sidebar_collapsed_mode: 'compact' }),
    );
  });
  await bootApp(page);

  const width = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width').trim(),
  );
  // 30 columnas * 9,2 px
  expect(width).toBe('276px');

  await expect(page.getByTestId('sidebar')).toBeVisible();
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.locator('.body')).toHaveAttribute('data-sidebar', 'compact');
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.locator('.body')).toHaveAttribute('data-sidebar', 'expanded');
});

test('el modo hidden esconde la sidebar del todo', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'herdr-desk.settings',
      JSON.stringify({ sidebar_start_collapsed: true, sidebar_collapsed_mode: 'hidden' }),
    );
  });
  await bootApp(page);
  await expect(page.locator('.body')).toHaveAttribute('data-sidebar', 'hidden');
  await expect(page.getByTestId('sidebar')).toBeHidden();
});

test('la tab bar muestra las pestañas del espacio activo', async ({ page }) => {
  await bootApp(page);
  const tabs = page.getByTestId('tab');
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toHaveAttribute('data-tab-id', 'w1:t1');
  await expect(tabs.first()).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('new-tab')).toBeVisible();
});

test('hide_tab_bar_when_single_tab oculta la barra con una sola pestaña', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'herdr-desk.settings',
      JSON.stringify({ hide_tab_bar_when_single_tab: true }),
    );
  });
  await bootApp(page);
  await expect(page.getByTestId('tabbar')).toHaveCount(0);
});

test('tab_bar_position=bottom coloca la barra abajo', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('herdr-desk.settings', JSON.stringify({ tab_bar_position: 'bottom' }));
  });
  await bootApp(page);
  await expect(page.getByTestId('tabbar')).toHaveAttribute('data-position', 'bottom');
});

test('la status bar muestra el panel, el scroll y la latencia del RPC', async ({ page }) => {
  await bootApp(page);
  await expect(page.getByTestId('status-pane')).toContainText('w1:p1');
  await expect(page.getByTestId('status-scroll')).toContainText('scroll');
  await expect(page.getByTestId('status-latency')).toContainText('ms');
  await expect(page.getByTestId('status-version')).toContainText('protocolo 19');
});

test('el cheatsheet (help) lista los atajos configurados', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('help-button').click();
  const sheet = page.getByTestId('cheatsheet');
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('cheatsheet-prefix')).toContainText('Nueva pestaña');
  await expect(page.getByTestId('cheatsheet-direct')).toContainText('Paleta de acciones');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});

test('la sidebar pinta los espacios y agentes del snapshot (fixture)', async ({ page }) => {
  await bootApp(page);
  const fixture = readSnapshotFixture() as {
    workspaces: Array<{ label: string }>;
    agents: Array<{ pane_id: string }>;
  };
  await expect(page.getByTestId('workspaces-count')).toHaveText(String(fixture.workspaces.length));
  await expect(page.getByTestId('workspace-row').nth(0)).toContainText(
    fixture.workspaces[0]?.label ?? '',
  );
  await expect(page.getByTestId('agent-row')).toHaveCount(fixture.agents.length);
});

/** Regresión: la franja de reconexión es una banda más del shell y no debe
 *  llevarse la fila elástica (con el grid de filas fijas medía 709 px y dejaba
 *  el cuerpo en 26 px). */
async function measureShell(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const height = (selector: string) =>
      Math.round(document.querySelector(selector)?.getBoundingClientRect().height ?? -1);
    return {
      banner: height('[data-testid="reconnect-banner"]'),
      titlebar: height('[data-testid="titlebar"]'),
      body: height('.body'),
      sidebar: height('[data-testid="sidebar"]'),
      panes: height('[data-testid="split-area"]'),
      statusbar: height('[data-testid="statusbar"]'),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

test('con la franja de reconexión visible el cuerpo conserva su alto (regresión)', async ({
  page,
}) => {
  await bootApp(page, { autoSnapshot: false });
  await expect(page.getByTestId('reconnect-banner')).toBeVisible();

  const box = await measureShell(page);
  expect(box.banner).toBeGreaterThan(0);
  expect(box.banner).toBeLessThan(80);
  expect(box.titlebar).toBe(40);
  expect(box.statusbar).toBeGreaterThan(20);
  expect(box.statusbar).toBeLessThan(40);
  expect(box.body).toBeGreaterThan(400);
  expect(box.sidebar).toBeGreaterThan(300);
  expect(box.panes).toBeGreaterThan(300);
  expect(box.overflowX).toBe(0);
});

test('en línea el shell mantiene la misma estructura de bandas', async ({ page }) => {
  await bootApp(page);
  await expect(page.getByTestId('reconnect-banner')).toHaveCount(0);

  const box = await measureShell(page);
  expect(box.titlebar).toBe(40);
  expect(box.body).toBeGreaterThan(600);
  expect(box.panes).toBeGreaterThan(400);
  expect(box.overflowX).toBe(0);
});
