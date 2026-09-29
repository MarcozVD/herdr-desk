// @vitest-environment jsdom
// C1 — Banner persistente de incompatibilidad: versiones visibles y botón que
// lanza el reinicio (con confirmación dentro de `flows.restartSession`).

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ServerCompat } from '../../lib/herdr/types';

const restartSession = vi.fn(async () => undefined);
vi.mock('../../lib/actions/flows', () => ({ flows: { restartSession } }));

const CompatBanner = (await import('./CompatBanner.svelte')).default;
const { session } = await import('../../lib/stores/session.svelte');

function compat(incompatible: boolean): ServerCompat {
  return {
    running: true,
    server_version: incompatible ? '0.8.0-preview' : '0.9.1-preview',
    client_version: '0.9.1-preview',
    private_protocol_compatible: !incompatible,
    restart_needed: incompatible,
    server_protocol: incompatible ? 19 : 22,
    client_protocol: 22,
    server_binary_stale: incompatible,
  };
}

afterEach(() => {
  session.setCompat(null);
  session.sessionName = null;
  document.body.innerHTML = '';
  restartSession.mockClear();
});

describe('C1 — CompatBanner', () => {
  it('muestra sesión, versiones y protocolo; el botón pide reiniciar', () => {
    session.sessionName = 'herdr-desk-dev';
    session.setCompat(compat(true));
    const component = mount(CompatBanner, { target: document.body });
    flushSync();

    const text = document.querySelector('[data-testid="compat-text"]')?.textContent ?? '';
    expect(text).toContain('herdr-desk-dev');
    expect(text).toContain('0.8.0-preview');
    expect(text).toContain('0.9.1-preview');
    expect(text).toContain('protocolo 19');

    const button = document.querySelector<HTMLButtonElement>('[data-testid="compat-restart"]');
    expect(button).not.toBeNull();
    button?.click();
    expect(restartSession).toHaveBeenCalledTimes(1);

    unmount(component);
  });

  it('desaparece en cuanto el server vuelve a ser compatible', () => {
    session.sessionName = 'dev';
    session.setCompat(compat(true));
    const component = mount(CompatBanner, { target: document.body });
    flushSync();
    expect(document.querySelector('[data-testid="compat-banner"]')).not.toBeNull();

    session.setCompat(compat(false));
    flushSync();
    expect(document.querySelector('[data-testid="compat-banner"]')).toBeNull();

    unmount(component);
  });

  it('sin compatibilidad conocida no pinta nada', () => {
    session.sessionName = 'dev';
    const component = mount(CompatBanner, { target: document.body });
    flushSync();
    expect(document.querySelector('[data-testid="compat-banner"]')).toBeNull();
    unmount(component);
  });
});
