// T3.3 — Presets de layout: validación del árbol (LayoutNode) y nombres.
//
// Los presets se guardan en los ajustes de la GUI (settings.json) como
// `layout_presets`: { nombre: LayoutNode }. Al aplicarlos se validan contra el
// contrato del schema antes de llamar a `layout.apply`.

import type { LayoutNode } from '../herdr/types.gen';

/** Valida recursivamente el LayoutNode del schema (hoja pane / split con 2). */
export function isLayoutNode(value: unknown): value is LayoutNode {
  if (value === null || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  if (node.type === 'pane') return true;
  if (node.type === 'split') {
    const direction = node.direction;
    if (direction !== 'right' && direction !== 'down') return false;
    if (typeof node.ratio !== 'number' || node.ratio < 0 || node.ratio > 1) return false;
    return isLayoutNode(node.first) && isLayoutNode(node.second);
  }
  return false;
}

/** Nombre de preset seguro para settings.json: letras, números, «-», «_», «.», espacios. */
export function sanitizePresetName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0 || name.length > 40) return null;
  if (!/^[\w][\w .-]*$/.test(name)) return null;
  return name;
}

/** Nombres ordenados de los presets guardados. */
export function presetNames(presets: Record<string, unknown>): string[] {
  return Object.keys(presets).sort((a, b) => a.localeCompare(b, 'es'));
}

/** Copia de los presets sin el nombre indicado (para quitar uno). */
export function withoutPreset(
  presets: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  const next = { ...presets };
  delete next[name];
  return next;
}
