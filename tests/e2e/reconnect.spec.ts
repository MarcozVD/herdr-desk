// T1.5 — Reconexión: estado visible, backoff y botón «Iniciar servidor».

import { expect, test, type Page } from '@playwright/test';

import { bootApp, pushFrame, readSnapshotFixture, recordedCalls, terminalText } from './harness';

interface BannerSample {
  state: string;
  text: string;
}

/**
 * Registra la historia de la franja de reconexión desde el arranque de la página.
 * El estado «reintentando» es TRANSITORIO (dura el backoff, que empieza en
 * 250 ms), así que comprobarlo con el polling normal de Playwright es una
 * carrera perdida: mejor observar las mutaciones del DOM y revisar la historia.
 */
async function watchBanner(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const samples: BannerSample[] = [];
    (window as unknown as { __HD_BANNER__?: BannerSample[] }).__HD_BANNER__ = samples;
    let last = '';
    // Sondeo ligero a propósito: un MutationObserver sobre todo el documento se
    // come los frames de la terminal y ralentiza el resto de la suite.
    const timer = setInterval(() => {
      const banner = document.querySelector('[data-testid="reconnect-banner"]');
      const text =
        document.querySelector('[data-testid="reconnect-text"]')?.textContent?.trim() ?? '';
      const state = banner?.getAttribute('data-state') ?? '';
      const key = `${state}|${text}`;
      if (key === last) return;
      last = key;
      samples.push({ state, text });
    }, 50);
    setTimeout(() => clearInterval(timer), 30_000);
  });
}

async function bannerHistory(page: Page): Promise<BannerSample[]> {
  return page.evaluate(
    () => (window as unknown as { __HD_BANNER__?: BannerSample[] }).__HD_BANNER__ ?? [],
  );
}

test('sin snapshot la franja avisa, reintenta con backoff y ofrece arrancar el servidor', async ({
  page,
}) => {
  await watchBanner(page);
  await bootApp(page, { autoSnapshot: false });
  const banner = page.getByTestId('reconnect-banner');
  await expect(banner).toBeVisible();

  // «conectando» dura lo que tarda el watchdog (2,5 s); después la franja avisa
  // «desconectado · reintentando · intento N · backoff» durante el reintento.
  await expect
    .poll(
      async () =>
        (await bannerHistory(page)).some(
          (sample) => sample.text.includes('reintentando') && sample.text.includes('intento'),
        ),
      { timeout: 8000 },
    )
    .toBe(true);
  const historia = await bannerHistory(page);
  console.log(`[hd-banner] ${JSON.stringify(historia)}`);
  expect(historia.some((sample) => sample.state === 'offline')).toBe(true);
  await expect(page.getByTestId('reconnect-start-server')).toBeVisible();
  // La píldora alterna «conectando»/«desconectado» entre reintentos: lo que no
  // puede pasar sin snapshot es que diga «en línea».
  await expect(page.getByTestId('connection-pill')).not.toContainText('en línea');
});

test('«Iniciar servidor» llama a session_start y reintenta', async ({ page }) => {
  await watchBanner(page);
  await bootApp(page, { autoSnapshot: false, sessionName: 'herdr-desk-dev' });
  // Se espera al primer reintento (estado transitorio: se mira la historia).
  await expect
    .poll(async () => (await bannerHistory(page)).some((sample) => sample.state === 'offline'), {
      timeout: 8000,
    })
    .toBe(true);
  await page.getByTestId('reconnect-start-server').click();
  await expect.poll(async () => (await recordedCalls(page, 'session_start')).length).toBe(1);
  const [call] = await recordedCalls(page, 'session_start');
  expect(call).toMatchObject({ name: 'herdr-desk-dev' });
  await expect
    .poll(async () => (await recordedCalls(page, 'store_subscribe')).length)
    .toBeGreaterThan(1);
});

test('al llegar el snapshot la franja desaparece y la conexión queda en línea', async ({
  page,
}) => {
  await bootApp(page, { autoSnapshot: false });
  await expect(page.getByTestId('reconnect-banner')).toBeVisible();

  await page.evaluate((snapshot) => {
    window.__HD_TEST__?.pushSnapshot(snapshot);
  }, readSnapshotFixture());

  await expect(page.getByTestId('reconnect-banner')).toHaveCount(0);
  await expect(page.getByTestId('connection-pill')).toContainText('en línea');
  await expect(page.getByTestId('pane-frame')).toHaveCount(1);
});

test('tras reconectar se vuelve a pedir el layout y el bridge', async ({ page }) => {
  await bootApp(page, { autoSnapshot: false });
  await expect(page.getByTestId('reconnect-banner')).toBeVisible();
  await page.evaluate((snapshot) => {
    window.__HD_TEST__?.pushSnapshot(snapshot);
  }, readSnapshotFixture());
  await expect(page.getByTestId('terminal-host')).toHaveAttribute('data-bridge', 'open');
  await expect
    .poll(async () => (await recordedCalls(page, 'terminal_open')).length)
    .toBeGreaterThan(0);
});

test('la franja muestra el nombre de la sesión activa', async ({ page }) => {
  await bootApp(page, { autoSnapshot: false, sessionName: 'herdr-desk-dev' });
  await expect(page.getByTestId('reconnect-session')).toContainText('herdr-desk-dev');
});

test('«Iniciar servidor» enseña el mensaje REAL del backend, no «no expone X»', async ({
  page,
}) => {
  await bootApp(page, {
    autoSnapshot: false,
    sessionName: 'default',
    sessionStartError: {
      code: 'invalid_params',
      message: 'no se permite iniciar la sesion default desde la GUI',
    },
  });
  await page.getByTestId('reconnect-start-server').click();

  await expect(page.getByTestId('reconnect-error')).toContainText(
    'no se permite iniciar la sesion default desde la GUI',
  );
  await expect(page.getByTestId('toast-host')).toContainText(
    'no se permite iniciar la sesion default desde la GUI',
  );
  await expect(page.getByTestId('toast-host')).not.toContainText('todavía no expone');
  const [call] = await recordedCalls(page, 'session_start');
  expect(call).toMatchObject({ name: 'default' });
});

test('si el command falta de verdad, el aviso sigue siendo el de §5', async ({ page }) => {
  await bootApp(page, { autoSnapshot: false, sessionStartError: 'missing' });
  await page.getByTestId('reconnect-start-server').click();
  await expect(page.getByTestId('toast-host')).toContainText('no expone');
  await expect(page.getByTestId('reconnect-error')).toContainText('no expone');
});

test('sin session_current no se llama a session_start con nombre vacío', async ({ page }) => {
  await bootApp(page, { autoSnapshot: false, sessionCurrentMissing: true });

  // El botón deja de arrancar a ciegas: pide elegir sesión.
  await expect(page.getByTestId('reconnect-start-server')).toHaveCount(0);
  await expect(page.getByTestId('reconnect-choose-session')).toBeVisible();
  await expect(page.getByTestId('reconnect-session')).toContainText('sin sesión');

  await page.getByTestId('reconnect-choose-session').click();
  await expect(page.getByTestId('session-list')).toBeVisible();
  expect(await recordedCalls(page, 'session_start')).toHaveLength(0);
});

test('si session_current existe, el nombre se resuelve y se usa al arrancar', async ({ page }) => {
  await bootApp(page, { autoSnapshot: false, sessionName: 'herdr-desk-dev' });
  await expect(page.getByTestId('reconnect-session')).toContainText('herdr-desk-dev');
  await page.getByTestId('reconnect-start-server').click();
  await expect.poll(async () => (await recordedCalls(page, 'session_start')).length).toBe(1);
  const [call] = await recordedCalls(page, 'session_start');
  expect(call).toMatchObject({ name: 'herdr-desk-dev' });
});

test('si el servidor se cae, la UI lo nota y reabre los paneles al volver', async ({ page }) => {
  // Gracia de reenganche larga: así el reenganche por frames es el único camino
  // posible y el conteo de `terminal_open` no compite con el temporizador.
  await page.addInitScript(() => {
    localStorage.setItem('herdr-desk.settings', JSON.stringify({ bridge_reopen_grace_ms: 15_000 }));
  });
  await bootApp(page);
  await expect(page.getByTestId('terminal-host')).toHaveAttribute('data-bridge', 'open');

  // El bridge se cierra porque el server se fue (el store del backend no avisa).
  await page.evaluate(() => window.__HD_TEST__?.pushClosed('server is shutting down'));
  await expect(page.getByTestId('reconnect-banner')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('reconnect-error')).toContainText('server is shutting down');
  await expect(page.getByTestId('terminal-reconnecting')).toBeVisible();
  await expect(page.getByTestId('terminal-host')).toHaveAttribute('data-bridge', 'reconnecting');

  // Vuelve el server: el backend respawnea con el mismo bridge/Channel y los
  // frames devuelven el panel a «open» sin volver a atachar (evita «taken over»).
  await pushFrame(page, { text: 'tras la caida', seq: 2, full: true });
  await expect(page.getByTestId('terminal-host')).toHaveAttribute('data-bridge', 'open');
  await expect(page.getByTestId('terminal-overlay')).toHaveCount(0);
  await expect.poll(async () => (await terminalText(page)).includes('tras la caida')).toBe(true);
  // El panel vuelve con los frames del respawn. El número exacto de
  // `terminal_open` puede ser 1 (se reengancha por frames) o 2 si además lo
  // pidió la UI al recuperar la conexión; lo que se fija es que no hay
  // tormenta de reattaches (el original + como mucho uno).
  const opens = await recordedCalls(page, 'terminal_open');
  expect(opens.length).toBeGreaterThanOrEqual(1);
  expect(opens.length).toBeLessThanOrEqual(2);
});

test('un cierre normal (terminal terminada) NO se toma como caída', async ({ page }) => {
  await bootApp(page);
  await page.evaluate(() => window.__HD_TEST__?.pushClosed('terminal term_x exited'));
  await expect(page.getByTestId('terminal-close-reason')).toContainText('term_x exited');
  await expect(page.getByTestId('reconnect-banner')).toHaveCount(0);
});

test('si el respawn no manda frames, el pool reengancha solo el bridge', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('herdr-desk.settings', JSON.stringify({ bridge_reopen_grace_ms: 600 }));
  });
  await bootApp(page);
  await expect(page.getByTestId('terminal-host')).toHaveAttribute('data-bridge', 'open');

  await page.evaluate(() => window.__HD_TEST__?.pushClosed('server is shutting down'));
  await expect(page.getByTestId('terminal-host')).toHaveAttribute('data-bridge', 'reconnecting');

  // Nadie manda frames: pasada la gracia el pool pide un bridge nuevo.
  await expect(page.getByTestId('terminal-host')).toHaveAttribute('data-bridge', 'open', {
    timeout: 6000,
  });
  await expect(page.getByTestId('terminal-overlay')).toHaveCount(0);
  await expect.poll(async () => (await recordedCalls(page, 'terminal_open')).length).toBe(2);
});
