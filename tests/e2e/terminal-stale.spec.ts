// T2.8 — Regresión del bug de render medido en la app real: un panel cuyo
// bridge no manda frames (el backend reusa el canal de una webview anterior)
// se ve pero no pinta nada, aunque el input funcione. El pool tiene que
// notarlo, decirlo y reabrir el bridge desde cero (después de la gracia de
// cierre) para estrenar canal.

import { expect, test } from '@playwright/test';

import { bootApp, pushFrame, recordedCalls, terminalText } from './harness';

test.use({ viewport: { width: 1280, height: 800 } });

async function bridgeStates(page: import('@playwright/test').Page): Promise<string[]> {
  return page.$$eval('[data-testid="terminal-host"]', (hosts) =>
    hosts.map((host) => (host as HTMLElement).dataset.bridge ?? ''),
  );
}

test('un bridge que no manda frames se reabre solo y acaba pintando', async ({ page }) => {
  await bootApp(page, { staleBridgeFirstOpen: true });

  // El primer bridge no manda nada: el pool lo detecta y lo dice en la UI.
  await expect(page.getByTestId('terminal-overlay')).toContainText('reabriendo', {
    timeout: 5000,
  });

  // Y reabre: el segundo terminal_open es un bridge nuevo.
  // `terminal_open` es un command de Tauri, no un método del pipe.
  await expect
    .poll(async () => (await recordedCalls(page, 'terminal_open')).length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2);
  const opens = await recordedCalls(page, 'terminal_open');
  expect(opens[1]?.paneId).toBe(opens[0]?.paneId);

  // El canal nuevo sí manda frames: el panel pinta y queda «open».
  await pushFrame(page, { text: 'contenido tras reabrir', full: true });
  await expect.poll(async () => terminalText(page)).toContain('contenido tras reabrir');
  await expect.poll(async () => bridgeStates(page)).toEqual(['open']);
});

test('un bridge sano no se reabre', async ({ page }) => {
  await bootApp(page);

  await expect.poll(async () => bridgeStates(page)).toEqual(['open']);
  await page.waitForTimeout(2500); // más que el vigilante
  expect(await recordedCalls(page, 'terminal_open')).toHaveLength(1);
});
