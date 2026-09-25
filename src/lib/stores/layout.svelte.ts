// T1.7 — Árbol de paneles del tab visible. Se pide `layout.export` al backend y se
// vuelve a pedir cuando cambia el tab o cuando llega un snapshot nuevo (el store
// coalesce los eventos: `session.revision` sube en cada refresco).

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

  /** Pide el árbol del tab (con debounce para no repetir en ráfaga). */
  request(tabId: string | null, delayMs = 30): void {
    if (tabId === null) {
      this.tabId = null;
      this.tree = null;
      this.revision += 1;
      return;
    }
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#load(tabId);
    }, delayMs);
  }

  async refreshNow(tabId: string | null = this.tabId): Promise<void> {
    if (tabId === null) return;
    await this.#load(tabId);
  }

  async #load(tabId: string): Promise<void> {
    if (this.#inFlight) {
      // Si ya hay una petición en vuelo, se reintenta al terminar.
      this.request(tabId, 60);
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
    this.tabId = null;
    this.tree = null;
    this.zoomed = false;
    this.revision = 0;
  }
}

export const layout = new LayoutStore();
