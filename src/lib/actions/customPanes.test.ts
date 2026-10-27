// @vitest-environment jsdom
// T4b — el panel abierto por un comando `pane`/`popup` se cierra con
// `pane_exited` usando SU id, no "el último abierto". Si el server ya lo quitó
// del snapshot no se manda un `pane.close` de más.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type EventHandler = (event: { event: string; data: { pane_id: string } }) => void;

const state = vi.hoisted(() => ({
  emit: null as EventHandler | null,
  closeWatch: vi.fn(),
  closePane: vi.fn(async () => undefined),
}));

vi.mock('../herdr/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../herdr/client')>();
  return {
    ...actual,
    watchEvents: vi.fn(async (_types: string[], handler: EventHandler) => {
      state.emit = handler;
      return { close: state.closeWatch };
    }),
  };
});

vi.mock('../herdr/actions', () => ({
  paneApi: { close: state.closePane },
}));

vi.mock('../stores/layout.svelte', () => ({
  layout: { refreshNow: vi.fn(async () => undefined) },
}));

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

import { session } from '../stores/session.svelte';
import { stopCustomPaneWatch, trackCustomPane } from './customPanes';

function pane(id: string): (typeof session.panes)[number] {
  return { pane_id: id } as (typeof session.panes)[number];
}

beforeEach(() => {
  stopCustomPaneWatch();
  state.emit = null;
  state.closeWatch.mockClear();
  state.closePane.mockClear();
  session.panes = [pane('w1:p1')];
});

afterEach(() => {
  stopCustomPaneWatch();
});

describe('T4b — cierre automático de paneles de comando', () => {
  it('se suscribe a pane.exited al crear el primer pane temporal', async () => {
    trackCustomPane('w1:p2');
    await vi.waitFor(() => expect(state.emit).not.toBeNull());
    expect(state.emit).toBeTypeOf('function');
  });

  it('cierra solo el pane cuyo id llega en pane_exited', async () => {
    trackCustomPane('w1:p2');
    trackCustomPane('w1:p3');
    await vi.waitFor(() => expect(state.emit).not.toBeNull());
    session.panes = [pane('w1:p1'), pane('w1:p2'), pane('w1:p3')];

    state.emit?.({ event: 'pane.exited', data: { pane_id: 'w1:p2' } });

    await vi.waitFor(() => expect(state.closePane).toHaveBeenCalledTimes(1));
    expect(state.closePane).toHaveBeenCalledWith('w1:p2');
    // Sigue habiendo un pane temporal: la suscripción no se cierra aún.
    expect(state.closeWatch).not.toHaveBeenCalled();
  });

  it('no manda pane.close si el server ya quitó el pane del snapshot', async () => {
    trackCustomPane('w1:p2');
    await vi.waitFor(() => expect(state.emit).not.toBeNull());
    session.panes = [pane('w1:p1')];

    state.emit?.({ event: 'pane.exited', data: { pane_id: 'w1:p2' } });

    await vi.waitFor(() => expect(state.closeWatch).toHaveBeenCalledTimes(1));
    expect(state.closePane).not.toHaveBeenCalled();
  });

  it('ignora eventos de panes que no abrió un comando', async () => {
    trackCustomPane('w1:p2');
    await vi.waitFor(() => expect(state.emit).not.toBeNull());

    state.emit?.({ event: 'pane.exited', data: { pane_id: 'w1:p1' } });
    await Promise.resolve();

    expect(state.closePane).not.toHaveBeenCalled();
    expect(state.closeWatch).not.toHaveBeenCalled();
  });
});
