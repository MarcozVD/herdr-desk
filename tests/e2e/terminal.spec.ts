// Terminal real (xterm.js) sobre el bridge simulado: frames, input (R3),
// resize, rueda y cierre del bridge.

import { expect, test } from '@playwright/test';

import {
  bootApp,
  pasteIntoTerminal,
  pushFrame,
  readSnapshotFixture,
  recordedCalls,
  terminalText,
} from './harness';

test('la terminal pinta los frames ANSI del bridge', async ({ page }) => {
  await bootApp(page);
  const host = page.getByTestId('terminal-host');
  await expect(host).toHaveAttribute('data-bridge', 'open');
  await expect(host).toHaveAttribute('data-pane-id', 'w1:p1');

  const opens = await recordedCalls(page, 'terminal_open');
  expect(opens).toHaveLength(1);
  expect(opens[0]?.paneId).toBe('w1:p1');
  expect(Number(opens[0]?.cols)).toBeGreaterThan(0);
  expect(Number(opens[0]?.rows)).toBeGreaterThan(0);

  await pushFrame(page, { text: 'PS C:\\Users\\dev\\Documents\\herdr> ', seq: 1 });
  await expect.poll(() => terminalText(page)).toContain('PS C:\\Users\\dev\\Documents\\herdr>');

  // Un frame full descarta lo anterior y se escribe igual (viewport completo).
  await pushFrame(page, { text: '\x1b[2J\x1b[Hhola herdr', seq: 2, full: true });
  await expect.poll(() => terminalText(page)).toContain('hola herdr');
});

test('R3: el input se reenvía byte a byte (flechas de PSReadLine, Ctrl+C, Enter)', async ({
  page,
}) => {
  await bootApp(page);
  await expect(page.getByTestId('terminal-host')).toHaveAttribute('data-bridge', 'open');
  await page.getByTestId('terminal-host').click();

  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+c');
  await page.keyboard.type('dir');
  await page.keyboard.press('Enter');

  const sent = (await recordedCalls(page, 'terminal_input')).map((args) => String(args.data));
  expect(sent.join('')).toBe('\u001b[A\u001b[B\u0003dir\r');
});

test('R3: el pegado multilínea llega completo en un solo input', async ({ page }) => {
  await bootApp(page);
  await expect(page.getByTestId('terminal-host')).toHaveAttribute('data-bridge', 'open');

  await pasteIntoTerminal(page, 'echo uno\necho dos\necho tres');

  const sent = (await recordedCalls(page, 'terminal_input')).map((args) => String(args.data));
  expect(sent).toHaveLength(1);
  // xterm normaliza \r?\n a \r; sin bracketed paste (los frames de opencode no
  // traían DEC 2004) el texto NO se envuelve en \x1b[200~…\x1b[201~. Las tres
  // líneas llegan en un solo input, separadas por CR.
  expect(sent[0]).toBe('echo uno\recho dos\recho tres');
});

test('R3: las teclas previas a la apertura del bridge no se pierden', async ({ page }) => {
  await bootApp(page, { terminalOpenDelayMs: 400 });
  await page.getByTestId('terminal-host').click();
  await page.keyboard.type('abc');

  await expect(page.getByTestId('terminal-host')).toHaveAttribute('data-bridge', 'open');
  await expect
    .poll(async () => (await recordedCalls(page, 'terminal_input')).length)
    .toBeGreaterThan(0);
  const sent = (await recordedCalls(page, 'terminal_input')).map((args) => String(args.data));
  expect(sent.join('')).toBe('abc');
});

test('resize: la ventana redimensiona la terminal y avisa al bridge', async ({ page }) => {
  await bootApp(page);
  await expect(page.getByTestId('terminal-host')).toHaveAttribute('data-bridge', 'open');

  await page.setViewportSize({ width: 900, height: 620 });
  await expect
    .poll(async () => (await recordedCalls(page, 'terminal_resize')).length, { timeout: 5000 })
    .toBeGreaterThan(0);

  const resizes = await recordedCalls(page, 'terminal_resize');
  const last = resizes[resizes.length - 1];
  console.log(
    `[hd-perf] resize -> terminal_resize cols=${last?.cols} rows=${last?.rows} (llamadas=${resizes.length})`,
  );
  expect(Number(last?.cols)).toBeGreaterThan(0);
  expect(Number(last?.rows)).toBeGreaterThan(0);
  expect(Number(last?.cols)).toBeLessThan(200);
});

test('la rueda pide el scroll a herdr (el scrollback vive en el server)', async ({ page }) => {
  // Panel sin agente (shell): el scrollback lo lleva herdr.
  const snapshot = readSnapshotFixture() as { panes: Array<Record<string, unknown>> };
  for (const pane of snapshot.panes) if (pane.pane_id === 'w1:p1') pane.agent = null;
  await bootApp(page, { snapshot });
  await expect(page.getByTestId('terminal-host')).toHaveAttribute('data-bridge', 'open');

  await page.getByTestId('terminal-host').hover();
  await page.mouse.wheel(0, -240);

  await expect
    .poll(async () => (await recordedCalls(page, 'terminal_scroll')).length)
    .toBeGreaterThan(0);
  const scrolls = await recordedCalls(page, 'terminal_scroll');
  expect(scrolls[0]?.direction).toBe('up');
  expect(scrolls[0]?.lines).toBe(3);
});

test('en un agente TUI sin scrollback la rueda va a la app (scroll de opencode)', async ({
  page,
}) => {
  // w1:p1 del fixture tiene agente (hd-bot) y `max_offset_from_bottom: 0`: la
  // rueda se manda como SGR de ratón a la app, no como scroll de herdr.
  await bootApp(page);
  await expect(page.getByTestId('terminal-host')).toHaveAttribute('data-bridge', 'open');

  await page.getByTestId('terminal-host').hover();
  await page.mouse.wheel(0, -240);

  await expect
    .poll(async () =>
      (await recordedCalls(page, 'terminal_input')).map((args) => String(args.data)).join(''),
    )
    .toContain('\x1b[<64;');
  expect(await recordedCalls(page, 'terminal_scroll')).toEqual([]);
});

test('un terminal.closed muestra el motivo, sin botón manual', async ({ page }) => {
  await bootApp(page);
  await expect(page.getByTestId('terminal-host')).toHaveAttribute('data-bridge', 'open');

  await page.evaluate(() => window.__HD_TEST__?.pushClosed('stream_conflict'));

  const overlay = page.getByTestId('terminal-overlay');
  await expect(overlay).toHaveAttribute('data-kind', 'closed');
  await expect(page.getByTestId('terminal-close-reason')).toContainText('stream_conflict');
  await expect(page.getByRole('button', { name: 'Retomar control' })).toHaveCount(0);
});

test('sin snapshot no hay terminal abierta', async ({ page }) => {
  await bootApp(page, { snapshot: null });
  await expect(page.getByTestId('no-pane')).toBeVisible();
  expect(await recordedCalls(page, 'terminal_open')).toHaveLength(0);
});
