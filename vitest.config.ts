import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.ts';

// Unitarios puros (frames, errores, helpers del snapshot). La UI y el IPC se
// prueban en tests/e2e con Playwright, así que aquí no hace falta jsdom.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**', 'src-tauri/**', 'crates/**'],
      reporters: 'default',
    },
  }),
);
