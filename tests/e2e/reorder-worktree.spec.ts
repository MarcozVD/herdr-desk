// T4d — Verificación que faltaba en F3: reordenar pestañas y espacios por
// arrastre, y borrar un worktree con el doble aviso (normal y reintento force).

import { expect, test, type Page } from '@playwright/test';

import {
  bootApp,
  readLayoutFixture,
  readSnapshotFixture,
  recordedCalls,
  recordedMethodCalls,
} from './harness';

test.use({ viewport: { width: 1280, height: 800 } });

async function paletteRun(page: Page, query: string): Promise<void> {
  await page.keyboard.press('Control+Shift+P');
  await page.getByTestId('palette-input').fill(query);
  await expect(page.locator('[data-testid="palette-item"][data-active="true"]')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('palette')).toHaveCount(0);
}

function fixtureWithSecondTab(): Record<string, unknown> {
  const base = readSnapshotFixture() as {
    workspaces: Array<Record<string, unknown>>;
    tabs: Array<Record<string, unknown>>;
    panes: Array<Record<string, unknown>>;
    layouts: Array<Record<string, unknown>>;
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

test('arrastrar una pestaña sobre otra manda tab.move con el índice absoluto', async ({ page }) => {
  await bootApp(page, {
    snapshot: fixtureWithSecondTab(),
    layoutTrees: {
      'w1:t1': readLayoutFixture(),
      'w1:t2': { type: 'pane', pane_id: 'w1:p3', cwd: 'C:/tmp' },
    },
  });
  await expect(page.getByTestId('tab')).toHaveCount(2);

  await page
    .locator('[data-testid="tab"][data-tab-id="w1:t1"]')
    .dragTo(page.locator('[data-testid="tab"][data-tab-id="w1:t2"]'));

  await expect
    .poll(async () => (await recordedMethodCalls(page, 'tab.move')).length)
    .toBeGreaterThan(0);
  expect((await recordedMethodCalls(page, 'tab.move')).at(-1)).toMatchObject({
    method: 'tab.move',
    params: { tab_id: 'w1:t1', insert_index: 1 },
  });
});

test('arrastrar un espacio sobre otro manda workspace.move con el índice absoluto', async ({
  page,
}) => {
  await bootApp(page);
  await expect(page.getByTestId('workspace-row')).toHaveCount(2);

  await page
    .locator('[data-testid="workspace-row"][data-workspace-id="w1"]')
    .dragTo(page.locator('[data-testid="workspace-row"][data-workspace-id="w2"]'));

  await expect
    .poll(async () => (await recordedMethodCalls(page, 'workspace.move')).length)
    .toBeGreaterThan(0);
  expect((await recordedMethodCalls(page, 'workspace.move')).at(-1)).toMatchObject({
    method: 'workspace.move',
    params: { workspace_id: 'w1', insert_index: 1 },
  });
});

test('borrar un worktree pide confirmación y reintenta con force tras el fallo', async ({
  page,
}) => {
  await bootApp(page, { worktreeRemoveFailsOnce: true });
  await paletteRun(page, 'worktrees del espacio');
  await expect(page.getByTestId('worktrees-dialog')).toBeVisible();

  await page.getByTestId('worktree-remove').first().click();
  // Primer aviso: borrado normal (force=false).
  await page.getByTestId('confirm-accept').click();
  await expect.poll(async () => (await recordedCalls(page, 'worktree_remove')).length).toBe(1);
  expect((await recordedCalls(page, 'worktree_remove'))[0]).toMatchObject({
    request: { workspace_id: 'w1', force: false },
  });

  // El server lo rechaza: segundo aviso y reintento con force=true.
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-accept').click();
  await expect.poll(async () => (await recordedCalls(page, 'worktree_remove')).length).toBe(2);
  expect((await recordedCalls(page, 'worktree_remove'))[1]).toMatchObject({
    request: { workspace_id: 'w1', force: true },
  });
});
