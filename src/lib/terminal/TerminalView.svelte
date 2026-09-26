<!-- Terminal de un panel: instancia de xterm del pool sobre el bridge de herdr.
     Reglas del §4/§7:
     - los frames NO entran en la reactividad: van a xterm por FrameWriter (pool)
     - un frame `full` descarta los frames anteriores en cola
     - el input se reenvía tal cual llega (R3): flechas, Ctrl+C y pegado multilínea
     - el foco es local (R11): el clic enfoca la terminal, no manda IPC a herdr
     - solo los panes VISIBLES tienen bridge (`active`), el resto se libera -->
<script lang="ts">
  import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
  import { onMount } from 'svelte';

  import '@xterm/xterm/css/xterm.css';

  import { es } from '../i18n/es';
  import { session } from '../stores/session.svelte';
  import { settings } from '../stores/settings.svelte';
  import { ui } from '../stores/ui.svelte';
  import { pool } from './pool';
  import type { BridgeState, TerminalEntry, TerminalViewState } from './pool';
  import TerminalScrollbar from './TerminalScrollbar.svelte';

  interface Props {
    paneId: string;
    /** Panes visibles: solo ellos tienen bridge abierto. */
    active?: boolean;
  }

  let { paneId, active = true }: Props = $props();

  let host = $state<HTMLDivElement | null>(null);
  let ready = $state(false);
  let bridgeState = $state<BridgeState>('idle');
  let closeReason = $state('');
  let errorText = $state('');

  const scroll = $derived(session.panes.find((pane) => pane.pane_id === paneId)?.scroll ?? null);

  // Fuera de la reactividad: entrada del pool, vista actual y handles.
  let entry: TerminalEntry | null = null;
  let view: TerminalViewState | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSize = { cols: 0, rows: 0 };
  let frameTotal = 0;

  function syncFromEntry(source: TerminalEntry): void {
    bridgeState = source.state;
    closeReason = source.closeReason;
    errorText = source.errorText;
  }

  function registerTestTerminal(id: string, term: TerminalViewState['terminal']): void {
    if (!import.meta.env.DEV) return;
    const registry = window as unknown as { __HD_TERMS__?: Record<string, unknown> };
    registry.__HD_TERMS__ ??= {};
    registry.__HD_TERMS__[id] = term;
  }

  function unregisterTestTerminal(id: string): void {
    if (!import.meta.env.DEV) return;
    const registry = window as unknown as { __HD_TERMS__?: Record<string, unknown> };
    if (registry.__HD_TERMS__) delete registry.__HD_TERMS__[id];
  }

  async function copySelection(): Promise<void> {
    const text = view?.terminal.getSelection() ?? '';
    if (text.length === 0) return;
    try {
      await writeText(text);
    } catch {
      ui.notify(es.terminal.clipboardUnavailable, 'warn');
    }
  }

  async function pasteFromClipboard(): Promise<void> {
    if (!entry) return;
    try {
      const text = await readText();
      if (text && text.length > 0) pool.send(paneId, text);
    } catch {
      ui.notify(es.terminal.clipboardUnavailable, 'warn');
    }
  }

  function applyFit(): void {
    if (!view) return;
    // Con el contenedor sin tamaño (pestaña oculta, primer render) el `fit`
    // calcularía 0 columnas y xterm REDIMENSIONA su buffer a ese tamaño: al
    // volver el panel se quedaba en negro. Se espera al próximo evento.
    if (!host || host.clientWidth === 0 || host.clientHeight === 0) return;
    try {
      view.fit.fit();
    } catch {
      // El contenedor todavía no tiene tamaño: se reintenta en el próximo evento.
    }
  }

  function scheduleFit(): void {
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      if (!entry || !view) return;
      const previous = { cols: view.terminal.cols, rows: view.terminal.rows };
      applyFit();
      if (entry.bridgeId === null) return;
      if (view.terminal.cols === previous.cols && view.terminal.rows === previous.rows) return;
      if (view.terminal.cols === lastSize.cols && view.terminal.rows === lastSize.rows) return;
      lastSize = { cols: view.terminal.cols, rows: view.terminal.rows };
      pool.resize(paneId, view.terminal.cols, view.terminal.rows);
    }, 60);
  }

  // T2.7 — El foco de teclado sigue al panel enfocado: al saltar a un panel
  // desde la paleta o la sidebar, sus teclas van a esa terminal (si el bridge ya
  // estaba abierto no hubo cambio de estado que lo enfocara).
  $effect(() => {
    if (ui.localFocusedPaneId !== paneId) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
    ) {
      return; // el usuario está escribiendo en un campo: no se le quita el foco
    }
    const current = pool.entry(paneId);
    if (!current || current.state !== 'open') return;
    current.view?.terminal.focus();
  });

  function onTerminalEvent(event: Event): void {
    const detail = (event as CustomEvent<{ channel: string; detail: string }>).detail;
    if (!detail) return;
    if (detail.channel === 'input') pool.send(paneId, detail.detail);
    else if (detail.channel === 'copy') void copySelection();
    else if (detail.channel === 'paste') void pasteFromClipboard();
  }

  function openContextMenu(event: MouseEvent): void {
    event.preventDefault();
    ui.openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { id: 'copy', label: es.terminal.copy, run: () => copySelection() },
        { id: 'paste', label: es.terminal.paste, run: () => pasteFromClipboard() },
      ],
    });
  }

  onMount(() => {
    if (!host) return;
    // El pool monta la VISTA (instancia nueva + `open()` una sola vez) y
    // conserva/reengancha el bridge por su cuenta.
    const created = pool.mountView(paneId, host);
    entry = created;
    view = created.view;
    if (!view) return;
    pool.attachWebgl(created);
    registerTestTerminal(paneId, view.terminal);
    syncFromEntry(created);

    const unsubscribe = pool.subscribe({
      onStateChange: (changed) => {
        if (changed.paneId !== paneId) return;
        syncFromEntry(changed);
        if (changed.state === 'open') changed.view?.terminal.focus();
      },
      onFrame: (changed) => {
        if (changed.paneId !== paneId) return;
        frameTotal += 1;
        if (frameTotal % 16 === 0 && host) host.dataset.frames = String(frameTotal);
      },
    });

    // R3: el input va tal cual lo produce xterm (flechas de PSReadLine, Ctrl+C,
    // pegado multilínea, secuencias de vim). No se filtra ni se reescribe nada.
    view.disposers.push(view.terminal.onData((data) => pool.send(paneId, data)));
    view.disposers.push(view.terminal.onBinary((data) => pool.sendBinary(paneId, data)));
    view.disposers.push(
      view.terminal.onSelectionChange(() => {
        if (settings.values.copy_on_select) void copySelection();
      }),
    );

    // La rueda no hace scroll local (scrollback: 0): se pide a herdr.
    view.terminal.attachCustomWheelEventHandler((event) => {
      const lines = Math.max(1, Math.round(settings.values.mouse_scroll_lines));
      pool.scroll(paneId, event.deltaY < 0 ? 'up' : 'down', lines);
      return false;
    });

    window.addEventListener('herdr-desk:terminal', onTerminalEvent);
    resizeObserver = new ResizeObserver(() => scheduleFit());
    resizeObserver.observe(host);
    ready = true;

    return () => {
      window.removeEventListener('herdr-desk:terminal', onTerminalEvent);
      unsubscribe();
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      unregisterTestTerminal(paneId);
      // El pool destruye la VISTA (instancia de xterm, writer y addons: xterm no
      // soporta reabrirla) y SUELTA el bridge con `terminal_release` (no lo
      // cierra: cerrarlo mataría el panel). Al volver a montarse, la vista es
      // nueva y el bridge se reengancha con `pool.open`, que recibe el viewport
      // completo del servidor.
      pool.hide(paneId);
      view = null;
      entry = null;
    };
  });

  // Mientras el panel está a la vista, la vista está montada y el bridge se
  // reengancha con `open` (el servidor manda el viewport completo). Al ocultarse,
  // `hide` destruye la vista y suelta el bridge.
  $effect(() => {
    if (!ready || !entry || !view) return;
    const epoch = session.connectionEpoch;
    const connected = session.connection !== 'offline';
    if (!active) {
      pool.hide(paneId);
      return;
    }
    pool.show(paneId);
    // Sin server no se insiste: se espera al reintento (evita spam de open), y
    // si el panel está «reconectando» el respawn del backend ya reusa su bridge.
    if (!connected && entry.state !== 'idle') return;
    if (entry.state === 'reconnecting') return;
    applyFit();
    void pool.open(paneId, view.terminal.cols, view.terminal.rows, epoch);
  });
</script>

<div
  class="terminal-host"
  data-testid="terminal-host"
  data-pane-id={paneId}
  data-bridge={bridgeState}
  role="application"
  aria-label="terminal {paneId}"
  oncontextmenu={openContextMenu}
  onpointerdown={(event) => {
    // Si el clic cae en el propio xterm, xterm ya se encarga del foco y del
    // ratón; si cae en el overlay o en el borde, el navegador movería el foco a
    // <body> y la terminal perdería las teclas, así que se enfoca a mano.
    const surface = event.currentTarget.querySelector('.terminal-surface');
    if (surface?.contains(event.target as Node)) return;
    event.preventDefault();
    view?.terminal.focus();
  }}
>
  <div bind:this={host} class="terminal-surface"></div>
  <TerminalScrollbar
    {scroll}
    onscroll={(direction, lines) => pool.scroll(paneId, direction, lines)}
  />

  {#if bridgeState === 'opening'}
    <div class="terminal-overlay" data-testid="terminal-overlay" data-kind="opening">
      <span>{es.terminal.connecting}</span>
    </div>
  {:else if bridgeState === 'reconnecting'}
    <!-- El server se cayó: el pool ya tiene su propia temporización de reenganche
         (gracia + reintento automático si el respawn no manda frames, ver
         pool.ts `#scheduleReopen`). Nada que ofrecer aquí: si el bridge vuelve,
         el panel vuelve solo a «open». -->
    <div class="terminal-overlay" data-testid="terminal-overlay" data-kind="reconnecting">
      <!-- Si el pool cerró el bridge por no recibir frames, se dice el motivo
           real; si no, el texto genérico de reconexión. -->
      <span data-testid="terminal-reconnecting">{closeReason || es.terminal.reconnecting}</span>
    </div>
  {:else if bridgeState === 'closed'}
    <!-- Cierre real (no reenganchable desde aquí): se muestra el motivo real,
         sin botón manual — la recuperación es automática y silenciosa o no lo es. -->
    <div class="terminal-overlay" data-testid="terminal-overlay" data-kind="closed">
      <span data-testid="terminal-close-reason">
        {es.terminal.closed.replace('{reason}', closeReason)}
      </span>
    </div>
  {:else if bridgeState === 'error'}
    <div class="terminal-overlay" data-testid="terminal-overlay" data-kind="error">
      <span data-testid="terminal-error">{errorText}</span>
    </div>
  {/if}
</div>

<style>
  .terminal-surface {
    block-size: 100%;
    inline-size: 100%;
    min-inline-size: 0;
    flex: 1 1 auto;
  }
</style>
