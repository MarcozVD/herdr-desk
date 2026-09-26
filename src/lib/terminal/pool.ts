// T1.8 — Pool de terminales de la GUI.
//
// El backend (src-tauri) ya mantiene el registro de bridges: reusa el mismo
// bridge_id y el mismo Channel al respawnear tras una caída del server, y
// aplica la gracia de 3 s al cerrar. Este pool decide, en el lado UI:
//
//   - qué panes tienen bridge: TODOS los que existen en la sesión. Ocultar un
//     panel (cambiar de pestaña, cambiar de espacio) NO cierra su bridge: solo
//     se suelta su instancia al LRU (`hide`). El bridge se cierra cuando el
//     panel desaparece de la sesión (`sync`) o al cambiar de sesión.
//   - las instancias de xterm en LRU (máx. `terminal_lru_max`, 12 por defecto)
//     para volver a un tab sin parpadeo;
//   - WebGL como máximo en `webgl_max_panes` panes (8 por defecto); el resto usa
//     el renderer DOM.
//
// Al re-mostrar un pane cuya entrada estaba cerrándose hay que volver a llamar a
// `terminal_open`: el bridge en gracia rechaza el input con `bridge_closed`.

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

// Los addons pesados (WebGL ~240 KB de fuente, Unicode11 con su tabla) van en
// chunks aparte: el catálogo inicial de la §4 se mide con xterm dentro, no con
// todos los renderers.
import type { WebglAddon } from '@xterm/addon-webgl';

import {
  terminalClose,
  terminalInput,
  terminalInputBytes,
  terminalOpen,
  terminalResize,
  terminalScroll,
} from '../herdr/client';
import { parseApiError } from '../herdr/errors';
import { openUrl } from '@tauri-apps/plugin-opener';
import { settings } from '../stores/settings.svelte';
import { es } from '../i18n/es';
import { FrameWriter, binaryStringToBase64, decodeCloseReason, decodeFrame } from './frames';
import { terminalOptions, type TerminalFont } from './font';

export type BridgeState =
  'idle' | 'opening' | 'open' | 'closing' | 'reconnecting' | 'closed' | 'error';

export interface TerminalEntry {
  paneId: string;
  terminal: Terminal;
  fit: FitAddon;
  writer: FrameWriter;
  /** callback de `herdr-desk:terminal` para copy/paste y atajo literal. */
  host: HTMLDivElement | null;
  bridgeId: number | null;
  state: BridgeState;
  closeReason: string;
  errorText: string;
  webgl: boolean;
  /** Epoch de conexión con la que se abrió (para reabrir tras reconectar). */
  epoch: number;
  bufferedInput: string[];
  coreDisposers: Array<{ dispose(): void }>;
  onFrame: (frame: ArrayBuffer) => void;
  /** Frames recibidos desde la última apertura del bridge. */
  framesSinceOpen: number;
  /** Reaperturas forzadas por no recibir frames (tope `MAX_STALE_REOPENS`). */
  staleReopens: number;
  /** Último tamaño pedido, para poder reabrir sin la vista delante. */
  lastCols: number;
  lastRows: number;
  /** Vigilante de la primera señal de vida del bridge. */
  watchdog: ReturnType<typeof setTimeout> | null;
  /** El panel está a la vista (los ocultos conservan bridge y buffer). */
  visible: boolean;
  /** Addon WebGL cargado, para poder soltarlo al ocultarse. */
  webglAddon: WebglAddon | null;
}

export interface PoolEvents {
  onStateChange?: (entry: TerminalEntry) => void;
  /** Llega un frame ya decodificado (lo consume la vista para su contador). */
  onFrame?: (entry: TerminalEntry) => void;
  /**
   * Un bridge se cerró porque el SERVER cayó (no porque la terminal terminara):
   * la app tiene que darse cuenta y reconectar. Sin esto la UI se quedaba «en
   * línea» con los paneles muertos, porque el store del backend no avisa.
   */
  onOutage?: (paneId: string, reason: string) => void;
}

/**
 * Si un bridge recién abierto no manda NI UN frame en este plazo, se da por
 * muerto y se reabre desde cero.
 *
 * Motivo real medido en vivo: el backend REUSA el bridge (y con él su canal) de
 * una página anterior cuando la webview se recarga, así que los frames se
 * pierden en un canal que ya no existe: la terminal se ve, el input funciona
 * (va por otro camino) y no se pinta nada. Cerrar el bridge y abrirlo otra vez
 * crea bridge y canal nuevos, y el servidor reenvía el viewport completo.
 */
export const FRAME_WATCHDOG_MS = 1500;

/**
 * Espera antes de reabrir: el backend cierra el bridge con una gracia de 3 s
 * (`CLOSE_GRACE`) y, mientras siga vivo, `terminal_open` REUSA el mismo bridge y
 * el mismo hilo de lectura… que sigue mandando los frames al canal con el que
 * nació (el de la página anterior). Para estrenar canal hay que dejar morir el
 * bridge viejo y pedir uno nuevo.
 */
export const STALE_REOPEN_DELAY_MS = 3600;

/** Reintentos de reapertura antes de contarlo como error real. */
export const MAX_STALE_REOPENS = 2;

/** Motivos de cierre que significan «se cayó el servidor». */
const OUTAGE_REASON =
  /server is shut|shutting down|error de transporte|os error|connection refused/i;

export interface PoolOptions {
  write: (bytes: Uint8Array) => void;
}

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

export class TerminalPool {
  #entries = new Map<string, TerminalEntry>();
  #lru: string[] = [];
  #listeners = new Set<PoolEvents>();
  #openWebgl = 0;
  /** Reenganches programados tras una caída (pane → timer). */
  #reopenTimers = new Map<string, ReturnType<typeof setTimeout>>();

  subscribe(listener: PoolEvents): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Si el respawn del backend no manda frames en `bridge_reopen_grace_ms`, la UI
   * se reengancha sola (un `terminal_open` nuevo). Si los frames llegan antes, el
   * panel vuelve a «open» y el timer se cancela: nunca hay dos attaches peleando.
   */
  #scheduleReopen(paneId: string): void {
    this.#clearReopen(paneId);
    const delay = Math.max(500, settings.values.bridge_reopen_grace_ms);
    this.#reopenTimers.set(
      paneId,
      setTimeout(() => {
        this.#reopenTimers.delete(paneId);
        const entry = this.#entries.get(paneId);
        if (!entry || entry.state !== 'reconnecting') return;
        void this.open(paneId, entry.terminal.cols, entry.terminal.rows, entry.epoch);
      }, delay),
    );
  }

  #clearReopen(paneId: string): void {
    const timer = this.#reopenTimers.get(paneId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#reopenTimers.delete(paneId);
    }
  }

  #notifyState(entry: TerminalEntry): void {
    for (const listener of this.#listeners) listener.onStateChange?.(entry);
  }

  get size(): number {
    return this.#entries.size;
  }

  get openWebgl(): number {
    return this.#openWebgl;
  }

  entry(paneId: string): TerminalEntry | undefined {
    return this.#entries.get(paneId);
  }

  /** Todas las entradas vivas (para tests y para la status bar). */
  entries(): TerminalEntry[] {
    return [...this.#entries.values()];
  }

  /** Crea (o reutiliza) la instancia de xterm del pane. NO abre bridge. */
  ensure(paneId: string): TerminalEntry {
    const existing = this.#entries.get(paneId);
    if (existing) return existing;

    const terminal = new Terminal({
      // herdr manda el viewport ya renderizado: el scrollback vive en el server.
      scrollback: 0,
      allowTransparency: false,
      allowProposedApi: true,
      // La familia la resuelve `lib/terminal/font.ts` (backend o fallback local):
      // xterm NO resuelve `var(--font-mono)`, se quedaba en la mono del WebView2.
      ...terminalOptions(),
      cursorBlink: true,
      cursorStyle: 'bar',
      convertEol: false,
      scrollOnUserInput: false,
      theme: readTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    // Unicode 11 (tabla de anchos) y links se cargan en cuanto están disponibles.
    void import('@xterm/addon-unicode11').then(({ Unicode11Addon }) => {
      terminal.loadAddon(new Unicode11Addon());
      terminal.unicode.activeVersion = '11';
    });
    void import('@xterm/addon-web-links').then(({ WebLinksAddon }) => {
      terminal.loadAddon(
        new WebLinksAddon((_event, uri) => {
          void openUrl(uri).catch(() => undefined);
        }),
      );
    });

    const entry: TerminalEntry = {
      paneId,
      terminal,
      fit,
      writer: new FrameWriter({ write: (bytes) => terminal.write(bytes) }),
      host: null,
      bridgeId: null,
      state: 'idle',
      closeReason: '',
      errorText: '',
      webgl: false,
      epoch: -1,
      bufferedInput: [],
      coreDisposers: [],
      onFrame: () => undefined,
      framesSinceOpen: 0,
      staleReopens: 0,
      lastCols: 80,
      lastRows: 24,
      watchdog: null,
      visible: true,
      webglAddon: null,
    };

    entry.onFrame = (buffer: ArrayBuffer) => {
      let frame;
      try {
        frame = decodeFrame(buffer);
      } catch {
        return;
      }
      // Un frame prueba que el canal está vivo: se desarma el vigilante y se
      // devuelve el presupuesto de reaperturas (una caída posterior podrá
      // curarse otra vez).
      entry.framesSinceOpen += 1;
      entry.staleReopens = 0;
      this.#clearWatchdog(entry.paneId);
      if (frame.closed) {
        const reason = decodeCloseReason(frame);
        entry.closeReason = reason;
        if (OUTAGE_REASON.test(reason)) {
          // El backend respawnea reusando el mismo bridge_id y el mismo Channel,
          // así que NO se suelta el bridge: el panel queda «reconectando» y los
          // frames que lleguen lo devuelven a «open». Reabrir desde aquí dejaría
          // dos attaches peleando por el mismo pane («taken over»).
          entry.state = 'reconnecting';
          this.#notifyState(entry);
          this.#scheduleReopen(entry.paneId);
          for (const listener of this.#listeners) listener.onOutage?.(entry.paneId, reason);
          return;
        }
        entry.bridgeId = null;
        entry.state = 'closed';
        this.#notifyState(entry);
        return;
      }
      if (entry.state === 'reconnecting' || entry.state === 'closed') {
        // Llegan frames: el bridge (o su respawn) está vivo otra vez.
        this.#clearReopen(entry.paneId);
        entry.state = 'open';
        entry.closeReason = '';
        this.#notifyState(entry);
      }
      entry.writer.push(frame.bytes, frame.full);
      for (const listener of this.#listeners) listener.onFrame?.(entry);
    };

    this.#entries.set(paneId, entry);
    this.#touch(paneId);
    this.#evictIfNeeded();
    return entry;
  }

  /** WebGL solo para los primeros `webgl_max_panes` panes visibles. */
  async attachWebgl(entry: TerminalEntry): Promise<void> {
    if (entry.webgl || !settings.values.webgl) return;
    if (this.#openWebgl >= settings.values.webgl_max_panes) return;
    let Webgl: typeof WebglAddon;
    try {
      ({ WebglAddon: Webgl } = await import('@xterm/addon-webgl'));
    } catch {
      return;
    }
    if (entry.webgl || this.#openWebgl >= settings.values.webgl_max_panes) return;
    try {
      const webgl = new Webgl();
      webgl.onContextLoss(() => {
        entry.webgl = false;
        entry.webglAddon = null;
        this.#openWebgl = Math.max(0, this.#openWebgl - 1);
        webgl.dispose();
      });
      entry.terminal.loadAddon(webgl);
      entry.webgl = true;
      entry.webglAddon = webgl;
      this.#openWebgl += 1;
    } catch {
      // Sin WebGL, xterm usa el renderer DOM: la terminal sigue funcionando.
    }
  }

  /** Abre el bridge del pane (o lo reabre si estaba cerrándose). */
  async open(paneId: string, cols: number, rows: number, epoch: number): Promise<TerminalEntry> {
    const entry = this.ensure(paneId);
    if (entry.state === 'open' && entry.bridgeId !== null && entry.epoch === epoch) return entry;

    entry.state = 'opening';
    entry.errorText = '';
    this.#notifyState(entry);
    try {
      const bridgeId = await terminalOpen(
        paneId,
        Math.max(20, cols),
        Math.max(5, rows),
        entry.onFrame,
      );
      entry.bridgeId = bridgeId;
      entry.epoch = epoch;
      entry.state = 'open';
      entry.lastCols = Math.max(20, cols);
      entry.lastRows = Math.max(5, rows);
      entry.framesSinceOpen = 0;
      this.#armWatchdog(entry);
      const pending = entry.bufferedInput;
      entry.bufferedInput = [];
      for (const data of pending) await terminalInput(bridgeId, data);
      this.#notifyState(entry);
    } catch (raw) {
      entry.errorText = parseApiError(raw).message;
      entry.state = 'error';
      this.#notifyState(entry);
    }
    return entry;
  }

  /**
   * El panel deja de estar a la vista (cambio de pestaña, de espacio…): NO se
   * cierra su bridge — ocultar no es cerrar. Solo se suelta el contexto WebGL
   * (son un recurso contado) y la instancia pasa al LRU con su buffer intacto.
   */
  hide(paneId: string): void {
    const entry = this.#entries.get(paneId);
    if (!entry) return;
    entry.visible = false;
    this.#detachWebgl(entry);
    this.#touch(paneId);
    this.#evictIfNeeded();
  }

  /** El panel vuelve a estar a la vista: reengancha WebGL si toca y refresca el LRU. */
  show(paneId: string): void {
    const entry = this.#entries.get(paneId);
    if (!entry) return;
    entry.visible = true;
    this.#touch(paneId);
    this.#repaint(entry);
    void this.attachWebgl(entry).then(() => this.#repaint(entry));
  }

  /**
   * Repinta el viewport desde el buffer. Al volver a la vista hace falta: como el
   * bridge sigue vivo, el servidor NO reenvía el viewport, y xterm no repinta
   * solo porque su DOM se vuelva a colgar del documento (el panel se veía negro).
   */
  #repaint(entry: TerminalEntry): void {
    try {
      entry.terminal.refresh(0, Math.max(0, entry.terminal.rows - 1));
    } catch {
      // Todavía sin abrir en el documento: se repintará en el siguiente intento.
    }
  }

  /** Suelta el addon WebGL (el contexto GPU es un recurso contado). */
  #detachWebgl(entry: TerminalEntry): void {
    if (!entry.webgl) return;
    entry.webgl = false;
    this.#openWebgl = Math.max(0, this.#openWebgl - 1);
    const addon = entry.webglAddon;
    entry.webglAddon = null;
    try {
      addon?.dispose();
    } catch {
      // El contexto ya se había perdido: no hay nada que soltar.
    }
  }

  /** El panel YA NO EXISTE en la sesión: cierra su bridge y destruye la instancia. */
  release(paneId: string): void {
    this.dispose(paneId);
  }

  /**
   * Sincroniza el pool con los paneles que la sesión dice que existen: los que
   * ya no están se sueltan de verdad (cerrar un panel sí cierra su bridge). Sin
   * esto, un panel cerrado dejaría su bridge colgado para siempre.
   */
  sync(paneIds: readonly string[]): void {
    const alive = new Set(paneIds);
    for (const paneId of [...this.#entries.keys()]) {
      if (!alive.has(paneId)) this.dispose(paneId);
    }
  }

  /** Destruye la instancia de xterm y libera su WebGL. */
  dispose(paneId: string): void {
    const entry = this.#entries.get(paneId);
    if (!entry) return;
    this.#clearReopen(paneId);
    if (entry.bridgeId !== null) {
      void terminalClose(entry.bridgeId).catch(() => undefined);
      entry.bridgeId = null;
    }
    if (entry.webgl) {
      entry.webgl = false;
      this.#openWebgl = Math.max(0, this.#openWebgl - 1);
    }
    const addon = entry.webglAddon;
    entry.webglAddon = null;
    try {
      addon?.dispose();
    } catch {
      // contexto ya perdido
    }
    if (entry.watchdog) clearTimeout(entry.watchdog);
    for (const disposable of entry.coreDisposers) disposable.dispose();
    entry.coreDisposers = [];
    entry.writer.dispose();
    entry.terminal.dispose();
    this.#entries.delete(paneId);
    this.#lru = this.#lru.filter((id) => id !== paneId);
  }

  disposeAll(): void {
    for (const paneId of [...this.#entries.keys()]) this.dispose(paneId);
  }

  send(paneId: string, data: string): void {
    const entry = this.#entries.get(paneId);
    if (!entry) return;
    if (entry.bridgeId === null) {
      entry.bufferedInput.push(data);
      return;
    }
    void terminalInput(entry.bridgeId, data).catch(() => undefined);
  }

  sendBinary(paneId: string, data: string): void {
    const entry = this.#entries.get(paneId);
    if (!entry || entry.bridgeId === null) return;
    void terminalInputBytes(entry.bridgeId, binaryStringToBase64(data)).catch(() => undefined);
  }

  resize(paneId: string, cols: number, rows: number): void {
    const entry = this.#entries.get(paneId);
    if (!entry || entry.bridgeId === null) return;
    entry.lastCols = Math.max(20, cols);
    entry.lastRows = Math.max(5, rows);
    void terminalResize(entry.bridgeId, cols, rows).catch(() => undefined);
  }

  /** Vigilante de la primera señal de vida del bridge (ver `FRAME_WATCHDOG_MS`). */
  #armWatchdog(entry: TerminalEntry): void {
    this.#clearWatchdog(entry.paneId);
    const paneId = entry.paneId;
    entry.watchdog = setTimeout(() => this.#watchdogFired(paneId), FRAME_WATCHDOG_MS);
  }

  #clearWatchdog(paneId: string): void {
    const entry = this.#entries.get(paneId);
    if (!entry?.watchdog) return;
    clearTimeout(entry.watchdog);
    entry.watchdog = null;
  }

  /**
   * El bridge abrió pero no llegó ni un frame: se cierra y se reabre desde cero
   * para estrenar canal. Mientras tanto la UI muestra «reconectando» (estado
   * real) en vez de fingir que el panel está vivo.
   */
  #watchdogFired(paneId: string): void {
    const entry = this.#entries.get(paneId);
    if (!entry) return;
    entry.watchdog = null;
    if (entry.state !== 'open' || entry.bridgeId === null) return;
    if (entry.framesSinceOpen > 0) return;

    if (entry.staleReopens >= MAX_STALE_REOPENS) {
      entry.errorText = es.terminal.staleBridgeFailed.replace('{n}', String(entry.staleReopens));
      entry.state = 'error';
      this.#notifyState(entry);
      return;
    }

    entry.staleReopens += 1;
    const stale = entry.bridgeId;
    entry.bridgeId = null;
    entry.state = 'reconnecting';
    entry.closeReason = es.terminal.staleReopening;
    this.#notifyState(entry);
    void terminalClose(stale).catch(() => undefined);
    // Se espera a que el backend mate el bridge viejo (gracia de 3 s): reabrir
    // antes reusaría el mismo bridge y su hilo seguiría escribiendo en el canal
    // muerto, que es justo lo que hay que dejar atrás.
    const cols = entry.lastCols;
    const rows = entry.lastRows;
    setTimeout(() => {
      const current = this.#entries.get(paneId);
      if (!current || current.state !== 'reconnecting') return;
      void this.open(paneId, cols, rows, current.epoch);
    }, STALE_REOPEN_DELAY_MS);
  }

  /**
   * Aplica un preset de tipografía a TODAS las instancias vivas (incluidas las
   * del LRU): xterm recalcula el tamaño de celda al cambiar la fuente, así que
   * hay que volver a hacer `fit` y avisar del nuevo tamaño al bridge. La rejilla
   * se descuadra si no se reajusta (las celdas viejas ya no valen).
   */
  applyFont(font: TerminalFont): void {
    const options = terminalOptions(font);
    for (const entry of this.#entries.values()) {
      if (
        entry.terminal.options.fontFamily === options.fontFamily &&
        entry.terminal.options.fontSize === options.fontSize &&
        entry.terminal.options.lineHeight === options.lineHeight
      ) {
        continue;
      }
      entry.terminal.options.fontFamily = options.fontFamily;
      entry.terminal.options.fontSize = options.fontSize;
      entry.terminal.options.lineHeight = options.lineHeight;
      this.#refit(entry);
    }
  }

  /**
   * Rehace el `fit` de todas las instancias y avisa del tamaño al bridge si
   * cambió. Se usa cuando la fuente real del sistema ya está cargada (las celdas
   * se midieron antes con la de reserva).
   */
  refitAll(): void {
    for (const entry of this.#entries.values()) this.#refit(entry);
  }

  #refit(entry: TerminalEntry): void {
    const previous = { cols: entry.terminal.cols, rows: entry.terminal.rows };
    try {
      entry.fit.fit();
    } catch {
      // El contenedor todavía no tiene tamaño (o el pane está oculto): el
      // ResizeObserver del pane volverá a intentarlo.
      return;
    }
    if (entry.bridgeId === null) return;
    if (entry.terminal.cols === previous.cols && entry.terminal.rows === previous.rows) return;
    void terminalResize(entry.bridgeId, entry.terminal.cols, entry.terminal.rows).catch(
      () => undefined,
    );
  }

  scroll(paneId: string, direction: 'up' | 'down', lines: number): void {
    const entry = this.#entries.get(paneId);
    if (!entry || entry.bridgeId === null) return;
    void terminalScroll(entry.bridgeId, direction, lines).catch(() => undefined);
  }

  #touch(paneId: string): void {
    this.#lru = [paneId, ...this.#lru.filter((id) => id !== paneId)];
  }

  /** LRU: se destruyen las instancias OCULTAS más viejas por encima del máximo. */
  #evictIfNeeded(): void {
    const max = settings.values.terminal_lru_max;
    if (this.#entries.size <= max) return;
    for (const paneId of [...this.#lru].reverse()) {
      if (this.#entries.size <= max) break;
      const entry = this.#entries.get(paneId);
      if (!entry) continue;
      if (entry.visible) continue; // a la vista: no se toca
      this.dispose(paneId);
    }
  }
}

export const pool = new TerminalPool();
