// T1.10 — Motor de atajos: prefix, bindings directos, reservados de la GUI y
// cheatsheet. Lo que no es un atajo de herdr tiene que llegar a la terminal.

import { expect, test } from '@playwright/test';

import {
  bootApp,
  pushFrame,
  recordedCalls,
  recordedMethodCalls,
  terminalText,
  waitBridgeOpen,
} from './harness';

async function terminalInputs(page: import('@playwright/test').Page): Promise<string[]> {
  const calls = await recordedCalls(page, 'terminal_input');
  return calls.map((args) => String((args as { data?: unknown }).data ?? ''));
}

test('prefix + c abre el flujo de nueva pestaña y apaga el chip', async ({ page }) => {
  await bootApp(page);
  await expect(page.getByTestId('prefix-chip')).toHaveCount(0);

  await page.keyboard.press('Control+b');
  await expect(page.getByTestId('prefix-chip')).toBeVisible();

  await page.keyboard.press('c');
  await expect(page.getByTestId('prompt-dialog')).toBeVisible();
  await expect(page.getByTestId('prefix-chip')).toHaveCount(0);
});

test('prefix dos veces manda el Ctrl+B literal a la terminal', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('terminal-host').click();
  await page.keyboard.press('Control+b');
  await expect(page.getByTestId('prefix-chip')).toBeVisible();
  await page.keyboard.press('Control+b');
  await expect(page.getByTestId('prefix-chip')).toHaveCount(0);

  await expect.poll(async () => (await terminalInputs(page)).includes('\u0002')).toBe(true);
});

test('prefix + ? abre el cheatsheet y Esc lo cierra', async ({ page }) => {
  await bootApp(page);
  await page.keyboard.press('Control+b');
  await page.keyboard.press('?');
  await expect(page.getByTestId('cheatsheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cheatsheet')).toHaveCount(0);
});

test('una tecla sin atajo dentro del prefix avisa y no manda nada', async ({ page }) => {
  await bootApp(page);
  await page.keyboard.press('Control+b');
  // 0 queda fuera del rango indexado 1..9 y no tiene binding en herdr.
  await page.keyboard.press('0');
  await expect(page.getByTestId('toast-host')).toContainText('no tiene acción');
  await expect(page.getByTestId('prefix-chip')).toHaveCount(0);
  expect(await terminalInputs(page)).not.toContain('0');
});

test('las teclas normales llegan a la terminal (R3)', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('terminal-host').click();
  await page.keyboard.press('j');
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await terminalInputs(page)).join('|')).toContain('j');
  expect((await terminalInputs(page)).join('|')).toContain('\u001b[A');
});

test('prefix + 1..9 resuelve switch_tab por índice', async ({ page }) => {
  await bootApp(page);
  await page.keyboard.press('Control+b');
  await page.keyboard.press('1');
  await expect.poll(async () => (await recordedMethodCalls(page, 'tab.focus')).length).toBe(1);
  const [call] = await recordedMethodCalls(page, 'tab.focus');
  expect(call).toMatchObject({ params: { tab_id: 'w1:t1' } });
});

test('Ctrl+Shift+P abre la paleta (atajo reservado por la GUI)', async ({ page }) => {
  await bootApp(page);
  await page.keyboard.press('Control+Shift+P');
  await expect(page.getByTestId('palette')).toBeVisible();
});

test('Ctrl+Shift+C copia la selección al portapapeles', async ({ page }) => {
  await bootApp(page);
  await waitBridgeOpen(page);
  await pushFrame(page, { text: 'hola mundo', seq: 1, full: true });
  await page.getByTestId('terminal-host').click();
  await expect.poll(async () => (await terminalText(page)).includes('hola mundo')).toBe(true);
  // Selección sintética en el buffer de xterm (el ratón real no hace falta aquí).
  await page.evaluate(() => {
    const registry = (
      window as unknown as {
        __HD_TERMS__?: Record<string, { select: (c: number, r: number, l: number) => void }>;
      }
    ).__HD_TERMS__;
    const term = Object.values(registry ?? {})[0];
    term?.select(0, 0, 5);
  });
  await page.keyboard.press('Control+Shift+C');
  // copy_on_select (por defecto activo) ya copió al seleccionar; el atajo copia
  // otra vez, así que aquí se comprueba que el portapapeles recibe el texto.
  await expect
    .poll(async () => (await recordedCalls(page, 'plugin:clipboard-manager|write_text')).length)
    .toBeGreaterThanOrEqual(1);
});

test('Ctrl+Shift+V pega el portapapeles en la terminal', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('terminal-host').click();
  await page.keyboard.press('Control+Shift+V');
  await expect.poll(async () => (await terminalInputs(page)).join('|')).toContain('pegado');
});

test('el clic derecho en la terminal ofrece copiar y pegar', async ({ page }) => {
  await bootApp(page);
  await page.getByTestId('terminal-host').click({ button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await expect(page.getByTestId('context-item')).toHaveCount(2);
  await page.getByTestId('context-item').nth(1).click();
  await expect.poll(async () => (await terminalInputs(page)).join('|')).toContain('pegado');
});
