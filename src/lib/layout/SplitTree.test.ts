// @vitest-environment jsdom
// Regresión del fallo «al cerrar un panel el marco se queda en pantalla con su
// overlay de desconectado». La causa: SplitTree renderizaba `<PaneFrame>` sin
// clave, así que cuando un panel desaparecía y su hueco lo ocupaba otro, Svelte
// reutilizaba la MISMA instancia (xterm + bridge del panel que se fue) en vez de
// desmontarla. Con `{#key node.paneId}` cada panel se desmonta/monta entero.
//
// Se monta el arnés (mismo `{#if tree}<SplitTree/>` que App.svelte) con las
// piezas reales: PaneFrame + TerminalView + pool de xterm (en jsdom, sin Tauri:
// los bridges fallan y el panel queda en «error», que da igual para esto).

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { LayoutNode } from '../herdr/actions';
import { pool } from '../terminal/pool';
import Harness from './SplitTreeHarness.svelte';
import { buildTree } from './tree';

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
});

interface HarnessInstance {
  setTree(node: ReturnType<typeof buildTree>): void;
}

let instance: HarnessInstance | null = null;
let target: HTMLElement | null = null;

function mountHarness(node: LayoutNode | null): void {
  target = document.createElement('div');
  document.body.append(target);
  instance = mount(Harness, { target }) as unknown as HarnessInstance;
  flushSync();
  setTree(node);
}

function setTree(node: LayoutNode | null): void {
  instance?.setTree(buildTree(node));
  flushSync();
}

function frames(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-testid="pane-frame"]')];
}

function frameFor(paneId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`);
}

const pane = (paneId: string): LayoutNode => ({ type: 'pane', pane_id: paneId });

/** split(right, A | B) */
const AB: LayoutNode = {
  type: 'split',
  direction: 'right',
  ratio: 0.5,
  first: pane('w1:pA'),
  second: pane('w1:pB'),
};

afterEach(() => {
  if (instance) unmount(instance as never);
  instance = null;
  target?.remove();
  target = null;
  document.body.innerHTML = '';
  pool.disposeAll();
});

describe('SplitTree: un panel que desaparece desmonta su marco, su terminal y su bridge', () => {
  it('pinta un marco por panel del árbol', () => {
    mountHarness(AB);
    expect(frames()).toHaveLength(2);
    expect(frames().map((frame) => frame.dataset.paneId)).toEqual(['w1:pA', 'w1:pB']);
    // Cada panel monta su terminal en el pool (y su bridge).
    expect(pool.entry('w1:pA')).toBeDefined();
    expect(pool.entry('w1:pB')).toBeDefined();
  });

  it('al cerrarse un panel su marco desaparece y su terminal sale del pool', () => {
    mountHarness(AB);
    const oldB = frameFor('w1:pB');
    expect(oldB).not.toBeNull();

    // Cierra pB: el tab queda con un solo panel.
    setTree(pane('w1:pA'));

    expect(frameFor('w1:pB')).toBeNull();
    expect(oldB?.isConnected).toBe(false);
    expect(frames()).toHaveLength(1);
    expect(pool.entry('w1:pB')).toBeUndefined();
    expect(pool.entry('w1:pA')).toBeDefined();
  });

  it('si el hueco del panel cerrado lo ocupa otro, el marco es uno NUEVO (sin terminal heredada)', () => {
    mountHarness(AB);
    const oldB = frameFor('w1:pB');

    // pB se cierra y pC ocupa su posición en el mismo lado del split.
    setTree({ ...AB, second: pane('w1:pC') });

    const newC = frameFor('w1:pC');
    expect(newC).not.toBeNull();
    // Nodo distinto: el panel viejo NO se reutiliza (con eso llegaba el overlay
    // de «desconectado» y el bridge del panel que se fue).
    expect(newC).not.toBe(oldB);
    expect(oldB?.isConnected).toBe(false);
    expect(frameFor('w1:pB')).toBeNull();
    // Terminal y bridge del panel que se fue, fuera del pool.
    expect(pool.entry('w1:pB')).toBeUndefined();
    expect(pool.entry('w1:pC')).toBeDefined();
  });

  it('sin paneles no queda ningún marco', () => {
    mountHarness(AB);
    setTree(null);
    expect(frames()).toHaveLength(0);
    expect(pool.entries()).toHaveLength(0);
  });
});
