// Cambio de sesión activa (T1.11) — el fallo reportado: al conectar con otra
// sesión se re-suscribía al store pero SEGUÍAN los panes, las pestañas, los
// terminales y el layout de la sesión anterior (paneles viejos con terminales
// «desconectados» de una sesión que ya no está). Aquí se fija que al cambiar de
// sesión NO queda NADA de la anterior y que el estado nuevo se aplica encima.

import { expect, test } from '@playwright/test';

import { bootApp } from './harness';

const ARBOL_PREVIO = {
  type: 'split',
  direction: 'right',
  ratio: 0.5,
  first: { type: 'pane', pane_id: 'w1:p1' },
  second: { type: 'pane', pane_id: 'w1:p2' },
};

const ARBOL_NUEVO = { type: 'pane', pane_id: 'w9:p1' };

const PREVIA = {
  version: '0.8.0-preview.test',
  protocol: 19,
  focused_workspace_id: 'w1',
  focused_tab_id: 'w1:t1',
  focused_pane_id: 'w1:p1',
  workspaces: [
    {
      workspace_id: 'w1',
      number: 1,
      label: 'spike-r3',
      focused: true,
      pane_count: 2,
      tab_count: 1,
      active_tab_id: 'w1:t1',
      agent_status: 'unknown',
    },
  ],
  tabs: [
    {
      tab_id: 'w1:t1',
      workspace_id: 'w1',
      number: 1,
      label: 'spike-r3',
      focused: true,
      pane_count: 2,
      agent_status: 'unknown',
    },
  ],
  panes: [
    {
      pane_id: 'w1:p1',
      terminal_id: 'term_previo_1',
      workspace_id: 'w1',
      tab_id: 'w1:t1',
      focused: true,
      cwd: 'C:/Users/dev/Documents/herdr',
      agent_status: 'unknown',
      revision: 1,
    },
    {
      pane_id: 'w1:p2',
      terminal_id: 'term_previo_2',
      workspace_id: 'w1',
      tab_id: 'w1:t1',
      focused: false,
      cwd: 'C:/Users/dev/Documents/herdr',
      agent_status: 'unknown',
      revision: 1,
    },
  ],
  agents: [],
  layouts: [],
};

const NUEVA = {
  ...PREVIA,
  focused_workspace_id: 'w9',
  focused_tab_id: 'w9:t1',
  focused_pane_id: 'w9:p1',
  workspaces: [
    {
      workspace_id: 'w9',
      number: 1,
      label: 'verify-ws',
      focused: true,
      pane_count: 1,
      tab_count: 1,
      active_tab_id: 'w9:t1',
      agent_status: 'unknown',
    },
  ],
  tabs: [
    {
      tab_id: 'w9:t1',
      workspace_id: 'w9',
      number: 1,
      label: 'verify-ws',
      focused: true,
      pane_count: 1,
      agent_status: 'unknown',
    },
  ],
  panes: [
    {
      pane_id: 'w9:p1',
      terminal_id: 'term_nuevo_1',
      workspace_id: 'w9',
      tab_id: 'w9:t1',
      focused: true,
      cwd: 'C:/Users/dev/Documents/herdr',
      agent_status: 'unknown',
      revision: 1,
    },
  ],
};

test('cambiar de sesión no deja nada de la anterior y aplica la nueva', async ({ page }) => {
  await bootApp(page, { autoSnapshot: false, layoutTree: ARBOL_PREVIO });
  await page.evaluate((snapshot) => window.__HD_TEST__?.pushSnapshot(snapshot), PREVIA);
  await expect(page.getByTestId('pane-frame')).toHaveCount(2);
  await expect(page.getByTestId('workspace-row')).toHaveCount(1);
  await expect(page.getByTestId('workspace-row').first()).toContainText('spike-r3');

  // Cambio de sesión desde el selector.
  await page.getByTestId('session-label').click();
  await page
    .getByTestId('session-row')
    .filter({ hasText: 'hd-test-x' })
    .getByTestId('session-connect')
    .click();

  // NADA de la sesión anterior: ni marcos, ni terminales, ni espacios, ni el
  // nombre de la sesión vieja. El tab visible queda vacío hasta el snapshot nuevo.
  await expect(page.getByTestId('pane-frame')).toHaveCount(0);
  await expect(page.getByTestId('terminal-host')).toHaveCount(0);
  await expect(page.getByTestId('workspace-row')).toHaveCount(0);
  // Sin snapshot no hay tab: el área queda en el estado «sin panel».
  await expect(page.getByTestId('no-pane')).toBeVisible();
  await expect(page.getByTestId('session-label')).not.toContainText('herdr-desk-dev');

  // Y el snapshot de la sesión nueva se aplica encima, sin restos: el árbol se
  // reconstruye desde el layout nuevo y sólo queda el bridge del panel nuevo.
  await page.evaluate((tree) => window.__HD_TEST__?.setLayoutTree(tree), ARBOL_NUEVO);
  await page.evaluate((snapshot) => window.__HD_TEST__?.pushSnapshot(snapshot), NUEVA);
  await expect(page.getByTestId('pane-frame')).toHaveCount(1);
  await expect(page.getByTestId('pane-frame').first()).toHaveAttribute('data-pane-id', 'w9:p1');
  await expect(page.getByTestId('pane-title').first()).toContainText('w9:p1');
  await expect(page.getByTestId('workspace-row')).toHaveCount(1);
  await expect(page.getByTestId('workspace-row').first()).toContainText('verify-ws');
  const abiertos = await page.evaluate(() =>
    (window.__HD_TEST__?.openPanes() ?? []).slice().sort(),
  );
  expect(abiertos).toEqual(['w9:p1']);
});
