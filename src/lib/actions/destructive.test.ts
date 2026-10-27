// @vitest-environment jsdom
// T4g — El helper de acción destructiva encadena los avisos y se detiene en el
// primero que el usuario cancela. Todos los usos comparten `danger: true`.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ui } from '../stores/ui.svelte';
import { confirmDestructive } from './destructive';

beforeEach(() => {
  ui.resetSessionState();
});

describe('T4g — confirmDestructive', () => {
  it('un solo aviso: devuelve true y aplica danger', async () => {
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(true);

    await expect(confirmDestructive({ title: 't', message: 'm' })).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledWith({ title: 't', message: 'm', danger: true });
  });

  it('encadena dos avisos en orden', async () => {
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(true);

    await confirmDestructive([
      { title: 'uno', message: 'm1' },
      { title: 'dos', message: 'm2' },
    ]);

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[0]?.[0]).toMatchObject({ title: 'uno', danger: true });
    expect(confirm.mock.calls[1]?.[0]).toMatchObject({ title: 'dos', danger: true });
  });

  it('cancela en el primer aviso y no pide el segundo', async () => {
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValueOnce(false);

    await expect(
      confirmDestructive([
        { title: 'uno', message: 'm1' },
        { title: 'dos', message: 'm2' },
      ]),
    ).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
