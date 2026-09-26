import '@fontsource-variable/geist';
import '@fontsource-variable/jetbrains-mono';
import './app.css';

import { mount } from 'svelte';

import App from './App.svelte';
import { uiReady } from './lib/herdr/client';
import { keymap } from './lib/keys/keymap';
import { session } from './lib/stores/session.svelte';
import { settings } from './lib/stores/settings.svelte';
import { ui } from './lib/stores/ui.svelte';
import { loadTerminalFont, whenFontsReady } from './lib/terminal/font';
import { pool } from './lib/terminal/pool';

declare global {
  interface Window {
    /** Config del arnés e2e (tests/e2e/harness.ts). Solo en dev. */
    __HD_HARNESS__?: { snapshot?: unknown; sessionName?: string | null };
  }
}

async function boot(): Promise<void> {
  // Arnés de Playwright: se instala antes de montar para que el mock del IPC
  // exista cuando la app haga su primera llamada. En el build de producción
  // `import.meta.env.DEV` es false y el import dinámico se elimina.
  if (import.meta.env.DEV && window.__HD_HARNESS__) {
    const { installHarness } = await import('./lib/testing/harness');
    installHarness();
  }

  settings.load();
  settings.applyTheme();
  keymap.load();
  // La sidebar arranca colapsada si así lo pide la configuración.
  ui.setSidebarCollapsed(settings.values.sidebar_start_collapsed);

  mount(App, { target: document.getElementById('app') as HTMLElement });

  // Un bridge que se cierra NO es una caída del servidor: es ese panel, y el
  // pool se encarga de él (reenganche o «Retomar control»). Si esto marcara la
  // sesión offline, cerrar una terminal —o que su PTY muriera— tumbaba la app
  // entera. La caída real la detectan el store, el watchdog del snapshot y el
  // latido (`session.ping` cada HEARTBEAT_MS).
  pool.subscribe({
    onOutage: (paneId, reason) => {
      console.warn(`[herdr-desk] bridge de ${paneId} caído: ${reason}`);
    },
  });

  void session.bootstrap();

  // Tipografía de la terminal: la familia la resuelve el backend (`gui_defaults`,
  // la misma que usa Windows Terminal) con fallback local. Cuando llega se
  // repinta lo ya abierto y, con las fuentes del sistema cargadas, se rehace el
  // `fit` para que las celdas queden cuadradas.
  void (async () => {
    const font = await loadTerminalFont();
    pool.applyFont(font);
    await whenFontsReady();
    pool.refitAll();
  })();

  // `ui_ready` hace window.show() en el backend y cierra el cronómetro de
  // arranque: se manda con el primer frame ya pintado.
  requestAnimationFrame(() => {
    void uiReady().catch(() => undefined);
  });
}

void boot();
