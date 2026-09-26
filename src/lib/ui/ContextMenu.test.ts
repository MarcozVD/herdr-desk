// @vitest-environment jsdom
// El menú se ancla al clic, pero si no cabe en la ventana se corre hacia dentro:
// abierto desde el panel del borde derecho se recortaba y no se leían las
// etiquetas (visto en vivo con el botón «…»).

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContextMenu from './ContextMenu.svelte';
import { ui } from '../stores/ui.svelte';

const BOX = { width: 220, height: 180 } as DOMRect;

describe('ContextMenu', () => {
  let target: HTMLElement;
  let instance: Record<string, unknown> | null = null;

  afterEach(() => {
    if (instance) unmount(instance);
    instance = null;
    target?.remove();
    ui.closeContextMenu();
    vi.restoreAllMocks();
  });

  it('se corre hacia dentro si el clic fue pegado al borde', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
    target = document.createElement('div');
    document.body.append(target);
    instance = mount(ContextMenu, { target }) as Record<string, unknown>;
    ui.openContextMenu({ x: 2000, y: 2000, items: [] });
    flushSync();

    const menu = document.querySelector<HTMLElement>('[data-testid="context-menu"]');
    const margin = 6;
    expect(menu?.style.left).toBe(`${window.innerWidth - BOX.width - margin}px`);
    expect(menu?.style.top).toBe(`${window.innerHeight - BOX.height - margin}px`);
  });

  it('mantiene la posición del clic cuando el menú cabe', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
    target = document.createElement('div');
    document.body.append(target);
    instance = mount(ContextMenu, { target }) as Record<string, unknown>;
    ui.openContextMenu({ x: 120, y: 80, items: [] });
    flushSync();

    const menu = document.querySelector<HTMLElement>('[data-testid="context-menu"]');
    expect(menu?.style.left).toBe('120px');
    expect(menu?.style.top).toBe('80px');
  });
});
