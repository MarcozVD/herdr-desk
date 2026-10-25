// Regresión: con muchos espacios y agentes la sidebar debe listarlos y dejar
// hacer scroll vertical, sin que una sección se monte encima de la siguiente.
// La causa era `.sidebar__section` con `flex-shrink: 1` y `min-block-size: 0`:
// como items flex del sidebar se encogían por debajo de su contenido.

import { expect, test } from '@playwright/test';

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

test('con muchos espacios y agentes la sidebar hace scroll sin encimar secciones', async ({
  page,
}) => {
  await bootApp(page, { snapshot: crowdedSnapshot() });
  await expect(page.getByTestId('workspace-row')).toHaveCount(MANY);
  await expect(page.getByTestId('agent-row')).toHaveCount(MANY);

  const sidebar = page.getByTestId('sidebar');
  const sidebarBox = await sidebar.boundingBox();
  expect(sidebarBox).not.toBeNull();

  // La última fila de espacios termina antes de que empiece el panel de agentes:
  // antes del arreglo se desbordaba encima de él.
  const lastWorkspaceRow = await page.getByTestId('workspace-row').last().boundingBox();
  const agentPanel = await page.getByTestId('agent-panel').boundingBox();
  expect(lastWorkspaceRow).not.toBeNull();
  expect(agentPanel).not.toBeNull();
  expect((lastWorkspaceRow?.y ?? 0) + (lastWorkspaceRow?.height ?? 0)).toBeLessThanOrEqual(
    (agentPanel?.y ?? 0) + 1,
  );

  // Scroll vertical: el final de la lista se alcanza y queda dentro del sidebar.
  const lastAgentRow = page.getByTestId('agent-row').last();
  await lastAgentRow.scrollIntoViewIfNeeded();
  const lastAgentBox = await lastAgentRow.boundingBox();
  expect(lastAgentBox).not.toBeNull();
  expect(lastAgentBox?.y ?? Number.POSITIVE_INFINITY).toBeGreaterThanOrEqual(
    (sidebarBox?.y ?? 0) - 1,
  );
  expect((lastAgentBox?.y ?? 0) + (lastAgentBox?.height ?? 0)).toBeLessThanOrEqual(
    (sidebarBox?.y ?? 0) + (sidebarBox?.height ?? 0) + 1,
  );
});
