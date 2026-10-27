import { defineConfig, devices } from '@playwright/test';

// E2E sin herdr real: la app se compila una vez (`vite build --mode e2e`) y se
// sirve estática con `vite preview`; el IPC de Tauri se simula con mockIPC
// (@tauri-apps/api/mocks), así las pruebas corren sin la ventana nativa.
//
// Antes se usaba el dev server de Vite. Con 2 workers eso era una carrera: al
// descubrir un import dinámico tarde, el optimizador de dependencias reconstruía
// y recargaba TODAS las páginas a media prueba (los fallos intermitentes
// aparecían como inputs vacíos o diálogos que desaparecían). El build estático
// no reoptimiza, no vigila archivos y no recarga.
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
  // Cada worker levanta su propio Edge. Con el build estático el servidor solo
  // entrega archivos; 2 workers siguen siendo el techo razonable en esta máquina.
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
    // `build:e2e` incluye el arnés (modo e2e) una sola vez; preview sirve dist/.
    command: 'pnpm e2e:serve',
    url: 'http://localhost:1420',
    // Nunca reutilizar un dev server: serviría otro build (o ninguno) y vuelve
    // la carrera. Si el puerto está ocupado, es mejor fallar que medir otra app.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
