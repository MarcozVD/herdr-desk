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

/** Reintentos del export cuando el árbol no cuadra con el snapshot. */
export const LAYOUT_EXPORT_ATTEMPTS = 3;
/** Espera entre reintentos del export (ms). */
export const LAYOUT_EXPORT_RETRY_MS = 150;

class LayoutStore {
  tabId = $state<string | null>(null);
  tree = $state.raw<TreeNode | null>(null);
  zoomed = $state(false);
  error = $state<string | null>(null);
  /** Sube con cada export aplicado. */
  revision = $state(0);

  #inFlight = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
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

  /**
   * ¿El árbol exportado trae los mismos panes que el snapshot atribuye al tab?
   *
   * El server puede responder un `layout.export` ANTERIOR justo después de un
   * split o un cierre (el export se pide en cuanto sube `session.revision`, pero
   * su layout todavía no se ha publicado). Sin esta comprobación la UI se
   * quedaba con un árbol viejo —el panel nuevo no aparecía y el cerrado seguía
   * en pantalla con su overlay— hasta el siguiente evento de la sesión.
   */
  #matchesSnapshot(tabId: string, tree: TreeNode | null): boolean {
    const expected = session.layouts.find((layout) => layout.tab_id === tabId)?.panes;
    if (!expected) return true; // sin referencia (tab recién creado) no se juzga
    const want = expected
      .map((pane) => pane.pane_id)
      .sort()
      .join('\u0000');
    const have = paneNodes(tree)
      .map((node) => node.paneId ?? '')
      .sort()
      .join('\u0000');
    return want === have;
  }

  async #load(tabId: string, attempt = 1): Promise<void> {
    if (this.#inFlight) {
      // Ya hay una petición en vuelo: se reintenta al terminar.
      this.#lastKey = '';
      this.schedule(tabId, session.revision, 60);
      return;
    }
    this.#inFlight = true;
    let retry = false;
    try {
      const root = await layoutApi.export(tabId);
      const tree = buildTree(root);
      if (attempt < LAYOUT_EXPORT_ATTEMPTS && !this.#matchesSnapshot(tabId, tree)) {
        retry = true;
      } else {
        this.tabId = tabId;
        this.tree = tree;
        this.zoomed = session.layouts.find((layout) => layout.tab_id === tabId)?.zoomed ?? false;
        this.error = null;
        this.revision += 1;
      }
    } catch (raw) {
      this.error = parseApiError(raw).message;
    } finally {
      this.#inFlight = false;
      if (retry) {
        if (this.#retryTimer !== null) clearTimeout(this.#retryTimer);
        this.#retryTimer = setTimeout(() => {
          this.#retryTimer = null;
          void this.#load(tabId, attempt + 1);
        }, LAYOUT_EXPORT_RETRY_MS);
      }
    }
  }

  get paneCount(): number {
    return paneNodes(this.tree).length;
  }

  reset(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#retryTimer !== null) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#inFlight = false;
    this.#lastKey = '';
    this.tabId = null;
    this.tree = null;
    this.zoomed = false;
    this.revision = 0;
  }
}

export const layout = new LayoutStore();
