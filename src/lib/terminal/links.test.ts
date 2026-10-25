// @vitest-environment jsdom
// Links de la terminal (bug 4): clic abre el navegador; con mouse tracking en
// el pane, hace falta Ctrl/Cmd+clic para no robarle el clic a la app. Además el
// error de `openUrl` se registra en vez de tragarse (diagnóstico del scope del
// plugin opener).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const opened: string[] = [];
let failOpen = false;

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(async (uri: string) => {
    if (failOpen) throw new Error('scope denegado');
    opened.push(uri);
  }),
}));

const { openTerminalLink } = await import('./links');

const plain = { ctrlKey: false, metaKey: false };
const ctrl = { ctrlKey: true, metaKey: false };
const meta = { ctrlKey: false, metaKey: true };

beforeEach(() => {
  opened.length = 0;
  failOpen = false;
  vi.restoreAllMocks();
});

describe('links de la terminal', () => {
  it('sin mouse tracking el clic normal abre el link', async () => {
    openTerminalLink(plain, 'https://example.com', false);
    await vi.waitFor(() => expect(opened).toEqual(['https://example.com']));
  });

  it('con mouse tracking el clic normal NO abre (el clic va a la app)', () => {
    openTerminalLink(plain, 'https://example.com', true);
    expect(opened).toEqual([]);
  });

  it('con mouse tracking, Ctrl o Cmd + clic sí abre el link', async () => {
    openTerminalLink(ctrl, 'https://a.example', true);
    openTerminalLink(meta, 'https://b.example', true);
    await vi.waitFor(() => expect(opened).toEqual(['https://a.example', 'https://b.example']));
  });

  it('si openUrl falla se registra el error (no se traga)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    failOpen = true;

    openTerminalLink(plain, 'https://denegado.example', false);

    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn.mock.calls[0]?.[0]).toContain('https://denegado.example');
    expect(opened).toEqual([]);
  });
});
