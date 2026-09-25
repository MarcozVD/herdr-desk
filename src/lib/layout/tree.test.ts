import { describe, expect, it } from 'vitest';

import type { LayoutNode } from '../herdr/actions';
import {
  buildTree,
  dividerAt,
  dividersOf,
  findPane,
  neighborPane,
  paneNodes,
  splitRect,
  zoomedTree,
} from './tree';

/** Tab con 3 paneles: A | (B / C), el segundo split bajando con ratio 0.4. */
const THREE_PANES: LayoutNode = {
  type: 'split',
  direction: 'right',
  ratio: 0.5,
  first: { type: 'pane', pane_id: 'w1:p1', cwd: 'C:\\uno' },
  second: {
    type: 'split',
    direction: 'down',
    ratio: 0.4,
    first: { type: 'pane', pane_id: 'w1:p2' },
    second: { type: 'pane', pane_id: 'w1:p3', label: 'logs' },
  },
};

describe('splitRect', () => {
  it('parte en vertical (direction right) y respeta el ratio', () => {
    const [first, second] = splitRect({ x: 0, y: 0, w: 1, h: 1 }, 'right', 0.3);
    expect(first).toEqual({ x: 0, y: 0, w: 0.3, h: 1 });
    expect(second.x).toBeCloseTo(0.3);
    expect(second.w).toBeCloseTo(0.7);
  });

  it('parte en horizontal (direction down)', () => {
    const [first, second] = splitRect({ x: 0, y: 0, w: 1, h: 1 }, 'down', 0.25);
    expect(first.h).toBeCloseTo(0.25);
    expect(second.y).toBeCloseTo(0.25);
    expect(second.h).toBeCloseTo(0.75);
  });

  it('recorta ratios fuera de rango', () => {
    const [first] = splitRect({ x: 0, y: 0, w: 1, h: 1 }, 'right', 5);
    expect(first.w).toBeCloseTo(0.95);
    const [small] = splitRect({ x: 0, y: 0, w: 1, h: 1 }, 'right', -1);
    expect(small.w).toBeCloseTo(0.05);
  });
});

describe('buildTree', () => {
  it('asigna geometría a cada panel del árbol', () => {
    const root = buildTree(THREE_PANES);
    expect(root?.kind).toBe('split');
    const panes = paneNodes(root);
    expect(panes.map((pane) => pane.paneId)).toEqual(['w1:p1', 'w1:p2', 'w1:p3']);

    // A ocupa la mitad izquierda completa.
    expect(panes[0]?.rect).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    // B y C se reparten la mitad derecha en vertical con ratio 0.4.
    expect(panes[1]?.rect.x).toBeCloseTo(0.5);
    expect(panes[1]?.rect.w).toBeCloseTo(0.5);
    expect(panes[1]?.rect.h).toBeCloseTo(0.4);
    expect(panes[2]?.rect.y).toBeCloseTo(0.4);
    expect(panes[2]?.rect.h).toBeCloseTo(0.6);
  });

  it('guarda la ruta de decisiones de cada nodo', () => {
    const root = buildTree(THREE_PANES);
    const [paneA, paneB, paneC] = paneNodes(root);
    expect(paneA?.path).toEqual([false]);
    expect(paneB?.path).toEqual([true, false]);
    expect(paneC?.path).toEqual([true, true]);
    expect(root?.path).toEqual([]);
  });

  it('propaga cwd, label y command de la hoja', () => {
    const root = buildTree(THREE_PANES);
    const panes = paneNodes(root);
    expect(panes[0]?.cwd).toBe('C:\\uno');
    expect(panes[2]?.label).toBe('logs');
  });

  it('devuelve null sin árbol', () => {
    expect(buildTree(null)).toBeNull();
  });

  it('un nodo hoja suelto ocupa el área completa', () => {
    const root = buildTree({ type: 'pane', pane_id: 'w1:p9' });
    expect(root?.kind).toBe('pane');
    expect(root?.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe('dividersOf', () => {
  it('devuelve un divisor por split con su ruta y su línea', () => {
    const dividers = dividersOf(buildTree(THREE_PANES));
    expect(dividers).toHaveLength(2);

    const vertical = dividers.find((divider) => divider.direction === 'right');
    expect(vertical?.path).toEqual([]);
    expect(vertical?.x1).toBeCloseTo(0.5);
    expect(vertical?.y1).toBeCloseTo(0);
    expect(vertical?.y2).toBeCloseTo(1);

    const horizontal = dividers.find((divider) => divider.direction === 'down');
    expect(horizontal?.path).toEqual([true]);
    expect(horizontal?.y1).toBeCloseTo(0.4);
    expect(horizontal?.x1).toBeCloseTo(0.5);
    expect(horizontal?.x2).toBeCloseTo(1);
  });

  it('sin splits no hay divisores', () => {
    expect(dividersOf(buildTree({ type: 'pane', pane_id: 'w1:p1' }))).toEqual([]);
    expect(dividersOf(null)).toEqual([]);
  });
});

describe('dividerAt', () => {
  it('encuentra el divisor vertical por su x', () => {
    const root = buildTree(THREE_PANES);
    expect(dividerAt(root, 0.5, 0.8)?.direction).toBe('right');
  });

  it('encuentra el divisor horizontal por su y dentro de su tramo', () => {
    const root = buildTree(THREE_PANES);
    const divider = dividerAt(root, 0.75, 0.4);
    expect(divider?.direction).toBe('down');
    expect(divider?.path).toEqual([true]);
  });

  it('no encuentra nada lejos de los divisores', () => {
    const root = buildTree(THREE_PANES);
    expect(dividerAt(root, 0.2, 0.8)).toBeNull();
    // El divisor horizontal solo cubre la mitad derecha: en x=0.2 no existe.
    expect(dividerAt(root, 0.2, 0.4, 0.02)).toBeNull();
  });
});

describe('findPane y zoomedTree', () => {
  it('encuentra un panel por id', () => {
    const root = buildTree(THREE_PANES);
    expect(findPane(root, 'w1:p3')?.label).toBe('logs');
    expect(findPane(root, 'w1:px')).toBeNull();
  });

  it('con zoom devuelve solo el panel enfocado ocupando el área', () => {
    const root = buildTree(THREE_PANES);
    const zoomed = zoomedTree(root, 'w1:p2');
    expect(paneNodes(zoomed)).toHaveLength(1);
    expect(zoomed?.paneId).toBe('w1:p2');
    expect(zoomed?.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('sin panel enfocado o sin zoom devuelve el árbol completo', () => {
    const root = buildTree(THREE_PANES);
    expect(zoomedTree(root, null)).toBe(root);
    expect(paneNodes(zoomedTree(root, 'w1:p2'))).toHaveLength(1);
  });
});

describe('neighborPane (navegación local, R11)', () => {
  const root = () => buildTree(THREE_PANES);

  it('a la derecha de A está B', () => {
    expect(neighborPane(root(), 'w1:p1', 'right')?.paneId).toBe('w1:p2');
  });

  it('a la izquierda de B está A', () => {
    expect(neighborPane(root(), 'w1:p2', 'left')?.paneId).toBe('w1:p1');
  });

  it('hacia abajo desde B está C y hacia arriba desde C está B', () => {
    expect(neighborPane(root(), 'w1:p2', 'down')?.paneId).toBe('w1:p3');
    expect(neighborPane(root(), 'w1:p3', 'up')?.paneId).toBe('w1:p2');
  });

  it('sin vecino en esa dirección devuelve null', () => {
    expect(neighborPane(root(), 'w1:p1', 'left')).toBeNull();
    expect(neighborPane(root(), 'w1:p1', 'up')).toBeNull();
    expect(neighborPane(root(), 'w1:p2', 'up')).toBeNull();
  });

  it('un panel desconocido no tiene vecinos', () => {
    expect(neighborPane(root(), 'w9:p9', 'right')).toBeNull();
  });
});
