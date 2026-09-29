// T1.8 — Pool de terminales de la GUI.
//
// El backend (src-tauri) ya mantiene el registro de bridges: reusa el mismo
// bridge_id y el mismo Channel al respawnear tras una caída del server, y
// aplica la gracia de 3 s al cerrar. Este pool decide, en el lado UI:
//
//   - qué panes tienen bridge: TODOS los que existen en la sesión. Ocultar un
//     panel (cambiar de pestaña, cambiar de espacio) destruye su VISTA y suelta
//     el bridge al vencer `bridge_grace_ms` (3 s, T5.2): volver dentro de la
//     gracia reusa el bridge y pide el viewport completo. El bridge se cierra
//     cuando el panel desaparece de la sesión (`sync`) o al cambiar de sesión.
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
  terminalRelease,
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

/**
 * La VISTA xterm de un panel: vive a nivel de COMPONENTE. Se destruye al
 * desmontarse (cambio de pestaña/espacio, o un remontaje al cambiar el árbol) y
 * se recrea al volver. El bridge NO se toca: vive a nivel de PANEL.
 */
export interface TerminalViewState {
  terminal: Terminal;
  fit: FitAddon;
  writer: FrameWriter;
  /** callback de `herdr-desk:terminal` para copy/paste y atajo literal. */
  host: HTMLDivElement;
  webgl: boolean;
  /** Addon WebGL cargado, para poder soltarlo. */
  webglAddon: WebglAddon | null;
  /** `terminal.open()` se llama UNA vez por instancia: xterm no lo soporta dos veces. */
  opened: boolean;
  disposers: Array<{ dispose(): void }>;
}

export interface TerminalEntry {
  paneId: string;
  /** Vista xterm actual, o `null` si su componente no está montado. */
  view: TerminalViewState | null;
  bridgeId: number | null;
  state: BridgeState;
  closeReason: string;
  errorText: string;
  /** Epoch de conexión con la que se abrió (para reabrir tras reconectar). */
  epoch: number;
  bufferedInput: string[];
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
  /** El panel está a la vista (los ocultos conservan su bridge). */
  visible: boolean;
  /**
   * T5.2 — El bridge sobrevivió a un `hide` dentro de la gracia: al volver hay
   * vista nueva sin contenido, así que `show` pide el repintado completo.
   */
  needsRepaint: boolean;
  /** Bridge soltado con `terminal_release`
   *  (si el backend aún no lo soporta, vuelve a aparecer al reenganchar). */
  releasedBridgeId: number | null;
  /** Contadores al backend, para la sonda en vivo (`__HD_POOL_PROBE__`). */
  sentOpen: number;
  sentResize: number;
  sentRelease: number;
  sentClose: number;
  /** Tamaño pedido al server y aún no pintado (resize sin reflujo local). */
  pendingSize: { cols: number; rows: number } | null;
  pendingTimer: ReturnType<typeof setTimeout> | null;
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

/** Plazo para que llegue el `full` de un resize antes de aplicarlo en local. */
export const DEFERRED_RESIZE_MS = 250;

/** Reintentos de reapertura antes de contarlo como error real. */
export const MAX_STALE_REOPENS = 2;

/** Motivos de cierre que significan «se cayó el servidor». */
const OUTAGE_REASON =
  /server is shut|shutting down|error de transporte|os error|connection refused/i;

/**
 * C1 — El server rechazó el bridge por protocolo privado incompatible (server
 * viejo). No es una caída transitoria: error definitivo, sin watchdog ni
 * reaperturas; el banner ofrece reiniciar la sesión.
 */
export const SERVER_INCOMPATIBLE_REASON = 'server_incompatible';

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
    cursorAccent: value('--panel-bg-solid', '#21222c'),
    selectionBackground: value('--selection-bg', '#44475a'),
    // ANSI-16 del tema (T3.7): los escribe lib/theme/apply.ts.
    black: value('--ansi-black', '#45475a'),
    red: value('--ansi-red', '#f38ba8'),
    green: value('--ansi-green', '#a6e3a1'),
    yellow: value('--ansi-yellow', '#f9e2af'),
    blue: value('--ansi-blue', '#89b4fa'),
    magenta: value('--ansi-magenta', '#cba6f7'),
    cyan: value('--ansi-cyan', '#94e2d5'),
    white: value('--ansi-white', '#cdd6f4'),
    brightBlack: value('--ansi-bright-black', '#6c7086'),
    brightRed: value('--ansi-bright-red', '#f38ba8'),
    brightGreen: value('--ansi-bright-green', '#a6e3a1'),
    brightYellow: value('--ansi-bright-yellow', '#f9e2af'),
    brightBlue: value('--ansi-bright-blue', '#89b4fa'),
    brightMagenta: value('--ansi-bright-magenta', '#cba6f7'),
    brightCyan: value('--ansi-bright-cyan', '#94e2d5'),
    brightWhite: value('--ansi-bright-white', '#cdd6f4'),
  };
}

export class TerminalPool {
  #entries = new Map<string, TerminalEntry>();
  #lru: string[] = [];
  #listeners = new Set<PoolEvents>();
  #openWebgl = 0;
  /** Reenganches programados tras una caída (pane → timer). */
  #reopenTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** T5.2 — Sueltas de bridge aplazadas por la gracia de `hide` (pane → timer). */
  #hideTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
        void this.open(paneId, entry.lastCols, entry.lastRows, entry.epoch);
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

  /** Crea (o reutiliza) la ENTRADA del panel: bridge + estado. NO crea la vista. */
  ensure(paneId: string): TerminalEntry {
    const existing = this.#entries.get(paneId);
    if (existing) return existing;

    const entry: TerminalEntry = {
      paneId,
      view: null,
      bridgeId: null,
      state: 'idle',
      closeReason: '',
      errorText: '',
      epoch: -1,
      bufferedInput: [],
      onFrame: () => undefined,
      framesSinceOpen: 0,
      staleReopens: 0,
      lastCols: 80,
      lastRows: 24,
      watchdog: null,
      visible: true,
      needsRepaint: false,
      releasedBridgeId: null,
      sentOpen: 0,
      sentResize: 0,
      sentRelease: 0,
      sentClose: 0,
      pendingSize: null,
      pendingTimer: null,
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
        if (reason === SERVER_INCOMPATIBLE_REASON) {
          // C1: error definitivo, no caída. Sin respawn del backend (el bridge ya
          // nace muerto) y sin watchdog/reapertura desde la UI.
          entry.bridgeId = null;
          entry.state = 'error';
          entry.errorText = es.terminal.serverIncompatible;
          this.#clearWatchdog(entry.paneId);
          this.#clearReopen(entry.paneId);
          this.#notifyState(entry);
          return;
        }
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
      // Sin vista montada no hay dónde pintar: el contenido volverá entero en el
      // repintado que pide el siguiente montaje (lo manda el servidor).
      const view = entry.view;
      if (view && frame.full) this.#adoptFrameSize(entry, frame.width, frame.height);
      view?.writer.push(frame.bytes, frame.full);
      for (const listener of this.#listeners) listener.onFrame?.(entry);
    };

    this.#entries.set(paneId, entry);
    this.#touch(paneId);
    this.#evictIfNeeded();
    return entry;
  }

  /**
   * Monta la VISTA de un panel: crea su instancia de xterm y la abre UNA vez.
   *
   * Es el único camino para crear una vista. Si el panel ya tenía bridge abierto
   * (su vista se desmontó al cambiar de pestaña/espacio) marca `reusedBridge`
   * para que, al mostrarse, se le pida al servidor el repintado completo.
   */
  mountView(paneId: string, host: HTMLDivElement): TerminalEntry {
    const entry = this.ensure(paneId);
    if (entry.view) {
      // Guarda: JAMÁS dos `open()` sobre la misma instancia. xterm no lo soporta
      // (deja el render y el buffer sin pintar: era el bug de los paneles negros).
      // Si la vista ya existe se reengancha su DOM al host actual.
      const element = entry.view.terminal.element;
      entry.view.host = host;
      if (element && element.parentElement !== host) host.append(element);
      this.#touch(paneId);
      return entry;
    }
    entry.view = this.#createView(host);
    this.#touch(paneId);
    return entry;
  }

  /** Destruye la vista (xterm + writer + addons). NO toca el bridge. */
  #destroyView(entry: TerminalEntry): void {
    const view = entry.view;
    if (!view) return;
    entry.view = null;
    if (view.webgl) {
      view.webgl = false;
      this.#openWebgl = Math.max(0, this.#openWebgl - 1);
    }
    const addon = view.webglAddon;
    view.webglAddon = null;
    try {
      addon?.dispose();
    } catch {
      // El contexto ya se había perdido: no hay nada que soltar.
    }
    for (const disposable of view.disposers) {
      try {
        disposable.dispose();
      } catch {
        // Un listener ya retirado: da igual.
      }
    }
    view.disposers = [];
    view.writer.dispose();
    // xterm no soporta volver a abrir una instancia: esta vista muere aquí.
    try {
      view.terminal.dispose();
    } catch {
      // Ya estaba destruida.
    }
  }

  /** Crea una vista nueva (instancia de xterm + fit + writer + addons). */
  #createView(host: HTMLDivElement): TerminalViewState {
    const terminal = new Terminal({
      // herdr manda el viewport ya renderizado: el scrollback vive en el server.
      scrollback: 0,
      allowTransparency: false,
      allowProposedApi: true,
      // La familia la resuelve `lib/terminal/font.ts` (backend o fallback local):
      // xterm NO resuelve `var(--font-mono)`, se quedaba en la mono del WebView2.
      ...terminalOptions(),
      // T5.2 — Sin parpadeo: cada parpadeo recompone la ventana transparente con
      // sus capas de backdrop-filter y medía ~4 % de CPU en reposo con 1 terminal
      // visible (la meta de la §4 es ≤ 0,5 %). El cursor queda fijo.
      cursorBlink: false,
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

    // `open()` se llama AQUÍ y una sola vez por instancia.
    terminal.open(host);
    return {
      terminal,
      fit,
      writer: new FrameWriter({ write: (bytes) => terminal.write(bytes) }),
      host,
      webgl: false,
      webglAddon: null,
      opened: true,
      disposers: [],
    };
  }

  /** WebGL solo para los primeros `webgl_max_panes` panes visibles. */
  async attachWebgl(entry: TerminalEntry): Promise<void> {
    const view = entry.view;
    if (!view || view.webgl || !settings.values.webgl) return;
    if (this.#openWebgl >= settings.values.webgl_max_panes) return;
    let Webgl: typeof WebglAddon;
    try {
      ({ WebglAddon: Webgl } = await import('@xterm/addon-webgl'));
    } catch {
      return;
    }
    if (!entry.view || entry.view.webgl) return;
    if (this.#openWebgl >= settings.values.webgl_max_panes) return;
    try {
      const webgl = new Webgl();
      webgl.onContextLoss(() => {
        const current = entry.view;
        if (current?.webglAddon === webgl) {
          current.webgl = false;
          current.webglAddon = null;
          this.#openWebgl = Math.max(0, this.#openWebgl - 1);
        }
        webgl.dispose();
      });
      const target = entry.view;
      if (!target) {
        webgl.dispose();
        return;
      }
      target.terminal.loadAddon(webgl);
      target.webgl = true;
      target.webglAddon = webgl;
      this.#openWebgl += 1;
    } catch {
      // Sin WebGL, xterm usa el renderer DOM: la terminal sigue funcionando.
    }
  }

  /** Abre el bridge del pane (o lo reabre si estaba cerrándose). */
  async open(paneId: string, cols: number, rows: number, epoch: number): Promise<TerminalEntry> {
    const entry = this.ensure(paneId);
    this.#sanitize(entry);
    if (entry.state === 'open' && entry.bridgeId !== null && entry.epoch === epoch) {
      // Bridge vivo tras la gracia del hide: la vista nueva necesita repintado.
      if (entry.needsRepaint) {
        entry.needsRepaint = false;
        this.#forceRepaint(entry);
      }
      return entry;
    }

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
      entry.sentOpen += 1;
      const reused = entry.releasedBridgeId !== null && bridgeId === entry.releasedBridgeId;
      entry.releasedBridgeId = null;
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
      if (reused) {
        // El backend NO soltó el bridge (todavía sin `terminal_release`) y lo ha
        // reutilizado: no habrá viewport nuevo, así que se le fuerza con el
        // truco del resize (medido: resize -> frame `full`). Cuando el backend
        // estrene el release, el reenganche será un bridge nuevo y esto no corre.
        this.#forceRepaint(entry);
      }
    } catch (raw) {
      // C1: `server_incompatible` es terminal: error con el mensaje del backend
      // (versiones incluidas) y sin watchdog ni reapertura.
      entry.errorText = parseApiError(raw).message;
      entry.state = 'error';
      this.#clearWatchdog(entry.paneId);
      this.#clearReopen(entry.paneId);
      this.#notifyState(entry);
    }
    return entry;
  }

  /**
   * El panel deja de estar a la vista (cambio de pestaña/espacio, o un remontaje
   * al cambiar el árbol). Dos vidas distintas:
   *
   *   - la VISTA xterm muere aquí (es del componente; xterm no soporta `open()`
   *     dos veces sobre la misma instancia);
   *   - el BRIDGE se SUELTA con `terminal_release` (attach/detach del CLI): el
   *     server deja de mandar frames y al volver se engancha uno nuevo que trae
   *     el viewport completo. NO se usa `terminal_close`: ése mata el pane
   *     (`user_close`) y es lo que dejaba las terminales muertas al cambiar de
   *     pestaña.
   */
  hide(paneId: string): void {
    const entry = this.#entries.get(paneId);
    if (!entry) return;
    entry.visible = false;
    this.#destroyView(entry);
    this.#touch(paneId);
    this.#clearHideGrace(paneId);
    // T5.2 — Gracia de `bridge_grace_ms` (3 s por defecto): cambiar de pestaña y
    // volver no suelta el bridge (ni renegocia attach); si el panel no vuelve,
    // se suelta como antes. La vista xterm muere YA (es del componente).
    const grace = Math.max(0, settings.values.bridge_grace_ms);
    if (entry.bridgeId === null || grace === 0) {
      this.detach(paneId);
      this.#evictIfNeeded();
      return;
    }
    entry.needsRepaint = true;
    this.#hideTimers.set(
      paneId,
      setTimeout(() => {
        this.#hideTimers.delete(paneId);
        this.detach(paneId);
        this.#evictIfNeeded();
      }, grace),
    );
    this.#evictIfNeeded();
  }

  #clearHideGrace(paneId: string): void {
    const timer = this.#hideTimers.get(paneId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#hideTimers.delete(paneId);
    }
  }

  /**
   * Suelta el bridge sin matar el panel. Idempotente. Tras esto la entrada queda
   * «idle» con `bridgeId = null`, así que el siguiente `open` reengancha de
   * verdad (sin early return) y el server manda el viewport entero.
   */
  detach(paneId: string): void {
    this.#clearHideGrace(paneId);
    const entry = this.#entries.get(paneId);
    if (!entry || entry.bridgeId === null) return;
    entry.needsRepaint = false;
    const bridgeId = entry.bridgeId;
    entry.bridgeId = null;
    entry.releasedBridgeId = bridgeId;
    entry.epoch = -1;
    entry.framesSinceOpen = 0;
    entry.bufferedInput = [];
    this.#clearWatchdog(paneId);
    this.#clearReopen(paneId);
    entry.state = 'idle';
    entry.closeReason = '';
    entry.sentRelease += 1;
    void terminalRelease(bridgeId).catch(() => undefined);
    this.#notifyState(entry);
  }

  /**
   * Sanea el estado para que el frontend no crea que tiene un bridge vivo que ya
   * no existe (p. ej. tras un `hide` que soltó el bridge, o un release que el
   * backend no soporta todavía).
   */
  #sanitize(entry: TerminalEntry): void {
    if (entry.bridgeId === null && entry.state !== 'idle' && entry.state !== 'error') {
      entry.state = 'idle';
      entry.closeReason = '';
      this.#notifyState(entry);
    }
  }

  /**
   * El panel vuelve a estar a la vista: reengancha WebGL si toca y refresca el
   * LRU. El repintado NO se pide desde aquí: lo trae el reenganche del bridge
   * (`open` → bridge nuevo → el server manda el viewport completo).
   */
  show(paneId: string): void {
    const entry = this.#entries.get(paneId);
    if (!entry) return;
    entry.visible = true;
    this.#clearHideGrace(paneId);
    // El bridge sobrevivió a la gracia: la vista es nueva y está vacía, así que
    // se le pide el viewport completo con el truco del resize (una sola vez).
    if (entry.needsRepaint && entry.bridgeId !== null) {
      entry.needsRepaint = false;
      this.#forceRepaint(entry);
    }
    this.#touch(paneId);
    void this.attachWebgl(entry);
  }

  /**
   * Pide al servidor un frame `full` (el viewport entero) sin cerrar el bridge.
   *
   * Medido con la sonda `hd-bridge-probe.py` contra el servidor real:
   *   attach 80x24            -> 1 frame full (47 KB = viewport completo)
   *   resize a 77x24          -> 1 frame full
   *   resize de vuelta 80x24  -> 1 frame full
   * Un `terminal_open` sobre un bridge ya vivo NO reengancha el stream, así que el
   * resize (a otro tamaño y de vuelta) es el modo de forzar el repintado: el
   * primer full llega con el tamaño intermedio y el segundo, ya con el correcto.
   */
  #forceRepaint(entry: TerminalEntry): void {
    if (entry.bridgeId === null) return;
    const bridgeId = entry.bridgeId;
    const cols = Math.max(20, entry.lastCols);
    const rows = Math.max(5, entry.lastRows);
    const detour = cols > 21 ? cols - 2 : cols + 2;
    void terminalResize(bridgeId, detour, rows).catch(() => undefined);
    void terminalResize(bridgeId, cols, rows).catch(() => undefined);
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
    this.#clearHideGrace(paneId);
    if (entry.bridgeId !== null) {
      entry.sentClose += 1;
      void terminalClose(entry.bridgeId).catch(() => undefined);
      entry.bridgeId = null;
    }
    if (entry.watchdog) clearTimeout(entry.watchdog);
    if (entry.pendingTimer !== null) clearTimeout(entry.pendingTimer);
    this.#destroyView(entry);
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

  /**
   * Tamaño actual de la vista, ANTES de `show`/`open`: el repintado forzado usa
   * `lastCols/lastRows` y, si no se actualizan, el server pinta con la rejilla
   * vieja. Si el bridge está vivo y el tamaño cambió, se le avisa (resize).
   */
  setSize(paneId: string, cols: number, rows: number): void {
    const entry = this.#entries.get(paneId);
    if (!entry || cols <= 0 || rows <= 0) return;
    const nextCols = Math.max(20, cols);
    const nextRows = Math.max(5, rows);
    if (nextCols === entry.lastCols && nextRows === entry.lastRows) return;
    if (entry.bridgeId !== null && !entry.needsRepaint) {
      this.resize(paneId, nextCols, nextRows);
      return;
    }
    entry.lastCols = nextCols;
    entry.lastRows = nextRows;
  }

  /**
   * Resize sin reflujo local: se pide el tamaño al server y xterm cambia de
   * rejilla cuando llega el `full` con ese tamaño (`#adoptFrameSize`), así el
   * contenido viejo nunca se reordena a la rejilla nueva (evita el temblor). Si
   * el full no llega en `DEFERRED_RESIZE_MS`, se aplica en local igualmente.
   */
  resizeDeferred(paneId: string, cols: number, rows: number): void {
    const entry = this.#entries.get(paneId);
    if (!entry || entry.bridgeId === null || !entry.view) return;
    entry.pendingSize = { cols, rows };
    this.resize(paneId, cols, rows);
    if (entry.pendingTimer !== null) clearTimeout(entry.pendingTimer);
    entry.pendingTimer = setTimeout(() => {
      entry.pendingTimer = null;
      const pending = entry.pendingSize;
      entry.pendingSize = null;
      const view = entry.view;
      if (!pending || !view) return;
      if (view.terminal.cols !== pending.cols || view.terminal.rows !== pending.rows) {
        view.terminal.resize(pending.cols, pending.rows);
      }
    }, DEFERRED_RESIZE_MS);
  }

  /** Un `full` trae el tamaño del server: xterm adopta ESA rejilla antes de pintar. */
  #adoptFrameSize(entry: TerminalEntry, width: number, height: number): void {
    const view = entry.view;
    if (!view || width <= 0 || height <= 0) return;
    const pending = entry.pendingSize;
    // Solo se adopta el tamaño pedido: un full viejo (de antes del resize) no
    // debe devolver la terminal a la rejilla anterior.
    if (pending && (pending.cols !== width || pending.rows !== height)) return;
    if (pending) {
      entry.pendingSize = null;
      if (entry.pendingTimer !== null) {
        clearTimeout(entry.pendingTimer);
        entry.pendingTimer = null;
      }
      if (view.terminal.cols !== width || view.terminal.rows !== height) {
        view.terminal.resize(width, height);
      }
    }
  }

  resize(paneId: string, cols: number, rows: number): void {
    const entry = this.#entries.get(paneId);
    if (!entry || entry.bridgeId === null) return;
    entry.lastCols = Math.max(20, cols);
    entry.lastRows = Math.max(5, rows);
    entry.sentResize += 1;
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
  /** Reaplica el tema de xterm desde las variables CSS (temas en vivo, T3.7). */
  applyXtermTheme(): void {
    const theme = readTheme();
    for (const entry of this.#entries.values()) {
      if (entry.view) entry.view.terminal.options.theme = theme;
    }
  }

  applyFont(font: TerminalFont): void {
    const options = terminalOptions(font);
    for (const entry of this.#entries.values()) {
      const view = entry.view;
      if (!view) continue;
      if (
        view.terminal.options.fontFamily === options.fontFamily &&
        view.terminal.options.fontSize === options.fontSize &&
        view.terminal.options.lineHeight === options.lineHeight
      ) {
        continue;
      }
      view.terminal.options.fontFamily = options.fontFamily;
      view.terminal.options.fontSize = options.fontSize;
      view.terminal.options.lineHeight = options.lineHeight;
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
    const view = entry.view;
    if (!view) return;
    const previous = { cols: view.terminal.cols, rows: view.terminal.rows };
    try {
      view.fit.fit();
    } catch {
      // El contenedor todavía no tiene tamaño (o el pane está oculto): el
      // ResizeObserver del pane volverá a intentarlo.
      return;
    }
    if (entry.bridgeId === null) return;
    if (view.terminal.cols === previous.cols && view.terminal.rows === previous.rows) return;
    void terminalResize(entry.bridgeId, view.terminal.cols, view.terminal.rows).catch(
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

/**
 * Sonda de diagnóstico en vivo (solo DEV): responde a un `probe` con el estado
 * del pool y los contadores de llamadas al backend por panel. Se puede pedir por
 * BroadcastChannel `hd-probe` (postMessage('probe')), por el evento `hd-probe` de
 * window, o leyendo `window.__HD_POOL_PROBE__()`.
 *
 * Sirve para medir en la app real cuántos `terminal_open`/`terminal_resize`/
 * `terminal_release` se mandan por panel al cambiar de pestaña o espacio.
 */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const snapshot = () => ({
    pool: pool.entries().map((item) => ({
      pane: item.paneId,
      state: item.state,
      bridge: item.bridgeId,
      view: item.view !== null,
      visible: item.visible,
      sentOpen: item.sentOpen,
      sentResize: item.sentResize,
      sentRelease: item.sentRelease,
      sentClose: item.sentClose,
      frames: item.framesSinceOpen,
    })),
  });
  (window as unknown as { __HD_POOL_PROBE__?: () => unknown }).__HD_POOL_PROBE__ = snapshot;
  try {
    const channel = new BroadcastChannel('hd-probe');
    channel.onmessage = (event: MessageEvent) => {
      if (event.data === 'probe') channel.postMessage(snapshot());
    };
  } catch {
    // Sin BroadcastChannel queda el evento de window.
  }
  window.addEventListener('hd-probe', (event) => {
    const detail = (event as CustomEvent<{ reply?: (data: unknown) => void }>).detail;
    detail?.reply?.(snapshot());
  });
}
