// T1.8 — Pool de terminales de la GUI.
//
// El backend (src-tauri) ya mantiene el registro de bridges: reusa el mismo
// bridge_id y el mismo Channel al respawnear tras una caída del server, y
// aplica la gracia de 3 s al cerrar. Este pool decide, en el lado UI:
//
//   - qué panes tienen bridge: SOLO los visibles (`acquire` al montarse un
//     Paneframe visible, `release` al ocultarse o desmontarse);
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
import { FrameWriter, binaryStringToBase64, decodeCloseReason, decodeFrame } from './frames';

export type BridgeState = 'idle' | 'opening' | 'open' | 'closing' | 'closed' | 'error';

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
}

export interface PoolEvents {
  onStateChange?: (entry: TerminalEntry) => void;
  /** Llega un frame ya decodificado (lo consume la vista para su contador). */
  onFrame?: (entry: TerminalEntry) => void;
}

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

  subscribe(listener: PoolEvents): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
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
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      lineHeight: 1.2,
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
    };

    entry.onFrame = (buffer: ArrayBuffer) => {
      let frame;
      try {
        frame = decodeFrame(buffer);
      } catch {
        return;
      }
      if (frame.closed) {
        entry.closeReason = decodeCloseReason(frame);
        entry.bridgeId = null;
        entry.state = 'closed';
        this.#notifyState(entry);
        return;
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
        this.#openWebgl = Math.max(0, this.#openWebgl - 1);
        webgl.dispose();
      });
      entry.terminal.loadAddon(webgl);
      entry.webgl = true;
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

  /** Cierra el bridge (el backend aplica su gracia de 3 s) y libera el xterm. */
  release(paneId: string, options: { keepInstance?: boolean } = {}): void {
    const entry = this.#entries.get(paneId);
    if (!entry) return;
    if (entry.bridgeId !== null) {
      void terminalClose(entry.bridgeId).catch(() => undefined);
      entry.bridgeId = null;
      entry.state = 'closing';
      this.#notifyState(entry);
    }
    if (!options.keepInstance) this.dispose(paneId);
  }

  /** Destruye la instancia de xterm y libera su WebGL. */
  dispose(paneId: string): void {
    const entry = this.#entries.get(paneId);
    if (!entry) return;
    if (entry.bridgeId !== null) {
      void terminalClose(entry.bridgeId).catch(() => undefined);
      entry.bridgeId = null;
    }
    if (entry.webgl) {
      entry.webgl = false;
      this.#openWebgl = Math.max(0, this.#openWebgl - 1);
    }
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
    void terminalResize(entry.bridgeId, cols, rows).catch(() => undefined);
  }

  scroll(paneId: string, direction: 'up' | 'down', lines: number): void {
    const entry = this.#entries.get(paneId);
    if (!entry || entry.bridgeId === null) return;
    void terminalScroll(entry.bridgeId, direction, lines).catch(() => undefined);
  }

  #touch(paneId: string): void {
    this.#lru = [paneId, ...this.#lru.filter((id) => id !== paneId)];
  }

  /** LRU: se destruyen las instancias ocultas más viejas por encima del máximo. */
  #evictIfNeeded(): void {
    const max = settings.values.terminal_lru_max;
    if (this.#entries.size <= max) return;
    for (const paneId of [...this.#lru].reverse()) {
      if (this.#entries.size <= max) break;
      const entry = this.#entries.get(paneId);
      if (!entry) continue;
      if (entry.state === 'open') continue; // visible en uso
      this.dispose(paneId);
    }
  }
}

export const pool = new TerminalPool();
