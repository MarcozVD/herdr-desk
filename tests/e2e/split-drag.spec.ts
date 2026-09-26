// BUG 2 — Redimensionar paneles arrastrando el divisor.
//
// Comprueba, con el navegador de verdad: (1) el panel cambia de tamaño mientras
// se arrastra (ratio optimista local), (2) al soltar se manda UN SOLO
// `layout.set_split_ratio` con la ruta correcta del divisor, (3) con divisores
// anidados manda el más profundo, y (4) el ratio se queda dentro de 0.05–0.95.

import { expect, test, type Page } from '@playwright/test';

import { bootApp, readLayoutFixture, readSnapshotFixture, recordedMethodCalls } from './harness';

const splitTree = readLayoutFixture(); // split right: w1:p1 | w1:p2

/** Split anidado: a la derecha, otro split 'down' con w1:p2 / w1:p3. */
const nestedTree = {
  type: 'split',
  direction: 'right',
  ratio: 0.5,
  first: { type: 'pane', pane_id: 'w1:p1', cwd: 'C:/tmp' },
  second: {
    type: 'split',
    direction: 'down',
    ratio: 0.5,
    first: { type: 'pane', pane_id: 'w1:p2', cwd: 'C:/tmp' },
    second: { type: 'pane', pane_id: 'w1:p3', cwd: 'C:/tmp' },
  },
};

/** Fixture + tercer panel en w1:t1 (hace falta para anidar). */
function fixtureWithThirdPane(): Record<string, unknown> {
  const base = readSnapshotFixture() as {
    panes: Array<Record<string, unknown>>;
    layouts: Array<{ tab_id: string; panes: Array<{ pane_id: string }> }>;
  };
  const template = base.panes[0] ?? {};
  return {
    ...base,
    panes: [
      ...base.panes,
      {
        ...template,
        pane_id: 'w1:p3',
        terminal_id: 'term_w1:p3',
        title: 'w1:p3',
        terminal_title_stripped: 'w1:p3',
      },
    ],
    layouts: base.layouts.map((item) =>
      item.tab_id === 'w1:t1' ? { ...item, panes: [...item.panes, { pane_id: 'w1:p3' }] } : item,
    ),
  };
}

function frame(page: Page, paneId: string) {
  return page.locator(`[data-testid="pane-frame"][data-pane-id="${paneId}"]`);
}

function divider(page: Page, path: string) {
  return page.locator(`[data-testid="split-divider"][data-path="${path}"]`);
}

/**
 * Arrastra el divisor `delta` px y suelta. El movimiento va en el EJE del split
 * (horizontal para `right`, vertical para `down`): mover en el otro eje no cambia
 * el ratio (lo aprendí peleándome con este mismo test).
 */
async function dragDivider(page: Page, path: string, delta: number): Promise<void> {
  const locator = divider(page, path);
  const direction = await locator.getAttribute('data-direction');
  const box = await locator.boundingBox();
  if (!box) throw new Error(`sin caja para el divisor ${path}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  if (direction === 'down') await page.mouse.move(x, y + delta, { steps: 8 });
  else await page.mouse.move(x + delta, y, { steps: 8 });
  await page.mouse.up();
}

test('arrastrar el divisor redimensiona el panel y manda un solo set_split_ratio', async ({
  page,
}) => {
  await bootApp(page, { layoutTree: splitTree });
  await expect(frame(page, 'w1:p1')).toBeVisible();

  const before = (await frame(page, 'w1:p1').boundingBox())?.width ?? 0;
  const container = (await page.locator('[data-testid="split"]').first().boundingBox())?.width ?? 0;
  await dragDivider(page, 'root', 120);

  // El panel creció con el arrastre (ratio optimista, sin esperar al servidor).
  const after = (await frame(page, 'w1:p1').boundingBox())?.width ?? 0;
  expect(after).toBeGreaterThan(before + 60);

  // Un ÚNICO commit al servidor, con la ruta del divisor (raíz = []) y un ratio
  // coherente con el desplazamiento.
  const calls = await recordedMethodCalls(page, 'layout.set_split_ratio');
  expect(calls).toHaveLength(1);
  const params = (calls[0] as { params: { tab_id: string; path: boolean[]; ratio: number } })
    .params;
  expect(params.tab_id).toBe('w1:t1');
  expect(params.path).toEqual([]);
  expect(params.ratio).toBeGreaterThan(0.5 + 120 / container - 0.08);
  expect(params.ratio).toBeLessThan(0.5 + 120 / container + 0.08);
});

test('con divisores anidados manda el más profundo', async ({ page }) => {
  await bootApp(page, { snapshot: fixtureWithThirdPane(), layoutTree: nestedTree });
  await expect(frame(page, 'w1:p2')).toBeVisible();
  await expect(frame(page, 'w1:p3')).toBeVisible();

  const before = (await frame(page, 'w1:p2').boundingBox())?.height ?? 0;
  await dragDivider(page, '1', 90); // el divisor del split anidado (segunda rama)

  const after = (await frame(page, 'w1:p2').boundingBox())?.height ?? 0;
  expect(after).toBeGreaterThan(before + 20);

  const calls = await recordedMethodCalls(page, 'layout.set_split_ratio');
  expect(calls).toHaveLength(1);
  const params = (calls[0] as { params: { path: boolean[]; ratio: number } }).params;
  expect(params.path).toEqual([true]); // el anidado, no la raíz
  expect(params.ratio).toBeGreaterThan(0.5);
});

test('el ratio se queda entre 0,05 y 0,95 aunque se arrastre de más', async ({ page }) => {
  await bootApp(page, { layoutTree: splitTree });
  await expect(frame(page, 'w1:p1')).toBeVisible();

  // Un gesto largo hacia la izquierda: el ratio calculado se saldría del rango.
  await dragDivider(page, 'root', -600);

  const calls = await recordedMethodCalls(page, 'layout.set_split_ratio');
  // Un ÚNICO commit por gesto (no uno por cada movimiento del ratón).
  expect(calls).toHaveLength(1);
  const ratio = (calls[0] as { params: { ratio: number } }).params.ratio;
  expect(ratio).toBeGreaterThanOrEqual(0.05);
  expect(ratio).toBeLessThanOrEqual(0.95);
});
