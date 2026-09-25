import { defineConfig, devices } from '@playwright/test';

// E2E sin herdr real: la app se sirve con Vite y el IPC de Tauri se simula con
// mockIPC (@tauri-apps/api/mocks), así las pruebas corren sin la ventana nativa.
//
// Canal del navegador: por defecto `msedge` (viene con Windows 11) porque la
// descarga de Chromium del CDN de Playwright está bloqueada en esta red. Se
// puede forzar otro con PW_CHANNEL (p. ej. PW_CHANNEL=chromium).
const channel = (process.env.PW_CHANNEL ?? 'msedge') as 'msedge' | 'chrome' | 'chromium';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // El frontend se sirve con el dev server de Vite y cada worker levanta su
  // propio Edge: con 4 workers en paralelo la cola de tareas de Vite se satura y
  // aparecen timeouts falsos.
  workers: process.env.CI ? 1 : 2,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:1420',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: channel,
      use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
