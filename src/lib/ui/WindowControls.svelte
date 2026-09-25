<!-- Controles de ventana (la ventana es sin marco: R2). Los permisos vienen de
     capabilities/default.json del backend. -->
<script lang="ts">
  import { Minus, Square, X } from '@lucide/svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  import { es } from '../i18n/es';

  // getCurrentWindow() se resuelve al hacer clic y no al importar el módulo: así
  // el arnés de e2e (que instala __TAURI_INTERNALS__ después del import) puede
  // cubrir también los botones de ventana.
  function minimize(): void {
    void getCurrentWindow().minimize();
  }

  function toggleMaximize(): void {
    void getCurrentWindow().toggleMaximize();
  }

  function close(): void {
    void getCurrentWindow().close();
  }
</script>

<div class="window-controls">
  <button
    type="button"
    data-testid="window-minimize"
    title={es.titlebar.minimize}
    aria-label={es.titlebar.minimize}
    onclick={minimize}
  >
    <Minus size={14} aria-hidden="true" />
  </button>
  <button
    type="button"
    data-testid="window-maximize"
    title={es.titlebar.maximize}
    aria-label={es.titlebar.maximize}
    onclick={toggleMaximize}
  >
    <Square size={12} aria-hidden="true" />
  </button>
  <button
    type="button"
    data-action="close"
    data-testid="window-close"
    title={es.titlebar.close}
    aria-label={es.titlebar.close}
    onclick={close}
  >
    <X size={15} aria-hidden="true" />
  </button>
</div>
