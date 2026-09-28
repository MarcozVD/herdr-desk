// T3.10 — Estado git de los espacios visibles para los tokens `branch` y
// `git_status` de la sidebar.
//
// El backend lee `git status --porcelain=v2 --branch` (lista blanca). No hay
// watcher de archivos propio (desviación del plan): el refresco va atado a las
// revisiones del snapshot (que ya sube con cada evento y latido) y se limita a
// una vez cada REFRESH_MS por espacio.

import { gitStatus, type GitStatusInfo } from '../herdr/client';

export interface WorkspaceGit {
  cwd: string;
  info: GitStatusInfo | null;
  at: number;
}

const REFRESH_MS = 3000;

class GitStatusStore {
  byWorkspace = $state<Record<string, WorkspaceGit>>({});
  #inflight = new Set<string>();
  #lastAt = 0;

  /** Refresca los estados de los espacios indicados (con cwd conocido). */
  async refresh(list: ReadonlyArray<{ workspaceId: string; cwd: string | null }>): Promise<void> {
    const now = Date.now();
    if (now - this.#lastAt < REFRESH_MS) return;
    this.#lastAt = now;
    for (const { workspaceId, cwd } of list) {
      if (!cwd || this.#inflight.has(workspaceId)) continue;
      const previous = this.byWorkspace[workspaceId];
      if (previous?.cwd === cwd && now - previous.at < REFRESH_MS) continue;
      this.#inflight.add(workspaceId);
      void gitStatus(cwd).then((outcome) => {
        this.#inflight.delete(workspaceId);
        // Backend sin el command (`missing`) o error puntual: sin tokens.
        if (!outcome.ok) return;
        this.byWorkspace = {
          ...this.byWorkspace,
          [workspaceId]: { cwd, info: outcome.value ?? null, at: Date.now() },
        };
      });
    }
  }

  infoOf(workspaceId: string): GitStatusInfo | null {
    return this.byWorkspace[workspaceId]?.info ?? null;
  }

  reset(): void {
    this.byWorkspace = {};
    this.#lastAt = 0;
  }
}

export const gitStatuses = new GitStatusStore();
