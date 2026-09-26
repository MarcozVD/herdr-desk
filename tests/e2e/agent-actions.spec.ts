// T2.2/T2.3 — Acciones de agente desde el panel (menú de la fila), con el
// cliente RPC simulado: se comprueba que cada acción sale con sus parámetros y
// que el diálogo de arranque usa los tipos del CLI.

import { expect, test } from '@playwright/test';

import { bootApp, recordedMethodCalls } from './harness';

/** Parámetros de cada llamada hecha a `method`, en orden de llegada. */
async function paramsOf(page: import('@playwright/test').Page, method: string): Promise<unknown[]> {
  return (await recordedMethodCalls(page, method)).map((call) => call.params);
}

test.use({ viewport: { width: 1280, height: 800 } });

/** Abre el menú contextual de la primera fila del panel de agentes. */
async function openRowMenu(page: import('@playwright/test').Page, index = 0): Promise<void> {
  await page.getByTestId('agent-row').nth(index).click({ button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
}

/** Pulsa una entrada del menú contextual por su id (data-id del botón). */
async function clickMenuItem(page: import('@playwright/test').Page, id: string): Promise<void> {
  await page.locator(`[data-testid="context-item"][data-id="${id}"]`).click();
}

test('enfocar agente: agent.focus con el panel como destino', async ({ page }) => {
  await bootApp(page);
  await openRowMenu(page);
  await clickMenuItem(page, 'agent-focus');

  await expect.poll(() => paramsOf(page, 'agent.focus')).toContainEqual({ target: 'w1:p1' });
});

test('prompt: sin espera manda texto y wait nulo', async ({ page }) => {
  await bootApp(page);
  await openRowMenu(page);
  await clickMenuItem(page, 'agent-prompt');

  await page.getByTestId('agent-prompt-text').fill('  arregla el test  ');
  await page.getByTestId('agent-prompt-send').click();

  await expect
    .poll(() => paramsOf(page, 'agent.prompt'))
    .toContainEqual({ target: 'w1:p1', text: 'arregla el test', wait: null });
  await expect(page.getByTestId('agent-prompt')).toHaveCount(0);
});

test('prompt: con espera manda until y timeout', async ({ page }) => {
  await bootApp(page);
  await openRowMenu(page);
  await clickMenuItem(page, 'agent-prompt');

  await page.getByTestId('agent-prompt-text').fill('hazlo y avisa');
  await page.getByTestId('agent-prompt-wait').check();
  await page.getByTestId('agent-prompt-until').selectOption('done');
  await page.getByTestId('agent-prompt-timeout').fill('12000');
  await page.getByTestId('agent-prompt-send').click();

  await expect
    .poll(() => paramsOf(page, 'agent.prompt'))
    .toContainEqual({
      target: 'w1:p1',
      text: 'hazlo y avisa',
      wait: { until: ['done'], timeout_ms: 12000 },
    });
});

test('teclas del plan: Escape y Ctrl+C', async ({ page }) => {
  await bootApp(page);
  await openRowMenu(page);
  await clickMenuItem(page, 'agent-escape');
  await expect
    .poll(() => paramsOf(page, 'agent.send_keys'))
    .toContainEqual({ target: 'w1:p1', keys: ['esc'] });

  await openRowMenu(page);
  await clickMenuItem(page, 'agent-interrupt');
  await expect
    .poll(() => paramsOf(page, 'agent.send_keys'))
    .toContainEqual({ target: 'w1:p1', keys: ['ctrl+c'] });
});

test('renombrar: valida el nombre y llama a agent.rename', async ({ page }) => {
  await bootApp(page);
  await openRowMenu(page);
  await clickMenuItem(page, 'agent-rename');

  // Nombre inválido: el botón de aceptar está deshabilitado.
  await page.getByTestId('prompt-input').fill('MAL');
  await expect(page.getByTestId('prompt-accept')).toBeDisabled();
  await page.getByTestId('prompt-input').fill('hd-nuevo');
  await page.getByTestId('prompt-accept').click();

  await expect
    .poll(() => paramsOf(page, 'agent.rename'))
    .toContainEqual({ target: 'w1:p1', name: 'hd-nuevo' });
});

test('transcript: agent.read de 200 líneas y visor con búsqueda', async ({ page }) => {
  await bootApp(page);
  await openRowMenu(page);
  await clickMenuItem(page, 'agent-transcript');

  await expect
    .poll(() => paramsOf(page, 'agent.read'))
    .toContainEqual({
      target: 'w1:p1',
      source: 'recent_unwrapped',
      lines: 200,
      format: 'text',
      strip_ansi: true,
    });

  const viewer = page.getByTestId('viewer');
  await expect(viewer).toBeVisible();
  await expect(page.getByTestId('viewer-body')).toContainText('hola desde el transcript');

  // La búsqueda marca coincidencias sin filtrar el texto.
  await page.getByTestId('viewer-search').fill('segunda');
  await expect(page.getByTestId('viewer-matches')).toHaveText('1 coincidencias');
  await expect(page.getByTestId('viewer-body')).toContainText('hola desde el transcript');
});

test('esperar y explicar: agent.wait y agent.explain', async ({ page }) => {
  await bootApp(page);
  await openRowMenu(page);
  await clickMenuItem(page, 'agent-wait-idle');
  await expect
    .poll(() => paramsOf(page, 'agent.wait'))
    .toContainEqual({ target: 'w1:p1', until: ['idle'], timeout_ms: 30_000 });

  await openRowMenu(page);
  await clickMenuItem(page, 'agent-explain');
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expect(page.getByTestId('viewer-body')).toContainText('"matched_rule": "hd-bot"');
});

test('soltar agente: confirma y llama a pane.release_agent', async ({ page }) => {
  await bootApp(page);
  await openRowMenu(page);
  await clickMenuItem(page, 'agent-release');

  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-accept').click();

  await expect
    .poll(() => paramsOf(page, 'pane.release_agent'))
    .toContainEqual({
      pane_id: 'w1:p1',
      source: 'custom:herdr-desk',
      agent: 'hd-bot',
    });
});

test('atajos: next_agent y focus_agent:N enfocan por la cola de atención', async ({ page }) => {
  await bootApp(page);
  // Los atajos de agente vienen sin asignar en la config por defecto de herdr:
  // se asignan aquí para poder pulsarlos (el motor de atajos es el de la app).
  await page.evaluate(async () => {
    // Ruta construida para que el import sea dinámico de verdad (el módulo lo
    // sirve Vite en desarrollo y ya está cargado por la app).
    const modulePath = `${'/src/lib/keys/keymap'}.ts`;
    const mod = (await import(/* @vite-ignore */ modulePath)) as {
      keymap: { load: (overrides: { bindings: Record<string, string> }) => void };
    };
    mod.keymap.load({ bindings: { next_agent: 'ctrl+shift+ArrowDown' } });
  });
  await page.locator('body').press('Control+Shift+ArrowDown');

  // La cola de atención empieza por el bloqueado (w2:p1).
  await expect.poll(() => paramsOf(page, 'agent.focus')).toContainEqual({ target: 'w2:p1' });
});

test('iniciar agente: tipos del CLI, arranque y reporte', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('pane-menu').first().click();
  await clickMenuItem(page, 'start-agent');

  const dialog = page.getByTestId('start-agent');
  await expect(dialog).toBeVisible();
  // Los tipos vienen del command agent_kinds (el harness simula tres).
  await expect(page.getByTestId('start-agent-kind')).toHaveValue('claude');
  const kinds = await page.getByTestId('start-agent-kind').locator('option').allInnerTexts();
  expect(kinds).toEqual(['claude', 'opencode', 'aider']);

  // El nombre por defecto sale del tipo, y se puede cambiar.
  await expect(page.getByTestId('start-agent-name')).toHaveValue('claude');
  await page.getByTestId('start-agent-name').fill('hd-nuevo');
  await page.getByTestId('start-agent-args').fill('--flag "valor con espacios"');
  await page.getByTestId('start-agent-submit').click();

  await expect
    .poll(() => paramsOf(page, 'agent.start'))
    .toContainEqual({
      pane_id: 'w1:p1',
      kind: 'claude',
      name: 'hd-nuevo',
      args: ['--flag', 'valor con espacios'],
      timeout_ms: 30_000,
    });
  await expect
    .poll(() => paramsOf(page, 'pane.report_agent'))
    .toContainEqual({
      pane_id: 'w1:p1',
      source: 'custom:herdr-desk',
      agent: 'claude',
      state: 'working',
    });
  await expect(dialog).toHaveCount(0);
});

test('iniciar agente: sin tipos del CLI cae a entrada libre con el motivo', async ({ page }) => {
  await bootApp(page, {
    // El backend devuelve motivo y lista vacía cuando no puede leer la ayuda.
    agentKinds: { kinds: [], reason: 'no se pudo ejecutar la ayuda: CLI ausente', cached: false },
  });
  await page.getByTestId('pane-menu').first().click();
  await clickMenuItem(page, 'start-agent');

  await expect(page.getByTestId('start-agent-reason')).toContainText(
    'no se pudo ejecutar la ayuda',
  );
  // Entrada libre: se puede escribir el comando a mano.
  await page.getByTestId('start-agent-kind').fill('mi-agente');
  await page.getByTestId('start-agent-submit').click();
  await expect
    .poll(() => paramsOf(page, 'agent.start'))
    .toContainEqual({
      pane_id: 'w1:p1',
      kind: 'mi-agente',
      name: 'mi-agente',
      args: [],
      timeout_ms: 30_000,
    });
});
