// Utilidades compartidas por los e2e: arranca la app con el arnés instalado y
// ayuda a empujar snapshots, árboles de layout y frames binarios.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Page } from '@playwright/test';

export const FIXTURE_PATH = resolve(process.cwd(), 'tests/e2e/fixtures/snapshot.json');
export const LAYOUT_FIXTURE_PATH = resolve(process.cwd(), 'tests/e2e/fixtures/layout-w1t1.json');

export function readSnapshotFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as Record<string, unknown>;
}

/** Árbol de `layout.export` de w1:t1 (dos paneles: A | B). */
export function readLayoutFixture(): unknown {
  return JSON.parse(readFileSync(LAYOUT_FIXTURE_PATH, 'utf-8')) as unknown;
}

export interface BootOptions {
  snapshot?: unknown;
  sessionName?: string | null;
  autoSnapshot?: boolean;
  terminalOpenDelayMs?: number;
  /** Árbol que devolverá layout.export (por defecto, un solo panel). */
  layoutTree?: unknown;
  sessionStartError?: 'missing' | { code: string; message: string };
  sessionCurrentMissing?: boolean;
  /** Respuesta del command `agent_kinds` (T2.3). */
  agentKinds?: { kinds: string[]; reason: string | null; cached: boolean };
  /** El primer `terminal_open` de cada panel no manda frames (canal muerto). */
  staleBridgeFirstOpen?: boolean;
  /** Árbol de `layout.export` por tab (`{ 'w1:t1': root, ... }`). */
  layoutTrees?: Record<string, unknown>;
}

export async function bootApp(page: Page, options: BootOptions = {}): Promise<void> {
  const config = {
    snapshot: options.snapshot === undefined ? readSnapshotFixture() : options.snapshot,
    sessionName: options.sessionName === undefined ? 'herdr-desk-dev' : options.sessionName,
    autoSnapshot: options.autoSnapshot ?? true,
    terminalOpenDelayMs: options.terminalOpenDelayMs ?? 0,
    layoutTree: options.layoutTree ?? null,
    layoutTrees: options.layoutTrees ?? null,
    agentKinds: options.agentKinds ?? null,
    staleBridgeFirstOpen: options.staleBridgeFirstOpen ?? null,
    sessionStartError: options.sessionStartError ?? null,
    sessionCurrentMissing: options.sessionCurrentMissing ?? false,
  };
  await page.addInitScript((value) => {
    window.__HD_HARNESS__ = value;
  }, config);
  await page.goto('/');
  await page.waitForSelector('[data-testid="titlebar"]');
}

export interface FrameOptions {
  seq?: number;
  width?: number;
  height?: number;
  full?: boolean;
  text?: string;
  /** Panel destino; por defecto el primer bridge abierto. */
  paneId?: string;
}

/** Empuja un frame ANSI al bridge simulado del panel. */
export async function pushFrame(page: Page, options: FrameOptions = {}): Promise<void> {
  const bytes = Array.from(new TextEncoder().encode(options.text ?? ''));
  await page.evaluate(
    (value) => {
      const buffer = new ArrayBuffer(16 + value.bytes.length);
      const view = new DataView(buffer);
      view.setBigUint64(0, BigInt(value.seq), true);
      view.setUint16(8, value.width, true);
      view.setUint16(10, value.height, true);
      view.setUint8(12, (value.full ? 1 : 0) | (value.closed ? 2 : 0));
      new Uint8Array(buffer, 16).set(value.bytes);
      window.__HD_TEST__?.pushFrame(buffer, value.paneId);
    },
    {
      bytes,
      seq: options.seq ?? 1,
      width: options.width ?? 80,
      height: options.height ?? 24,
      full: options.full ?? true,
      closed: false,
      paneId: options.paneId,
    },
  );
}

/** Texto visible de la terminal: se lee el buffer de xterm (con WebGL la
 *  pantalla vive en un canvas y las filas del DOM están vacías). */
export async function terminalText(page: Page, paneId?: string): Promise<string> {
  return page.evaluate((pane) => {
    interface Line {
      translateToString(trimRight?: boolean): string;
    }
    interface Buffer {
      readonly length: number;
      getLine(index: number): Line | undefined;
    }
    interface Term {
      buffer: { active: Buffer };
    }
    const registry = (window as unknown as { __HD_TERMS__?: Record<string, Term> }).__HD_TERMS__;
    if (!registry) return '';
    const terminal = pane ? registry[pane] : Object.values(registry)[0];
    if (!terminal) return '';
    const lines: string[] = [];
    const buffer = terminal.buffer.active;
    for (let index = 0; index < buffer.length; index += 1) {
      const line = buffer.getLine(index);
      if (line) lines.push(line.translateToString(true));
    }
    return lines.join('\n');
  }, paneId ?? null);
}

/** Pega texto en la terminal como lo haría el usuario (evento paste real). */
export async function pasteIntoTerminal(page: Page, text: string, paneId?: string): Promise<void> {
  await page.evaluate(
    (value) => {
      const selector = value.paneId
        ? `[data-testid="pane-frame"][data-pane-id="${value.paneId}"] textarea`
        : '[data-testid="terminal-host"] textarea';
      const textarea = document.querySelector(selector);
      if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('no hay textarea de xterm');
      textarea.focus();
      const data = new DataTransfer();
      data.setData('text/plain', value.text);
      textarea.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    { text, paneId: paneId ?? null },
  );
}

export async function recordedCalls(
  page: Page,
  cmd: string,
): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(
    (name) => (window.__HD_TEST__?.callsOf(name) ?? []).map((call) => call.args),
    cmd,
  );
}

export async function recordedMethodCalls(
  page: Page,
  method: string,
): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(
    (name) => (window.__HD_TEST__?.callsOfMethod(name) ?? []).map((call) => call.args),
    method,
  );
}

export async function openPanes(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__HD_TEST__?.openPanes() ?? []);
}

/**
 * Espera a que el panel tenga su bridge abierto. El arranque es asíncrono (el
 * árbol de layout llega por RPC y el terminal abre después), así que empujar
 * frames/cierres justo tras `bootApp` es una carrera; esto la quita.
 */
export async function waitBridgeOpen(page: Page, index = 0): Promise<void> {
  await page.waitForFunction(
    (i) =>
      document.querySelectorAll('[data-testid="terminal-host"]')[i]?.getAttribute('data-bridge') ===
      'open',
    index,
  );
}
