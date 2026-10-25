// @vitest-environment jsdom
// BUG 6 — Estado efímero y de foco local del store de UI.
//   · punto 2: el recuerdo del último tab por espacio no apunta a tabs muertos.
//   · punto 4: el foco local se reconcilia con el snapshot.
//   · punto 6: `resetSessionState` limpia TODO el estado efímero y resuelve las
//     promesas pendientes (nada de `await`s colgados entre sesiones).
//   · punto 7: una sola implementación de «¿este id local existe?».

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../herdr/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../herdr/client')>();
  return {
    ...actual,
    call: vi.fn(async () => ({ type: 'ok' })),
    storeSubscribe: vi.fn(async () => undefined),
    sessionCurrent: vi.fn(async () => ({ ok: true, value: 'herdr-desk-dev' })),
  };
});

import { isKnownId, pickKnownId } from './ids';
import { ui } from './ui.svelte';

beforeEach(() => {
  ui.resetSessionState();
});

describe('punto 2 — pruneTabMemory', () => {
  it('olvida los tabs que ya no existen y conserva los vivos', () => {
    ui.tabByWorkspace = { w1: 'w1:t1', w2: 'w2:t9' };
    ui.pruneTabMemory(['w1:t1', 'w1:t2']);
    expect(ui.tabByWorkspace).toEqual({ w1: 'w1:t1' });
  });

  it('no borra nada si la lista viene vacía (reconectando)', () => {
    ui.tabByWorkspace = { w1: 'w1:t1' };
    ui.pruneTabMemory([]);
    expect(ui.tabByWorkspace).toEqual({ w1: 'w1:t1' });
  });
});

describe('punto 4 — reconcileLocalFocus', () => {
  it('descarta ids locales que ya no existen y poda el historial', () => {
    ui.localFocusedWorkspaceId = 'w9';
    ui.localFocusedTabId = 'w9:t9';
    ui.localFocusedPaneId = 'w9:p9';
    ui.paneHistory = ['w9:p9', 'w1:p1'];

    ui.reconcileLocalFocus({ panes: ['w1:p1'], tabs: ['w1:t1'], workspaces: ['w1'] });

    expect(ui.localFocusedWorkspaceId).toBeNull();
    expect(ui.localFocusedTabId).toBeNull();
    expect(ui.localFocusedPaneId).toBeNull();
    expect(ui.paneHistory).toEqual(['w1:p1']);
  });

  it('conserva los ids que siguen existiendo', () => {
    ui.focusPaneLocally('w1:p1');
    ui.reconcileLocalFocus({ panes: ['w1:p1'], tabs: ['w1:t1'], workspaces: ['w1'] });
    expect(ui.localFocusedPaneId).toBe('w1:p1');
  });

  it('no reasigna el historial si no cambia (evita bucles de effect)', () => {
    ui.paneHistory = ['w1:p1', 'w1:p2'];
    const before = ui.paneHistory;
    ui.reconcileLocalFocus({
      panes: ['w1:p1', 'w1:p2'],
      tabs: ['w1:t1'],
      workspaces: ['w1'],
    });
    expect(ui.paneHistory).toBe(before);
  });
});

describe('punto 6 — resetSessionState limpia el estado efímero', () => {
  it('cierra menús, toasts y diálogos y resuelve sus promesas', async () => {
    ui.openContextMenu({ x: 1, y: 2, items: [] });
    ui.notify('hola');
    ui.openPalette();
    ui.openSessions();
    const confirm = ui.confirm({ title: 't', message: 'm' });
    const prompt = ui.prompt({ title: 't', label: 'l' });
    const form = ui.workspaceForm({ title: 't' });

    ui.resetSessionState();

    expect(ui.contextMenu).toBeNull();
    expect(ui.toasts).toEqual([]);
    expect(ui.pendingConfirm).toBeNull();
    expect(ui.pendingPrompt).toBeNull();
    expect(ui.pendingWorkspaceForm).toBeNull();
    expect(ui.paletteOpen).toBe(false);
    expect(ui.sessionsOpen).toBe(false);

    await expect(confirm).resolves.toBe(false);
    await expect(prompt).resolves.toBeNull();
    await expect(form).resolves.toBeNull();
  });

  it('no deja timers de toast vivos (no reaparecen tras limpiar)', async () => {
    vi.useFakeTimers();
    ui.notify('uno');
    ui.resetSessionState();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ui.toasts).toEqual([]);
    vi.useRealTimers();
  });
});

describe('punto 7 — predicado compartido de ids', () => {
  it('isKnownId rechaza null y los desconocidos', () => {
    expect(isKnownId(null, ['a'])).toBe(false);
    expect(isKnownId('b', ['a'])).toBe(false);
    expect(isKnownId('a', ['a'])).toBe(true);
  });

  it('actionTarget cae al servidor si el id local no existe', () => {
    ui.localFocusedPaneId = 'w1:t2'; // un tab guardado por error como panel
    const target = ui.actionTarget({
      server: { paneId: 'w1:p1', tabId: 'w1:t1', workspaceId: 'w1' },
      panes: ['w1:p1'],
      tabs: ['w1:t1'],
      workspaces: ['w1'],
    });
    expect(target.paneId).toBe('w1:p1');
    expect(pickKnownId('w1:p1', ['w1:p1'], null)).toBe('w1:p1');
  });
});
