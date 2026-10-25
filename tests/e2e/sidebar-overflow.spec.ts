// Regresión: con muchos espacios y agentes la sidebar debe repartir el alto
// 50/50 entre las dos secciones (como `sidebar_section_split` de la TUI) y dar
// a cada una su propio scroll vertical, sin que una sección se monte encima de
// la otra. Antes, `.sidebar__section` era un item flex con `flex-shrink: 1` y
// `min-block-size: 0`: se encogía por debajo de su contenido y las filas
// desbordaban sobre la sección siguiente.

import { expect, test, type Page } from '@playwright/test';

import { bootApp, readSnapshotFixture } from './harness';

const MANY = 24;

/** Snapshot con MANY espacios y un agente por espacio. */
function crowdedSnapshot(): Record<string, unknown> {
  const base = readSnapshotFixture();
  const sourceWorkspace = (base.workspaces as Array<Record<string, unknown>>)[0]!;
  const sourceTab = (base.tabs as Array<Record<string, unknown>>)[0]!;
  const sourceAgent = (base.agents as Array<Record<string, unknown>>)[0]!;

  const ids = Array.from({ length: MANY }, (_, index) => `w${index + 1}`);
  return {
    ...base,
    workspaces: ids.map((workspaceId, index) => ({
      ...sourceWorkspace,
      workspace_id: workspaceId,
      number: index + 1,
      label: `espacio-${index + 1}`,
      focused: index === 0,
      active_tab_id: `${workspaceId}:t1`,
    })),
    tabs: ids.map((workspaceId, index) => ({
      ...sourceTab,
      tab_id: `${workspaceId}:t1`,
      workspace_id: workspaceId,
      focused: index === 0,
    })),
    agents: ids.map((workspaceId, index) => ({
      ...sourceAgent,
      terminal_id: `term_${workspaceId}`,
      pane_id: `${workspaceId}:p1`,
      workspace_id: workspaceId,
      tab_id: `${workspaceId}:t1`,
      focused: index === 0,
      agent_status: index % 3 === 0 ? 'blocked' : 'working',
    })),
  };
}

/** Geometría y scroll de la sidebar y sus dos secciones. */
async function readLayout(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(`falta ${selector}`);
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const scroll = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(`falta ${selector}`);
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
      };
    };
    return {
      sidebar: box('[data-testid="sidebar"]'),
      workspaceSection: box('.sidebar__section--workspaces'),
      agentSection: box('.sidebar__section--agents'),
      workspaceBody: box('[data-testid="workspace-rows"]'),
      agentBody: box('[data-testid="agent-panel-body"]'),
      workspaceScroll: scroll('[data-testid="workspace-rows"]'),
      agentScroll: scroll('[data-testid="agent-panel-body"]'),
      sidebarScroll: scroll('[data-testid="sidebar"]'),
    };
  });
}

type Layout = Awaited<ReturnType<typeof readLayout>>;

/** Reparto 50/50, sin solape, y fuera del sidebar no hay scroll. */
function expectSplit(layout: Layout): void {
  expect(Math.abs(layout.workspaceSection.height - layout.agentSection.height)).toBeLessThanOrEqual(
    1.5,
  );
  expect(layout.workspaceSection.height).toBeGreaterThan(layout.sidebar.height * 0.4);
  expect(layout.agentSection.height).toBeGreaterThan(layout.sidebar.height * 0.4);
  expect(layout.workspaceSection.y + layout.workspaceSection.height).toBeLessThanOrEqual(
    layout.agentSection.y + 1,
  );
  expect(layout.sidebarScroll.scrollHeight).toBeLessThanOrEqual(
    layout.sidebarScroll.clientHeight + 1,
  );
}

/** Las dos listas desbordan y lo hacen por separado. */
function expectIndependentScroll(layout: Layout): void {
  expect(layout.workspaceScroll.scrollHeight).toBeGreaterThan(
    layout.workspaceScroll.clientHeight + 20,
  );
  expect(layout.agentScroll.scrollHeight).toBeGreaterThan(layout.agentScroll.clientHeight + 20);
}

async function scrollToBottom(page: Page, selector: string): Promise<void> {
  await page.evaluate((target) => {
    const element = document.querySelector(target);
    if (element instanceof HTMLElement) element.scrollTop = element.scrollHeight;
  }, selector);
}

test('reparte el alto 50/50 y cada sección hace su propio scroll', async ({ page }) => {
  await bootApp(page, { snapshot: crowdedSnapshot() });
  await expect(page.getByTestId('workspace-row')).toHaveCount(MANY);
  await expect(page.getByTestId('agent-row')).toHaveCount(MANY);

  expectSplit(await readLayout(page));
  expectIndependentScroll(await readLayout(page));

  // La última fila de espacios queda recortada dentro de su scroller y por
  // encima del panel de agentes (antes se dibujaba encima de él).
  await scrollToBottom(page, '[data-testid="workspace-rows"]');
  const workspaceBody = await page.getByTestId('workspace-rows').boundingBox();
  const lastWorkspaceRow = await page.getByTestId('workspace-row').last().boundingBox();
  const agentSection = await page.locator('.sidebar__section--agents').boundingBox();
  expect(workspaceBody).not.toBeNull();
  expect(lastWorkspaceRow).not.toBeNull();
  expect(agentSection).not.toBeNull();
  expect(lastWorkspaceRow?.y ?? 0).toBeGreaterThanOrEqual((workspaceBody?.y ?? 0) - 1);
  expect((lastWorkspaceRow?.y ?? 0) + (lastWorkspaceRow?.height ?? 0)).toBeLessThanOrEqual(
    (workspaceBody?.y ?? 0) + (workspaceBody?.height ?? 0) + 1,
  );
  expect((workspaceBody?.y ?? 0) + (workspaceBody?.height ?? 0)).toBeLessThanOrEqual(
    (agentSection?.y ?? 0) + 1,
  );

  // El scroll del panel de agentes no mueve la lista de espacios.
  const workspaceTop = await page
    .getByTestId('workspace-rows')
    .evaluate((element) => element.scrollTop);
  await scrollToBottom(page, '[data-testid="agent-panel-body"]');
  expect(await page.getByTestId('workspace-rows').evaluate((element) => element.scrollTop)).toBe(
    workspaceTop,
  );

  const agentBody = await page.getByTestId('agent-panel-body').boundingBox();
  const lastAgentRow = await page.getByTestId('agent-row').last().boundingBox();
  expect(agentBody).not.toBeNull();
  expect(lastAgentRow).not.toBeNull();
  expect(lastAgentRow?.y ?? 0).toBeGreaterThanOrEqual((agentBody?.y ?? 0) - 1);
  expect((lastAgentRow?.y ?? 0) + (lastAgentRow?.height ?? 0)).toBeLessThanOrEqual(
    (agentBody?.y ?? 0) + (agentBody?.height ?? 0) + 1,
  );
});

test('en modo compacto mantiene el 50/50 y el scroll independiente', async ({ page }) => {
  await bootApp(page, { snapshot: crowdedSnapshot() });
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed-mode', 'compact');

  expectSplit(await readLayout(page));
  expectIndependentScroll(await readLayout(page));

  // Sigue habiendo scroll (sin tokens de texto) y el icono de estado se ve.
  await expect(page.getByTestId('agent-panel-filter')).toBeHidden();
  await expect(page.getByTestId('agent-row').first().locator('.agent-dot')).toBeVisible();

  await scrollToBottom(page, '[data-testid="agent-panel-body"]');
  const agentBody = await page.getByTestId('agent-panel-body').boundingBox();
  const lastAgentRow = await page.getByTestId('agent-row').last().boundingBox();
  expect(agentBody).not.toBeNull();
  expect(lastAgentRow).not.toBeNull();
  expect((lastAgentRow?.y ?? 0) + (lastAgentRow?.height ?? 0)).toBeLessThanOrEqual(
    (agentBody?.y ?? 0) + (agentBody?.height ?? 0) + 1,
  );
});
