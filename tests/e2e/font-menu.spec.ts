// Verificación en vivo (navegador real) de la tipografía de las terminales y de
// la supresión del menú de contexto nativo:
//   - la instancia real de xterm (registro `__HD_TERMS__`, solo en dev) usa una
//     pila de familias resuelta, nunca `var(--font-mono)`;
//   - el tamaño de celda que xterm mide coincide con la primera familia
//     disponible de la pila (prueba de que la fuente se aplicó de verdad);
//   - un contextmenu en una zona sin menú propio queda cancelado;
//   - un contextmenu en el terminal abre el menú de la app (no se anula).

import { expect, test } from '@playwright/test';

import { bootApp } from './harness';

interface FontReport {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cellWidth: number;
  measuredCell: number;
  anchos: Array<{ familia: string; ancho: number; disponible: boolean }>;
}

test('la terminal usa una pila real de familias y el tamaño de celda es coherente', async ({
  page,
}) => {
  await bootApp(page);
  await expect(page.getByTestId('terminal-host').first()).toBeVisible();
  await page.waitForFunction(() => {
    const registry = (window as unknown as { __HD_TERMS__?: Record<string, unknown> }).__HD_TERMS__;
    return Boolean(registry && Object.keys(registry).length > 0);
  });

  const report = await page.evaluate((): FontReport => {
    const registry = (window as unknown as { __HD_TERMS__?: Record<string, unknown> }).__HD_TERMS__;
    const term = Object.values(registry ?? {})[0] as {
      options: { fontFamily: string; fontSize: number; lineHeight: number };
      _core?: { _renderService?: { dimensions?: { css?: { cell?: { width?: number } } } } };
    };
    const canvas = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    const familias = term.options.fontFamily.split(',').map((item) => item.trim());
    const anchos = familias.map((familia) => {
      canvas.font = `${term.options.fontSize}px ${familia}`;
      return {
        familia,
        ancho: canvas.measureText('M').width,
        disponible: document.fonts.check(`${term.options.fontSize}px ${familia}`),
      };
    });
    return {
      fontFamily: term.options.fontFamily,
      fontSize: term.options.fontSize,
      lineHeight: term.options.lineHeight,
      cellWidth: term._core?._renderService?.dimensions?.css?.cell?.width ?? 0,
      measuredCell:
        document.querySelector('.xterm-char-measure-element')?.getBoundingClientRect().width ?? 0,
      anchos,
    };
  });

  console.log(`[hd-font] ${JSON.stringify(report)}`);

  expect(report.fontFamily).not.toContain('var(');
  // La primera familia va citada: es un nombre real, no una variable CSS.
  expect(report.fontFamily).toMatch(/^'[^']+'/);
  expect(report.fontFamily).toContain('monospace');
  expect(report.fontSize).toBeGreaterThan(8);
  expect(report.lineHeight).toBeGreaterThanOrEqual(1);

  // La clave: la PRIMERA familia de la pila existe en el sistema, así que es la
  // que el navegador usa para pintar (antes llegaba `var(--font-mono)` literal,
  // que no resuelve, y se caía a la mono por defecto).
  const primera = report.anchos[0];
  expect(primera, 'la pila debe empezar por una familia real').toBeTruthy();
  expect(primera?.disponible, `"${primera?.familia}" debe existir en el sistema`).toBe(true);
  expect(primera?.familia.toLowerCase()).not.toContain('monospace');
  // xterm mide la celda (truncada a píxeles) y las familias de la pila no miden
  // lo mismo, así que la celda tiene que caer en el rango de la primera.
  expect(report.cellWidth).toBeGreaterThan(0);
  expect(report.cellWidth).toBeLessThanOrEqual(Math.ceil((primera?.ancho ?? 0) + 1));
  expect(report.cellWidth).toBeGreaterThanOrEqual(Math.floor((primera?.ancho ?? 0) - 2));
});

test('el menú de contexto nativo queda suprimido y el de la app sigue abriéndose', async ({
  page,
}) => {
  await bootApp(page);
  await expect(page.getByTestId('terminal-host').first()).toBeVisible();

  // Zona sin menú propio (la barra de estado): el evento viene cancelado.
  const cancelado = await page.evaluate(() => {
    const zona = document.querySelector('[data-testid="statusbar"]') ?? document.body;
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    zona.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(cancelado).toBe(true);
  await expect(page.getByTestId('context-menu')).toHaveCount(0);

  // Terminal: se cancela el nativo y se abre el menú propio (copiar/pegar).
  await page.getByTestId('terminal-host').first().click({ button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId('context-item').first()).toBeVisible();
  await expect(menu.getByTestId('context-item').first()).toHaveText(/\S/);

  // Y se cierra con clic fuera, como siempre.
  await page.mouse.click(5, 5);
  await expect(menu).toHaveCount(0);
});
