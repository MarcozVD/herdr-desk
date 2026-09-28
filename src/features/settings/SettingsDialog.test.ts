// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ui } from '../../lib/stores/ui.svelte';
import SettingsDialog from './SettingsDialog.svelte';

beforeAll(() => {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

let app: Record<string, unknown> | null = null;
afterEach(() => {
  if (app) unmount(app);
  app = null;
  ui.closeSettings();
});

describe('SettingsDialog', () => {
  it('se monta al abrir ui.settingsOpen', () => {
    const target = document.createElement('div');
    document.body.append(target);
    app = mount(SettingsDialog, { target });
    flushSync();
    expect(document.querySelector('[data-testid="settings-dialog"]')).toBeNull();

    ui.openSettings();
    flushSync();
    expect(document.querySelector('[data-testid="settings-dialog"]')).not.toBeNull();
  });
});
