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

  // Si un bridge se cierra porque el servidor desapareció, la UI lo toma como
  // caída de conexión: pasa a «desconectado», reintenta y reabre los paneles.
  pool.subscribe({
    onOutage: (_paneId, reason) => session.noteOutage(reason),
  });

  void session.bootstrap();

  // `ui_ready` hace window.show() en el backend y cierra el cronómetro de
  // arranque: se manda con el primer frame ya pintado.
  requestAnimationFrame(() => {
    void uiReady().catch(() => undefined);
  });
}

void boot();
