// T1.7 — Árbol de splits: render con ratios, divisores y paneles; zoom.

import { expect, test } from '@playwright/test';

import { bootApp, readLayoutFixture, readSnapshotFixture } from './harness';

test('renderiza el árbol de layout.export con sus paneles y su divisor', async ({ page }) => {
  await bootApp(page, { layoutTree: readLayoutFixture() });

  const panes = page.getByTestId('pane-frame');
  await expect(panes).toHaveCount(2);
  await expect(page.getByTestId('pane-frame').nth(0)).toHaveAttribute('data-pane-id', 'w1:p1');
  await expect(page.getByTestId('pane-frame').nth(1)).toHaveAttribute('data-pane-id', 'w1:p2');

  const split = page.getByTestId('split');
  await expect(split).toHaveAttribute('data-direction', 'right');
  await expect(page.getByTestId('split-divider')).toHaveCount(1);

  // Los dos lados pesan lo mismo (ratio 0.5).
  const ratios = await page.evaluate(() =>
    [...document.querySelectorAll('.split > .split__side')].map((element) =>
      (element as HTMLElement).style.getPropertyValue('--ratio'),
    ),
  );
  expect(ratios).toHaveLength(2);
  expect(Number(ratios[0])).toBeCloseTo(0.5, 5);
  expect(Number(ratios[1])).toBeCloseTo(0.5, 5);

  await expect(page.getByTestId('status-panes-count')).toContainText('2');
});

test('cada panel tiene su terminal y su bridge', async ({ page }) => {
  await bootApp(page, { layoutTree: readLayoutFixture() });
  await expect(page.getByTestId('terminal-host')).toHaveCount(2);
  await expect(page.getByTestId('terminal-host').nth(0)).toHaveAttribute('data-bridge', 'open');
  await expect(page.getByTestId('terminal-host').nth(1)).toHaveAttribute('data-bridge', 'open');

  const paneIds = await page.evaluate(() => (window.__HD_TEST__?.openPanes() ?? []).slice().sort());
  expect(paneIds).toEqual(['w1:p1', 'w1:p2']);
});

test('el zoom del tab muestra solo el panel enfocado', async ({ page }) => {
  // El snapshot de fixture marca w1:p1 como enfocado.
  await bootApp(page, { layoutTree: readLayoutFixture() });
  await expect(page.getByTestId('pane-frame')).toHaveCount(2);

  const fixture = readSnapshotFixture();
  const zoomed = JSON.parse(JSON.stringify(fixture)) as {
    layouts: Array<{ tab_id: string; zoomed: boolean }>;
  };
  for (const layout of zoomed.layouts) if (layout.tab_id === 'w1:t1') layout.zoomed = true;

  await page.evaluate((snapshot) => {
    window.__HD_TEST__?.pushSnapshot(snapshot);
  }, zoomed);

  await expect(page.getByTestId('status-zoom')).toBeVisible();
  await expect(page.getByTestId('pane-frame')).toHaveCount(1);
  await expect(page.getByTestId('pane-frame')).toHaveAttribute('data-pane-id', 'w1:p1');
});

test('un panel se marca activo al enfocarlo', async ({ page }) => {
  await bootApp(page, { layoutTree: readLayoutFixture() });
  const first = page.getByTestId('pane-frame').nth(0);
  const second = page.getByTestId('pane-frame').nth(1);
  await expect(first).toHaveAttribute('data-active', 'true');

  await second.getByTestId('pane-title').click();
  await expect(second).toHaveAttribute('data-active', 'true');
  await expect(first).toHaveAttribute('data-active', 'false');
});
