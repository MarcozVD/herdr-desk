<!-- Terminal del panel enfocado: xterm.js sobre el bridge de herdr.
     Reglas del §4/§7 que este componente respeta:
     - los frames NO entran en la reactividad: van a xterm por FrameWriter
     - un frame `full` descarta los frames anteriores en cola
     - el input se reenvía tal cual llega (R3): flechas, Ctrl+C y pegado multilínea
     - el foco es local (R11): el clic enfoca la terminal, no manda IPC a herdr
-->
<script lang="ts">
  import { FitAddon } from '@xterm/addon-fit';
  import { Unicode11Addon } from '@xterm/addon-unicode11';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { WebglAddon } from '@xterm/addon-webgl';
  import { Terminal } from '@xterm/xterm';
  import { onMount } from 'svelte';

  import '@xterm/xterm/css/xterm.css';

  import { es } from '../i18n/es';
  import { parseApiError } from '../herdr/errors';
  import {
    terminalClose,
    terminalInput,
    terminalInputBytes,
    terminalOpen,
    terminalResize,
    terminalScroll,
  } from '../herdr/client';
  import { ui } from '../stores/ui.svelte';
  import { FrameWriter, binaryStringToBase64, decodeCloseReason, decodeFrame } from './frames';

  interface Props {
    paneId: string;
  }

  let { paneId }: Props = $props();

  let host = $state<HTMLDivElement | null>(null);
  let ready = $state(false);
  let bridgeState = $state<'idle' | 'opening' | 'open' | 'closed' | 'error'>('idle');
  let closeReason = $state('');
  let errorText = $state('');

  // Fuera de la reactividad de Svelte (§7): instancias, buffers y handles.
  let terminal: Terminal | null = null;
  let fit: FitAddon | null = null;
  let writer: FrameWriter | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let disposers: Array<{ dispose(): void }> = [];
  let bridgeId: number | null = null;
  let openPaneId: string | null = null;
  let bufferedInput: string[] = [];
  let lastSize = { cols: 0, rows: 0 };
  // Contador de frames fuera de la reactividad: se publica como atributo del
  // host (lo leen los e2e y sirve para el flood de R7) sin re-renderizar.
  let frameCount = 0;
  let destroyed = false;

  function readTheme() {
    const styles = getComputedStyle(document.documentElement);
    const value = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;
    return {
      background: value('--panel-bg-solid', '#21222c'),
      foreground: value('--text', '#f8f8f2'),
      cursor: value('--accent', '#bd93f9'),
      selectionBackground: value('--selection-bg', '#44475a'),
    };
  }

  function loadWebgl(term: Terminal): void {
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // Sin WebGL xterm usa el renderer DOM: la terminal sigue funcionando.
    }
  }

  // En dev la instancia de xterm queda accesible para los e2e: con el renderer
  // WebGL la pantalla vive en un canvas, así que las pruebas leen el buffer.
  function registerTestTerminal(id: string, term: Terminal): void {
    if (!import.meta.env.DEV) return;
    const registry = window as unknown as { __HD_TERMS__?: Record<string, Terminal> };
    registry.__HD_TERMS__ ??= {};
    registry.__HD_TERMS__[id] = term;
  }

  function unregisterTestTerminal(id: string): void {
    if (!import.meta.env.DEV) return;
    const registry = window as unknown as { __HD_TERMS__?: Record<string, Terminal> };
    if (registry.__HD_TERMS__) delete registry.__HD_TERMS__[id];
  }

  function send(data: string): void {
    if (bridgeId === null) {
      bufferedInput.push(data);
      return;
    }
    void terminalInput(bridgeId, data).catch((raw) => fail(raw));
  }

  function sendBinary(data: string): void {
    if (bridgeId === null) return;
    void terminalInputBytes(bridgeId, binaryStringToBase64(data)).catch((raw) => fail(raw));
  }

  function fail(raw: unknown): void {
    errorText = parseApiError(raw).message;
    bridgeState = 'error';
  }

  function onFrame(buffer: ArrayBuffer): void {
    let frame;
    try {
      frame = decodeFrame(buffer);
    } catch {
      return;
    }
    if (frame.closed) {
      closeReason = decodeCloseReason(frame) || es.terminal.closed.replace('{reason}', '');
      bridgeState = 'closed';
      bridgeId = null;
      return;
    }
    frameCount += 1;
    if (frameCount % 16 === 0 && host) host.dataset.frames = String(frameCount);
    writer?.push(frame.bytes, frame.full);
  }

  async function openBridge(targetPaneId: string): Promise<void> {
    if (!terminal || destroyed) return;
    applyFit();
    const cols = Math.max(20, terminal.cols);
    const rows = Math.max(5, terminal.rows);
    bridgeState = 'opening';
    errorText = '';
    try {
      const id = await terminalOpen(targetPaneId, cols, rows, onFrame);
      if (destroyed) {
        void terminalClose(id);
        return;
      }
      bridgeId = id;
      openPaneId = targetPaneId;
      lastSize = { cols, rows };
      bridgeState = 'open';
      const pending = bufferedInput;
      bufferedInput = [];
      for (const data of pending) void terminalInput(id, data);
      terminal.focus();
    } catch (raw) {
      fail(raw);
    }
  }

  function applyFit(): void {
    if (!terminal || !fit) return;
    try {
      fit.fit();
    } catch {
      // El contenedor todavía no tiene tamaño: se reintenta en el próximo evento.
    }
  }

  function scheduleFit(): void {
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      if (!terminal) return;
      const previous = { cols: terminal.cols, rows: terminal.rows };
      applyFit();
      if (bridgeId === null) return;
      if (terminal.cols === previous.cols && terminal.rows === previous.rows) return;
      if (terminal.cols === lastSize.cols && terminal.rows === lastSize.rows) return;
      lastSize = { cols: terminal.cols, rows: terminal.rows };
      void terminalResize(bridgeId, terminal.cols, terminal.rows).catch((raw) => fail(raw));
    }, 60);
  }

  onMount(() => {
    if (!host) return;
    const term = new Terminal({
      // herdr manda el viewport ya renderizado: el scrollback vive en el server.
      scrollback: 0,
      allowTransparency: false,
      allowProposedApi: true,
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      convertEol: false,
      scrollOnUserInput: false,
      theme: readTheme(),
    });
    terminal = term;
    fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    loadWebgl(term);
    registerTestTerminal(paneId, term);

    writer = new FrameWriter({ write: (bytes) => term.write(bytes) });

    // R3: el input va tal cual lo produce xterm (flechas de PSReadLine, Ctrl+C,
    // pegado multilínea, secuencias de vim). No se filtra ni se reescribe nada.
    disposers.push(term.onData((data) => send(data)));
    disposers.push(term.onBinary((data) => sendBinary(data)));

    // La rueda no hace scroll local (scrollback: 0): se pide a herdr.
    term.attachCustomWheelEventHandler((event) => {
      const lines = Math.max(1, Math.round(ui.mouseScrollLines));
      const direction = event.deltaY < 0 ? 'up' : 'down';
      if (bridgeId !== null) {
        void terminalScroll(bridgeId, direction, lines).catch((raw) => fail(raw));
      }
      return false;
    });

    resizeObserver = new ResizeObserver(() => scheduleFit());
    resizeObserver.observe(host);
    ready = true;

    return () => {
      destroyed = true;
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      for (const disposable of disposers) disposable.dispose();
      disposers = [];
      writer?.dispose();
      if (bridgeId !== null) void terminalClose(bridgeId);
      bridgeId = null;
      unregisterTestTerminal(paneId);
      term.dispose();
      terminal = null;
      writer = null;
    };
  });

  // Al cambiar de panel enfocado se abre un bridge nuevo (el anterior se cierra
  // en el cleanup del efecto anterior).
  $effect(() => {
    if (!ready) return;
    const target = paneId;
    if (openPaneId === target) return;
    const previous = bridgeId;
    bridgeId = null;
    if (previous !== null) void terminalClose(previous);
    void openBridge(target);
  });
</script>

<div
  class="terminal-host"
  data-testid="terminal-host"
  data-pane-id={paneId}
  data-bridge={bridgeState}
  role="application"
  aria-label="terminal {paneId}"
  onpointerdown={(event) => {
    // Si el clic cae en el propio xterm, xterm ya se encarga del foco y del
    // ratón; si cae en el overlay o en el borde, el navegador movería el foco a
    // <body> y la terminal perdería las teclas, así que se enfoca a mano.
    const surface = event.currentTarget.querySelector('.terminal-surface');
    if (surface?.contains(event.target as Node)) return;
    event.preventDefault();
    terminal?.focus();
  }}
>
  <div bind:this={host} class="terminal-surface"></div>

  {#if bridgeState === 'opening'}
    <div class="terminal-overlay" data-testid="terminal-overlay" data-kind="opening">
      <span>{es.terminal.connecting}</span>
    </div>
  {:else if bridgeState === 'closed'}
    <div class="terminal-overlay" data-testid="terminal-overlay" data-kind="closed">
      <span data-testid="terminal-close-reason">
        {es.terminal.closed.replace('{reason}', closeReason)}
      </span>
      <button type="button" onclick={() => void openBridge(paneId)}>
        {es.terminal.retake}
      </button>
    </div>
  {:else if bridgeState === 'error'}
    <div class="terminal-overlay" data-testid="terminal-overlay" data-kind="error">
      <span data-testid="terminal-error">{errorText}</span>
      <button type="button" onclick={() => void openBridge(paneId)}>
        {es.terminal.retake}
      </button>
    </div>
  {/if}
</div>

<style>
  .terminal-surface {
    block-size: 100%;
    inline-size: 100%;
  }
</style>
