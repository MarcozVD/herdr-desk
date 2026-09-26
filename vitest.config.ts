import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.ts';

// Unitarios puros (frames, errores, helpers del snapshot) y de componentes. La UI
// completa y el IPC se prueban en tests/e2e con Playwright; los tests de
// componente (p. ej. CardSplitAccordion) piden jsdom por archivo con el docblock
// `// @vitest-environment jsdom`.
export default mergeConfig(
  viteConfig,
  defineConfig({
    // Sin esto, `svelte` resuelve al build de servidor y `mount()` falla con
    // «lifecycle_function_unavailable: mount(...) is not available on the server».
    resolve: {
      conditions: ['browser'],
    },
    // El runtime de svelte/motion usa `BROWSER` (de esm-env) para decidir si el
    // bucle de animación llama a requestAnimationFrame: sin esto los Spring no
    // avanzan nunca en los tests.
    ssr: {
      resolve: {
        conditions: ['browser'],
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**', 'src-tauri/**', 'crates/**'],
      reporters: 'default',
    },
  }),
);
