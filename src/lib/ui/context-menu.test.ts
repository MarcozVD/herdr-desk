// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { suppressNativeContextMenu } from './context-menu';

let unsuppress: (() => void) | null = null;

afterEach(() => {
  unsuppress?.();
  unsuppress = null;
  document.body.innerHTML = '';
});

function contextMenuOn(target: Element): MouseEvent {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('supresión del menú de contexto nativo', () => {
  it('cancela el menú del navegador en cualquier zona de la app', () => {
    unsuppress = suppressNativeContextMenu(window);
    const div = document.createElement('div');
    document.body.append(div);

    expect(contextMenuOn(div).defaultPrevented).toBe(true);
  });

  it('cancela también el de un elemento que no tiene menú propio (el hueco que quedaba)', () => {
    unsuppress = suppressNativeContextMenu(window);
    const statusbar = document.createElement('footer');
    document.body.append(statusbar);

    const event = contextMenuOn(statusbar);
    expect(event.defaultPrevented).toBe(true);
  });

  it('no anula los menús propios: el handler del elemento sigue corriendo', () => {
    unsuppress = suppressNativeContextMenu(window);
    const host = document.createElement('div');
    document.body.append(host);

    const aperturas: string[] = [];
    host.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      aperturas.push(`${event.clientX},${event.clientY}`);
    });

    const event = contextMenuOn(host);
    expect(aperturas).toEqual(['0,0']);
    expect(event.defaultPrevented).toBe(true);
  });

  it('corre en captura, antes que el handler propio, sin cortar la propagación', () => {
    const orden: string[] = [];
    const visto: boolean[] = [];
    const div = document.createElement('div');
    document.body.append(div);

    unsuppress = suppressNativeContextMenu(window);
    const spy = (event: Event) => {
      orden.push('global');
      visto.push(event.defaultPrevented);
    };
    window.addEventListener('contextmenu', spy, true);
    div.addEventListener('contextmenu', (event) => {
      orden.push('propio');
      visto.push(event.defaultPrevented);
    });

    contextMenuOn(div);
    window.removeEventListener('contextmenu', spy, true);

    expect(orden).toEqual(['global', 'propio']);
    // El handler propio sigue recibiendo el evento, y ya viene cancelado.
    expect(visto).toEqual([true, true]);
  });

  it('no toca el ratón: el pegado con botón central y la selección siguen vivos', () => {
    unsuppress = suppressNativeContextMenu(window);
    const term = document.createElement('div');
    document.body.append(term);

    const middle = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 });
    term.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(false);

    const aux = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
    term.dispatchEvent(aux);
    expect(aux.defaultPrevented).toBe(false);
  });

  it('la supresión se puede retirar (desmontaje del shell)', () => {
    const div = document.createElement('div');
    document.body.append(div);

    const remove = suppressNativeContextMenu(window);
    expect(contextMenuOn(div).defaultPrevented).toBe(true);
    remove();
    expect(contextMenuOn(div).defaultPrevented).toBe(false);
  });

  it('acepta cualquier EventTarget (tests y otros contenedores)', () => {
    const target = document.createElement('div');
    const div = document.createElement('div');
    target.append(div);

    unsuppress = suppressNativeContextMenu(target);
    const outside = document.createElement('div');
    document.body.append(outside);

    expect(contextMenuOn(div).defaultPrevented).toBe(true);
    expect(contextMenuOn(outside).defaultPrevented).toBe(false);
  });
});

describe('menú propio de la terminal', () => {
  it('la selección de texto del terminal sigue viva (no se toca selectstart ni el arrastre)', () => {
    unsuppress = suppressNativeContextMenu(window);
    const surface = document.createElement('div');
    document.body.append(surface);

    const selectstart = new Event('selectstart', { bubbles: true, cancelable: true });
    surface.dispatchEvent(selectstart);
    expect(selectstart.defaultPrevented).toBe(false);

    const drag = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    surface.dispatchEvent(drag);
    expect(drag.defaultPrevented).toBe(false);

    const up = new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 });
    surface.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(false);
  });
});
