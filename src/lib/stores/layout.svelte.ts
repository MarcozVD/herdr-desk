// T1.7 — Árbol de paneles del tab visible. Se pide `layout.export` al backend y se
// vuelve a pedir cuando cambia el tab o cuando llega un snapshot nuevo (el store
// coalesce los eventos: `session.revision` sube en cada refresco).
//
// `schedule()` no lee estado reactivo a propósito: se llama desde un `$effect` que
// ya lee `session.focusedTabId`/`session.revision`, y si además leyera y escribiera
// las runas de este store Svelte cortaría por `effect_update_depth_exceeded`.

import { layoutApi } from '../herdr/actions';
import { parseApiError } from '../herdr/errors';
import { buildTree, paneNodes, type TreeNode } from '../layout/tree';
import { session } from './session.svelte';

class LayoutStore {
  tabId = $state<string | null>(null);
  tree = $state.raw<TreeNode | null>(null);
  zoomed = $state(false);
  error = $state<string | null>(null);
  /** Sube con cada export aplicado. */
  revision = $state(0);

  #inFlight = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  /** Última petición programada (clave no reactiva: ver cabecera). */
  #lastKey = '';

  /** Programa el export del tab (con debounce) sin tocar runas. */
  schedule(tabId: string | null, revision: number, delayMs = 30): void {
    const key = `${tabId ?? ''}#${revision}`;
    if (key === this.#lastKey) return;
    this.#lastKey = key;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (tabId === null) {
        this.#applyEmpty();
        return;
      }
      void this.#load(tabId);
    }, delayMs);
  }

  /** Export inmediato (al reconectar): ignora el debounce. */
  async refreshNow(tabId: string | null = this.tabId): Promise<void> {
    if (tabId === null) {
      this.#applyEmpty();
      return;
    }
    this.#lastKey = `${tabId}#${session.revision}`;
    await this.#load(tabId);
  }

  #applyEmpty(): void {
    this.tabId = null;
    this.tree = null;
    this.zoomed = false;
    this.revision += 1;
  }

  async #load(tabId: string): Promise<void> {
    if (this.#inFlight) {
      // Ya hay una petición en vuelo: se reintenta al terminar.
      this.#lastKey = '';
      this.schedule(tabId, session.revision, 60);
      return;
    }
    this.#inFlight = true;
    try {
      const root = await layoutApi.export(tabId);
      this.tabId = tabId;
      this.tree = buildTree(root);
      this.zoomed = session.layouts.find((layout) => layout.tab_id === tabId)?.zoomed ?? false;
      this.error = null;
      this.revision += 1;
    } catch (raw) {
      this.error = parseApiError(raw).message;
    } finally {
      this.#inFlight = false;
    }
  }

  get paneCount(): number {
    return paneNodes(this.tree).length;
  }

  reset(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#lastKey = '';
    this.tabId = null;
    this.tree = null;
    this.zoomed = false;
    this.revision = 0;
  }
}

export const layout = new LayoutStore();
