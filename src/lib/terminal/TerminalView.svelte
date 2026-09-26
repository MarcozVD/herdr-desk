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
  import type { BridgeState, TerminalEntry } from './pool';
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

  // Fuera de la reactividad: instancia, handles y contador de frames.
  let entry: TerminalEntry | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSize = { cols: 0, rows: 0 };
  let frameTotal = 0;

  function syncFromEntry(source: TerminalEntry): void {
    bridgeState = source.state;
    closeReason = source.closeReason;
    errorText = source.errorText;
  }

  function registerTestTerminal(id: string, term: TerminalEntry['terminal']): void {
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
    const text = entry?.terminal.getSelection() ?? '';
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
    if (!entry) return;
    // Con el contenedor sin tamaño (pestaña oculta, primer render) el `fit`
    // calcularía 0 columnas y xterm REDIMENSIONA su buffer a ese tamaño: al
    // volver el panel se quedaba en negro. Se espera al próximo evento.
    if (!host || host.clientWidth === 0 || host.clientHeight === 0) return;
    try {
      entry.fit.fit();
    } catch {
      // El contenedor todavía no tiene tamaño: se reintenta en el próximo evento.
    }
  }

  function scheduleFit(): void {
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      if (!entry) return;
      const previous = { cols: entry.terminal.cols, rows: entry.terminal.rows };
      applyFit();
      if (entry.bridgeId === null) return;
      if (entry.terminal.cols === previous.cols && entry.terminal.rows === previous.rows) return;
      if (entry.terminal.cols === lastSize.cols && entry.terminal.rows === lastSize.rows) return;
      lastSize = { cols: entry.terminal.cols, rows: entry.terminal.rows };
      pool.resize(paneId, entry.terminal.cols, entry.terminal.rows);
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
    current.terminal.focus();
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
    const created = pool.ensure(paneId);
    entry = created;
    created.host = host;
    created.terminal.open(host);
    pool.attachWebgl(created);
    registerTestTerminal(paneId, created.terminal);
    syncFromEntry(created);

    const unsubscribe = pool.subscribe({
      onStateChange: (changed) => {
        if (changed.paneId !== paneId) return;
        syncFromEntry(changed);
        if (changed.state === 'open') changed.terminal.focus();
      },
      onFrame: (changed) => {
        if (changed.paneId !== paneId) return;
        frameTotal += 1;
        if (frameTotal % 16 === 0 && host) host.dataset.frames = String(frameTotal);
      },
    });

    // R3: el input va tal cual lo produce xterm (flechas de PSReadLine, Ctrl+C,
    // pegado multilínea, secuencias de vim). No se filtra ni se reescribe nada.
    created.coreDisposers.push(created.terminal.onData((data) => pool.send(paneId, data)));
    created.coreDisposers.push(created.terminal.onBinary((data) => pool.sendBinary(paneId, data)));
    created.coreDisposers.push(
      created.terminal.onSelectionChange(() => {
        if (settings.values.copy_on_select) void copySelection();
      }),
    );

    // La rueda no hace scroll local (scrollback: 0): se pide a herdr.
    created.terminal.attachCustomWheelEventHandler((event) => {
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
      for (const disposable of created.coreDisposers) disposable.dispose();
      created.coreDisposers = [];
      created.host = null;
      unregisterTestTerminal(paneId);
      // Ocultar NO es cerrar: el bridge y el buffer se quedan (cambiar de
      // pestaña desmonta esta vista). Si el panel desaparece de la sesión, el
      // `sync` del pool cierra su bridge.
      pool.hide(paneId);
    };
  });

  // Un pane visible mantiene su bridge (ocultar no es cerrar): al ocultarse solo
  // pasa al LRU y suelta WebGL; al volver se reengancha sin parpadeo de overlay.
  // Se sigue el epoch de conexión y el estado de conexión: al reconectar (o al
  // volver el server) hay que reabrir.
  $effect(() => {
    if (!ready || !entry) return;
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
    void pool.open(paneId, entry.terminal.cols, entry.terminal.rows, epoch);
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
    entry?.terminal.focus();
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
