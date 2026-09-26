// BUG A/B/C — Verificación de navegación de la app real, en e2e:
//
//  A) cambiar de pestaña NO cierra los bridges de la pestaña que se oculta y al
//     volver el panel sigue «open» (sin overlay de reconectando);
//  B) pulsar un espacio de la barra muestra los paneles de ese espacio;
//  C) los atajos apuntan al panel que se está viendo y un atajo de la GUI sale
//     del modo prefix (no ejecuta una acción de más).

import { expect, test, type Page } from '@playwright/test';

import {
  bootApp,
  readLayoutFixture,
  readSnapshotFixture,
  recordedCalls,
  recordedMethodCalls,
} from './harness';

/** El mismo árbol de dos paneles que usa el fixture (w1:p1 | w1:p2). */
const splitTree = readLayoutFixture();

const treeTwoTabs = {
  'w1:t1': splitTree,
  'w2:t1': { type: 'pane', pane_id: 'w2:p1', cwd: 'C:/tmp' },
};

async function closeCalls(page: Page): Promise<unknown[]> {
  return recordedCalls(page, 'terminal_close');
}

/** ¿El panel tiene bridge abierto ahora mismo? (estado real del pool). */
async function hasOpenBridge(page: Page, paneId: string): Promise<boolean> {
  return page.evaluate((id) => window.__HD_TEST__?.hasBridge(id) ?? false, paneId);
}

/** Fixture + un segundo tab en w1 (w1:t2 con el panel w1:p3). */
function fixtureWithSecondTab(): Record<string, unknown> {
  const base = readSnapshotFixture() as {
    tabs: Array<Record<string, unknown>>;
    panes: Array<Record<string, unknown>>;
    layouts: Array<Record<string, unknown>>;
    workspaces: Array<Record<string, unknown>>;
  };
  const template = base.panes[0] ?? {};
  return {
    ...base,
    workspaces: base.workspaces.map((workspace) =>
      workspace.workspace_id === 'w1' ? { ...workspace, tab_count: 2 } : workspace,
    ),
    tabs: [
      ...base.tabs,
      {
        tab_id: 'w1:t2',
        workspace_id: 'w1',
        number: 2,
        label: '2',
        focused: false,
        pane_count: 1,
        agent_status: 'unknown',
      },
    ],
    panes: [
      ...base.panes,
      {
        ...template,
        pane_id: 'w1:p3',
        terminal_id: 'term_w1:p3',
        tab_id: 'w1:t2',
        focused: false,
        title: 'w1:p3',
        terminal_title_stripped: 'w1:p3',
      },
    ],
    layouts: [...base.layouts, { tab_id: 'w1:t2', zoomed: false, panes: [{ pane_id: 'w1:p3' }] }],
  };
}

const treeThirdTab = { type: 'pane', pane_id: 'w1:p3', cwd: 'C:/tmp' };

test.describe('navegación sin perder terminales', () => {
  test('cambiar de pestaña no cierra los bridges y al volver sigue abierto', async ({ page }) => {
    await bootApp(page, {
      snapshot: fixtureWithSecondTab(),
      layoutTrees: { 'w1:t1': splitTree, 'w1:t2': treeThirdTab, 'w2:t1': treeTwoTabs['w2:t1'] },
    });
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p1"]')).toBeVisible();
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p2"]')).toBeVisible();
    expect(await hasOpenBridge(page, 'w1:p1')).toBe(true);
    expect(await hasOpenBridge(page, 'w1:p2')).toBe(true);

    // Cambia de pestaña: se desmontan las vistas de la pestaña que se oculta.
    await page.locator('[data-testid="tab"][data-tab-id="w1:t2"]').click();
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p3"]')).toBeVisible();
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p1"]')).toHaveCount(0);

    // El bridge de los paneles ocultos NO se cerró (ocultar ≠ cerrar).
    expect(await closeCalls(page)).toHaveLength(0);
    expect(await hasOpenBridge(page, 'w1:p1')).toBe(true);
    expect(await hasOpenBridge(page, 'w1:p2')).toBe(true);

    // Y al volver, los paneles siguen conectados (sin overlay de reconectando).
    await page.locator('[data-testid="tab"][data-tab-id="w1:t1"]').click();
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p1"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="terminal-host"][data-pane-id="w1:p1"]'),
    ).toHaveAttribute('data-bridge', 'open');
    await expect(page.locator('.terminal-overlay')).toHaveCount(0);
    expect(await closeCalls(page)).toHaveLength(0);
  });

  test('pulsar un espacio de la barra cambia el espacio que se ve', async ({ page }) => {
    await bootApp(page, { layoutTrees: treeTwoTabs });
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p1"]')).toBeVisible();

    await page.locator('[data-testid="workspace-row"][data-workspace-id="w2"]').click();

    // La vista sigue al espacio pulsado: aparecen SUS paneles.
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w2:p1"]')).toBeVisible();
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p1"]')).toHaveCount(0);
    // Y la fila queda marcada como el espacio enfocado.
    await expect(
      page.locator('[data-testid="workspace-row"][data-workspace-id="w2"]'),
    ).toHaveAttribute('aria-current', 'true');
    await expect(
      page.locator('[data-testid="workspace-row"][data-workspace-id="w1"]'),
    ).toHaveAttribute('aria-current', 'false');
  });

  test('los atajos con prefijo apuntan al panel visible y la GUI sale del prefix', async ({
    page,
  }) => {
    await bootApp(page, {
      layoutTrees: { ...treeTwoTabs, 'w1:t1': splitTree },
    });
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p2"]')).toBeVisible();

    // Enfoca el panel de la derecha desde la paleta/atajo: clic en su marco.
    await page.locator('[data-testid="pane-frame"][data-pane-id="w1:p2"]').click();

    // prefijo + z → zoom del panel que se está viendo.
    await page.keyboard.press('Control+b');
    await page.keyboard.press('z');
    await expect
      .poll(async () => recordedMethodCalls(page, 'pane.zoom').then((calls) => calls.length))
      .toBeGreaterThan(0);
    const zoom = (await recordedMethodCalls(page, 'pane.zoom')).at(-1) as {
      params: { pane_id: string };
    };
    expect(zoom.params.pane_id).toBe('w1:p2');

    // Un atajo de la GUI en medio del prefix: abre la paleta y NO deja el modo
    // prefix colgado (la tecla siguiente no puede ejecutar otra acción).
    await page.keyboard.press('Control+b');
    await page.keyboard.press('Control+Shift+p');
    await expect(page.getByTestId('palette')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette')).toHaveCount(0);
    const zoomsBefore = (await recordedMethodCalls(page, 'pane.zoom')).length;
    await page.keyboard.press('z');
    expect((await recordedMethodCalls(page, 'pane.zoom')).length).toBe(zoomsBefore);
  });

  test('un panel cerrado sí suelta su bridge', async ({ page }) => {
    // Aquí se usa `layoutTree` (árbol único) porque el test lo cambia en vivo con
    // `setLayoutTree` para simular el cierre del panel.
    await bootApp(page, { layoutTree: splitTree });
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p2"]')).toBeVisible();

    // El usuario cierra w1:p2: el snapshot deja de traerlo.
    const fixture = readSnapshotFixture() as {
      panes: Array<{ pane_id: string }>;
      layouts: Array<{ tab_id: string; panes: Array<{ pane_id: string }> }>;
      focused_pane_id: string;
    };
    const next = {
      ...fixture,
      panes: fixture.panes.filter((pane) => pane.pane_id !== 'w1:p2'),
      layouts: fixture.layouts.map((item) => ({
        ...item,
        panes: item.panes.filter((pane) => pane.pane_id !== 'w1:p2'),
      })),
      focused_pane_id: 'w1:p1',
    };
    // El árbol que devuelve el servidor ya no trae el panel cerrado.
    await page.evaluate((tree) => window.__HD_TEST__?.setLayoutTree(tree), {
      type: 'pane',
      pane_id: 'w1:p1',
      cwd: 'C:/tmp',
    });
    await page.evaluate((value) => window.__HD_TEST__?.pushSnapshot(value), next);
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p2"]')).toHaveCount(0);
    await expect.poll(async () => (await closeCalls(page)).length).toBeGreaterThan(0);
    expect(await hasOpenBridge(page, 'w1:p2')).toBe(false);
    expect(await hasOpenBridge(page, 'w1:p1')).toBe(true);
  });
});
