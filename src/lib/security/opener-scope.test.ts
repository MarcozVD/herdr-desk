// BUG 8 — La capability de `opener:allow-open-path` tiene que llevar SCOPE de
// rutas: sin él, `openPath(...)` quedaba denegado en runtime (y con `**` abriría
// cualquier ruta del disco). Solo se abren el temp de scrollback
// (`herdr-desk-*`) y el directorio de config de herdr.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Permission = string | { identifier: string; allow?: Array<{ path?: string }> };

const capability = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src-tauri/capabilities/default.json'), 'utf-8'),
) as { permissions: Permission[] };

function openPathPermission():
  { identifier: string; allow?: Array<{ path?: string }> } | undefined {
  return capability.permissions.find(
    (permission): permission is { identifier: string; allow?: Array<{ path?: string }> } =>
      typeof permission !== 'string' && permission.identifier === 'opener:allow-open-path',
  );
}

describe('capability opener:allow-open-path (BUG 8)', () => {
  it('lleva scope de rutas y no una entrada suelta sin scope', () => {
    expect(openPathPermission()).toBeTruthy();
  });

  it('acota a temp de scrollback y al config dir de herdr, sin `**` global', () => {
    const paths = (openPathPermission()?.allow ?? []).map((entry) => entry.path ?? '');
    expect(paths.length).toBeGreaterThan(0);
    expect(paths).not.toContain('**');
    expect(paths).not.toContain('$HOME/**');
    expect(paths.some((path) => path.startsWith('$TEMP/'))).toBe(true);
    expect(paths.some((path) => path === '$DATA/herdr' || path.startsWith('$DATA/herdr/'))).toBe(
      true,
    );
  });
});
