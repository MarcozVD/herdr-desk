// T2.6/T2.7 — Paleta de acciones: atajo en cualquier estado, búsqueda fuzzy,
// grupos, teclado (↑↓/Enter/Esc), recientes que se recuerdan, comandos de
// agente y salto a un panel con el foco de teclado sincronizado.

import { expect, test, type Page } from '@playwright/test';

import { bootApp, recordedCalls, recordedMethodCalls, readSnapshotFixture } from './harness';

test.use({ viewport: { width: 1280, height: 800 } });

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+P');
  await expect(page.getByTestId('palette')).toBeVisible();
}

async function itemIds(page: Page): Promise<string[]> {
  return page.$$eval('[data-testid="palette-item"]', (items) =>
    items.map((item) => item.getAttribute('data-id') ?? ''),
  );
}

async function search(page: Page, query: string): Promise<void> {
  await page.getByTestId('palette-input').fill(query);
  // La lista ya se ha repintado con el resultado (items o «sin resultados»).
  await expect(
    page.locator('[data-testid="palette-item"], [data-testid="palette-empty"]').first(),
  ).toBeVisible();
}

/** Busca y ejecuta la primera coincidencia con Enter. */
async function runFirst(page: Page, query: string): Promise<void> {
  await search(page, query);
  await expect(page.locator('[data-testid="palette-item"][data-active="true"]')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('palette')).toHaveCount(0);
}

test('Ctrl+Shift+P abre la paleta desde la terminal y con el cheatsheet abierto', async ({
  page,
}) => {
  await bootApp(page);

  await openPalette(page);
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette')).toHaveCount(0);

  // «En cualquier estado»: con la ayuda abierta (prefix + ?) el atajo sigue
  // entrando.
  await page.keyboard.press('Control+b');
  await page.keyboard.press('?');
  await expect(page.getByTestId('cheatsheet')).toBeVisible();
  await openPalette(page);
});

test('la lista sale agrupada y con los comandos de cada tipo', async ({ page }) => {
  await bootApp(page);
  await openPalette(page);

  for (const group of ['session', 'workspaces', 'tabs', 'panes', 'agents', 'settings', 'system']) {
    await expect(page.getByTestId(`palette-group-${group}`)).toBeAttached();
  }
  const ids = await itemIds(page);
  expect(ids).toContain('panes.split_right');
  expect(ids).toContain('agent:w1:p1:transcript');
});

test('busca sin acentos y ordena por relevancia', async ({ page }) => {
  await bootApp(page);
  await openPalette(page);

  await search(page, 'pestana');
  const ids = await itemIds(page);
  expect(ids.some((id) => id.startsWith('tab:') || id.includes('tab'))).toBe(true);

  await search(page, 'zzzz');
  await expect(page.getByTestId('palette-empty')).toContainText('Sin resultados');
});

test('teclado: ↑↓ mueven, Enter ejecuta y Esc cierra', async ({ page }) => {
  await bootApp(page);
  await openPalette(page);
  await search(page, 'zoom');

  await expect.poll(async () => (await itemIds(page))[0]).toBe('panes.zoom');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('palette')).toHaveCount(0);
  await expect
    .poll(async () => (await recordedMethodCalls(page, 'pane.zoom')).length)
    .toBeGreaterThanOrEqual(1);

  // Esc cierra sin ejecutar nada.
  await openPalette(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette')).toHaveCount(0);
});

test('los recientes salen arriba y se recuerdan al reabrir', async ({ page }) => {
  await bootApp(page);
  await openPalette(page);
  await runFirst(page, 'silenciar');

  await openPalette(page);
  await expect(page.getByTestId('palette-group-recent')).toBeAttached();
  expect((await itemIds(page))[0]).toBe('settings.sound');

  const stored = await page.evaluate(() => localStorage.getItem('herdr-desk.settings'));
  expect(stored).toContain('"palette_recent":["settings.sound"]');
});

test('los comandos de agente reutilizan los flujos del panel', async ({ page }) => {
  await bootApp(page);
  await openPalette(page);
  await runFirst(page, 'transcript');

  await expect
    .poll(async () => (await recordedMethodCalls(page, 'agent.read')).length)
    .toBeGreaterThanOrEqual(1);
  const [call] = await recordedMethodCalls(page, 'agent.read');
  expect(call?.params).toMatchObject({ target: 'w1:p1', source: 'recent_unwrapped', lines: 200 });
  await expect(page.getByTestId('viewer')).toBeVisible();
});

test('«ir a» un espacio, una pestaña y un panel', async ({ page }) => {
  // Dos paneles en el tab visible: el salto a un panel tiene que dejarle el foco
  // de teclado a SU terminal (T2.7).
  await bootApp(page, {
    layoutTree: {
      type: 'split',
      direction: 'right',
      ratio: 0.5,
      first: { type: 'pane', pane_id: 'w1:p1' },
      second: { type: 'pane', pane_id: 'w1:p2' },
    },
  });
  await openPalette(page);

  await runFirst(page, 'ir al espacio 2');
  // El salto es local (la TUI solo se toca con «sincronizar foco»): la sidebar
  // marca ese espacio como activo.
  await expect(page.locator('[data-testid="workspace-row"][aria-current="true"]')).toContainText(
    'docs',
  );
  await expect(page.locator('[data-testid="workspace-row"][aria-current="true"]')).toHaveCount(1);

  await openPalette(page);
  await runFirst(page, 'ir al panel w1:p2');

  // El foco de teclado queda en la terminal de ese panel (el panel enfocado).
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return (
          active?.closest('[data-testid="terminal-host"]')?.getAttribute('data-pane-id') ?? null
        );
      }),
    )
    .toBe('w1:p2');
});

test('la paleta del snapshot recién cargado no se queda vacía', async ({ page }) => {
  // Sin snapshot no hay comandos dinámicos, pero sí los curados.
  await bootApp(page, { snapshot: { ...(readSnapshotFixture() as object), agents: [] } });
  await openPalette(page);
  const ids = await itemIds(page);
  expect(ids.length).toBeGreaterThan(5);
  expect(ids).not.toContain('agent:w1:p1:transcript'); // sin agentes no hay comandos de agente
  await search(page, 'notificacion');
  await expect(
    page.locator('[data-testid="palette-item"][data-id="agents.notification_target"]'),
  ).toContainText('sin notificaciones todavía');
});

test('la barra de tareas no recibe llamadas de más con la paleta abierta', async ({ page }) => {
  await bootApp(page);
  await expect.poll(async () => (await recordedCalls(page, 'taskbar_overlay')).length).toBe(2);
  const before = (await recordedCalls(page, 'taskbar_overlay')).length;

  await openPalette(page);
  await search(page, 'panel');
  await page.waitForTimeout(700);
  expect((await recordedCalls(page, 'taskbar_overlay')).length).toBe(before);
});
