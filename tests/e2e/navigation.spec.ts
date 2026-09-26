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
  pushFrame,
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

async function releaseCalls(page: Page): Promise<unknown[]> {
  return recordedCalls(page, 'terminal_release');
}

/** Texto que la terminal de ese panel tiene en su buffer (regresión: al volver
 *  a la pestaña el panel se quedaba en negro porque el buffer se perdía). */
async function bufferText(page: Page, paneId: string): Promise<string> {
  return page.evaluate((id) => {
    const terms = (window as unknown as { __HD_TERMS__?: Record<string, unknown> }).__HD_TERMS__;
    const term = terms?.[id] as
      | {
          buffer: {
            active: {
              length: number;
              getLine(n: number): { translateToString(): string } | undefined;
            };
          };
        }
      | undefined;
    if (!term) return '';
    const lines: string[] = [];
    for (let index = 0; index < term.buffer.active.length; index += 1) {
      lines.push(term.buffer.active.getLine(index)?.translateToString() ?? '');
    }
    return lines.join(String.fromCharCode(10));
  }, paneId);
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
  test('cambiar de pestaña suelta el bridge (release, no close) y al volver repinta el texto', async ({
    page,
  }) => {
    await bootApp(page, {
      snapshot: fixtureWithSecondTab(),
      layoutTrees: { 'w1:t1': splitTree, 'w1:t2': treeThirdTab, 'w2:t1': treeTwoTabs['w2:t1'] },
    });
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p1"]')).toBeVisible();
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p2"]')).toBeVisible();
    expect(await hasOpenBridge(page, 'w1:p1')).toBe(true);

    // Contenido real: al volver tiene que SEGUIR viéndose (si la vista nueva no
    // recibe el viewport, el panel se queda en negro).
    await pushFrame(page, { paneId: 'w1:p1', full: true, text: 'marca-de-buffer' });
    await pushFrame(page, { paneId: 'w1:p2', full: true, text: 'marca-dos' });
    await expect.poll(async () => bufferText(page, 'w1:p1')).toContain('marca-de-buffer');

    // Cambia de pestaña: se desmontan las vistas de la pestaña que se oculta.
    await page.locator('[data-testid="tab"][data-tab-id="w1:t2"]').click();
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p3"]')).toBeVisible();
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p1"]')).toHaveCount(0);

    // Ocultar SUELTA el bridge (terminal_release) y NO lo cierra: cerrarlo mataría
    // el panel (user_close), que es el bug que dejaba las terminales muertas.
    await expect.poll(async () => (await releaseCalls(page)).length).toBeGreaterThanOrEqual(2);
    expect(await closeCalls(page)).toHaveLength(0);
    expect(await hasOpenBridge(page, 'w1:p1')).toBe(false);

    // Al volver: vista nueva + bridge nuevo, y el servidor manda el viewport.
    await page.locator('[data-testid="tab"][data-tab-id="w1:t1"]').click();
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p1"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="terminal-host"][data-pane-id="w1:p1"]'),
    ).toHaveAttribute('data-bridge', 'open');
    await expect(page.locator('.terminal-overlay')).toHaveCount(0);
    await expect.poll(async () => hasOpenBridge(page, 'w1:p1')).toBe(true);
    await expect.poll(async () => bufferText(page, 'w1:p1')).toContain('marca-de-buffer');
    expect(await closeCalls(page)).toHaveLength(0);
  });

  test('cambiar de espacio suelta/reengancha sin perder el contenido', async ({ page }) => {
    await bootApp(page, { layoutTrees: treeTwoTabs });
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p1"]')).toBeVisible();
    await pushFrame(page, { paneId: 'w1:p1', full: true, text: 'texto-del-espacio-uno' });
    await expect.poll(async () => bufferText(page, 'w1:p1')).toContain('texto-del-espacio-uno');

    await page.locator('[data-testid="workspace-row"][data-workspace-id="w2"]').click();

    // La vista sigue al espacio pulsado: aparecen SUS paneles.
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w2:p1"]')).toBeVisible();
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p1"]')).toHaveCount(0);
    await expect(
      page.locator('[data-testid="workspace-row"][data-workspace-id="w2"]'),
    ).toHaveAttribute('aria-current', 'true');
    expect(await closeCalls(page)).toHaveLength(0);

    // Y al volver al espacio uno, su panel sigue con el contenido pintado.
    await page.locator('[data-testid="workspace-row"][data-workspace-id="w1"]').click();
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p1"]')).toBeVisible();
    await expect.poll(async () => bufferText(page, 'w1:p1')).toContain('texto-del-espacio-uno');
    await expect(
      page.locator('[data-testid="terminal-host"][data-pane-id="w1:p1"]'),
    ).toHaveAttribute('data-bridge', 'open');
    expect(await closeCalls(page)).toHaveLength(0);
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

  test('cerrar un panel vecino no vacía los que siguen abiertos', async ({ page }) => {
    // `layoutTree` (árbol único) porque el test lo cambia en vivo al cerrar.
    await bootApp(page, { layoutTree: splitTree });
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p2"]')).toBeVisible();
    await pushFrame(page, { paneId: 'w1:p1', full: true, text: 'vecino-uno' });
    await pushFrame(page, { paneId: 'w1:p2', full: true, text: 'vecino-dos' });
    await expect.poll(async () => bufferText(page, 'w1:p1')).toContain('vecino-uno');
    await expect.poll(async () => bufferText(page, 'w1:p2')).toContain('vecino-dos');

    // El usuario cierra w1:p2: el snapshot y el árbol dejan de traerlo.
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
    await page.evaluate((tree) => window.__HD_TEST__?.setLayoutTree(tree), {
      type: 'pane',
      pane_id: 'w1:p1',
      cwd: 'C:/tmp',
    });
    await page.evaluate((value) => window.__HD_TEST__?.pushSnapshot(value), next);

    // El panel cerrado suelta y cierra su bridge…
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p2"]')).toHaveCount(0);
    await expect.poll(async () => (await closeCalls(page)).length).toBe(1);
    expect(await hasOpenBridge(page, 'w1:p2')).toBe(false);

    // …y el vecino sigue montado, con su bridge y su contenido intactos.
    await expect(page.locator('[data-testid="pane-frame"][data-pane-id="w1:p1"]')).toBeVisible();
    expect(await hasOpenBridge(page, 'w1:p1')).toBe(true);
    expect(await bufferText(page, 'w1:p1')).toContain('vecino-uno');
    await expect(
      page.locator('[data-testid="terminal-host"][data-pane-id="w1:p1"]'),
    ).toHaveAttribute('data-bridge', 'open');
  });
});
