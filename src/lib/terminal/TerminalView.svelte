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

  const pane = $derived(session.panes.find((item) => item.pane_id === paneId) ?? null);

  // Fuera de la reactividad: entrada del pool, vista actual y handles.
  let entry: TerminalEntry | null = null;
  let view: TerminalViewState | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let frameTotal = 0;
  let settleFrame: number | null = null;

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
      if (!text || text.length === 0) return;
      // `paste` de xterm aplica bracketed paste si la app lo pidió y normaliza
      // los saltos de línea; el resultado sale por onData → pool.send.
      if (view) view.terminal.paste(text);
      else pool.send(paneId, text);
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

  /**
   * Ajusta xterm al contenedor y avisa al bridge si el tamaño difiere del que
   * tiene el SERVIDOR (`entry.lastCols/lastRows`), no del de la vista anterior:
   * una vista nueva nace con el tamaño bueno y, comparando con ella, el resize
   * nunca salía y el panel quedaba pintado a medias (hasta mover el divisor).
   */
  function syncSize(): void {
    if (!entry || !view) return;
    // Con bridge vivo NO se redimensiona xterm aquí: se pide el tamaño al server
    // y xterm cambia de rejilla justo antes de pintar el `full` que llega con
    // ese tamaño (pool.ts). Redimensionar antes reordenaba el contenido viejo y
    // al llegar el full se repintaba otra vez: las terminales «temblaban» al
    // abrir/cerrar la barra lateral.
    if (entry.bridgeId === null || entry.state !== 'open') {
      applyFit();
      return;
    }
    if (!host || host.clientWidth === 0 || host.clientHeight === 0) return;
    const proposed = view.fit.proposeDimensions();
    if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) return;
    const cols = Math.max(1, proposed.cols);
    const rows = Math.max(1, proposed.rows);
    if (cols === view.terminal.cols && rows === view.terminal.rows) {
      if (cols !== entry.lastCols || rows !== entry.lastRows) pool.resize(paneId, cols, rows);
      return;
    }
    pool.resizeDeferred(paneId, cols, rows);
  }

  function scheduleFit(): void {
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      syncSize();
    }, 60);
  }

  /** Reajuste tras asentarse el layout (dos frames) y cuando cargan las fuentes. */
  function settleSize(): void {
    if (settleFrame !== null) cancelAnimationFrame(settleFrame);
    settleFrame = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(() => {
        settleFrame = null;
        syncSize();
      });
    });
  }

  /** Secuencia SGR de rueda del ratón (botones 64/65) en la celda del puntero. */
  function wheelSequence(event: WheelEvent, up: boolean): string {
    const terminal = view?.terminal;
    let col = 1;
    let row = 1;
    if (terminal && host) {
      const rect = host.getBoundingClientRect();
      const cellW = rect.width / Math.max(1, terminal.cols);
      const cellH = rect.height / Math.max(1, terminal.rows);
      col = Math.min(
        terminal.cols,
        Math.max(1, Math.floor((event.clientX - rect.left) / cellW) + 1),
      );
      row = Math.min(
        terminal.rows,
        Math.max(1, Math.floor((event.clientY - rect.top) / cellH) + 1),
      );
    }
    return `\x1b[<${up ? 64 : 65};${col};${row}M`;
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
    // Si la app del panel pidió ratón (xterm vio el modo DEC) la rueda va a la
    // app como siempre. Con un agente TUI (opencode, claude…) sin scrollback en
    // el server, los modos DEC no llegan a un controller tardío, así que se le
    // manda la rueda SGR a mano: era el «no puedo hacer scroll en opencode».
    view.terminal.attachCustomWheelEventHandler((event) => {
      const terminal = view?.terminal;
      if (terminal && terminal.modes.mouseTrackingMode !== 'none') return true;
      const up = event.deltaY < 0;
      const lines = Math.max(1, Math.round(settings.values.mouse_scroll_lines));
      const current = pane;
      const hasScrollback = (current?.scroll?.max_offset_from_bottom ?? 0) > 0;
      const agentTui = Boolean(current?.agent) || terminal?.buffer.active.type === 'alternate';
      if (agentTui && !hasScrollback) {
        event.preventDefault();
        pool.send(paneId, wheelSequence(event, up).repeat(Math.min(lines, 5)));
        return false;
      }
      pool.scroll(paneId, up ? 'up' : 'down', lines);
      return false;
    });

    // Ctrl+V pega el portapapeles (sin esto xterm mandaba ^V y no pegaba nada);
    // Ctrl+C con selección copia, sin selección sigue siendo SIGINT.
    view.terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !event.ctrlKey || event.altKey || event.metaKey) return true;
      const key = event.key.toLowerCase();
      if (key === 'v' && !event.shiftKey) {
        event.preventDefault();
        void pasteFromClipboard();
        return false;
      }
      if (key === 'c' && !event.shiftKey && view?.terminal.hasSelection()) {
        event.preventDefault();
        void copySelection();
        view.terminal.clearSelection();
        return false;
      }
      return true;
    });

    window.addEventListener('herdr-desk:terminal', onTerminalEvent);
    resizeObserver = new ResizeObserver(() => scheduleFit());
    resizeObserver.observe(host);
    void document.fonts?.ready.then(() => settleSize());
    ready = true;

    return () => {
      window.removeEventListener('herdr-desk:terminal', onTerminalEvent);
      unsubscribe();
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      if (settleFrame !== null) cancelAnimationFrame(settleFrame);
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
    // Primero el tamaño real del contenedor: `show` y `open` repintan con él (con
    // el tamaño viejo el server pintaba a otra rejilla: gráfica de opencode rota
    // y terminal sin llenar el panel al cambiar de espacio).
    applyFit();
    pool.setSize(paneId, view.terminal.cols, view.terminal.rows);
    pool.show(paneId);
    settleSize();
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
