// @vitest-environment jsdom
// T2.4 — Conteo de bloqueados al overlay del icono de la barra de tareas.
// Se manda al backend solo cuando el número CAMBIA (cero IPC por refresco) y si
// el command no existe se sigue sin overlay, con un único aviso.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<number | null> = [];
let outcome:
  | { ok: true; value: unknown }
  | { ok: false; kind: 'missing' | 'error'; error: { code: string; message: string } } = {
  ok: true,
  value: { count: null, applied: true },
};

vi.mock('../herdr/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../herdr/client')>();
  return {
    ...actual,
    taskbarOverlay: vi.fn(async (count: number | null) => {
      calls.push(count);
      return outcome;
    }),
  };
});

import { resetBlockedOverlay, syncBlockedOverlay } from './taskbarOverlay';

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  calls.length = 0;
  resetBlockedOverlay();
  outcome = { ok: true, value: { count: null, applied: true } };
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('overlay de bloqueados (T2.4)', () => {
  it('manda el conteo y no repite la llamada si no cambia', async () => {
    expect(await syncBlockedOverlay(2)).toBe(true);
    expect(calls).toEqual([2]);

    expect(await syncBlockedOverlay(2)).toBe(false);
    expect(calls).toEqual([2]);

    expect(await syncBlockedOverlay(3)).toBe(true);
    expect(calls).toEqual([2, 3]);
  });

  it('cero bloqueados quita el overlay (null) y también se cachea', async () => {
    await syncBlockedOverlay(1);
    await syncBlockedOverlay(0);
    expect(calls).toEqual([1, null]);

    await syncBlockedOverlay(0);
    expect(calls).toEqual([1, null]);
  });

  it('si el command no está en el backend avisa una sola vez y sigue', async () => {
    outcome = {
      ok: false,
      kind: 'missing',
      error: { code: 'missing_command', message: 'Command taskbar_overlay not found' },
    };

    expect(await syncBlockedOverlay(1)).toBe(true);
    expect(await syncBlockedOverlay(2)).toBe(true);
    expect(calls).toEqual([1, 2]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
