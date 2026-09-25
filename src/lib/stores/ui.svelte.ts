// Estado de UI de la GUI (no viene de herdr). F0 solo cubre lo que el spike
// necesita: nivel de glass, foco local (R11) y las líneas del scroll de rueda.

import { es } from '../i18n/es';

export type GlassMode = 'auto' | 'full' | 'off';

const STORAGE_KEY = 'herdr-desk.ui';

interface PersistedUi {
  glassMode?: GlassMode;
  syncFocusWithTui?: boolean;
  mouseScrollLines?: number;
  sidebarCollapsed?: boolean;
}

class UiStore {
  /** R2: 'auto' respeta el sistema, 'full' fuerza el glass, 'off' lo apaga. */
  glassMode = $state<GlassMode>('auto');
  /** R11: off por defecto, la GUI usa foco local para no mover la TUI. */
  syncFocusWithTui = $state(false);
  mouseScrollLines = $state(3);
  sidebarCollapsed = $state(false);
  paletteOpen = $state(false);
  /** Foco local: el panel que la GUI considera enfocado (no toca herdr). */
  localFocusedWorkspaceId = $state<string | null>(null);
  localFocusedPaneId = $state<string | null>(null);
  /** false cuando el backend avisa que Mica no está disponible (Windows 10). */
  micaAvailable = $state(true);

  restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedUi;
      if (parsed.glassMode) this.glassMode = parsed.glassMode;
      if (typeof parsed.syncFocusWithTui === 'boolean') {
        this.syncFocusWithTui = parsed.syncFocusWithTui;
      }
      if (typeof parsed.mouseScrollLines === 'number') {
        this.mouseScrollLines = parsed.mouseScrollLines;
      }
      if (typeof parsed.sidebarCollapsed === 'boolean') {
        this.sidebarCollapsed = parsed.sidebarCollapsed;
      }
    } catch {
      // Preferencias corruptas: se sigue con los valores por defecto.
    }
  }

  persist(): void {
    const data: PersistedUi = {
      glassMode: this.glassMode,
      syncFocusWithTui: this.syncFocusWithTui,
      mouseScrollLines: this.mouseScrollLines,
      sidebarCollapsed: this.sidebarCollapsed,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Sin localStorage la GUI funciona igual; solo no recuerda preferencias.
    }
  }

  /** Escribe los atributos que consumen tokens.css y app.css. */
  applyGlass(mica = this.micaAvailable): void {
    this.micaAvailable = mica;
    const root = document.documentElement;
    root.dataset.glass =
      this.glassMode === 'off' ? 'off' : this.glassMode === 'full' ? 'force' : 'on';
    root.dataset.mica = mica ? 'on' : 'off';
    root.lang = 'es';
  }

  setGlassMode(mode: GlassMode): void {
    this.glassMode = mode;
    this.applyGlass();
    this.persist();
  }

  setSyncFocusWithTui(value: boolean): void {
    this.syncFocusWithTui = value;
    this.persist();
  }

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    this.persist();
  }

  focusWorkspaceLocally(workspaceId: string): void {
    this.localFocusedWorkspaceId = workspaceId;
  }

  focusPaneLocally(paneId: string): void {
    this.localFocusedPaneId = paneId;
  }

  openPalette(): void {
    this.paletteOpen = true;
  }

  closePalette(): void {
    this.paletteOpen = false;
  }

  togglePalette(): void {
    this.paletteOpen = !this.paletteOpen;
  }

  statusLabel(status: keyof typeof es.agentStatus): string {
    return es.agentStatus[status];
  }
}

export const ui = new UiStore();
