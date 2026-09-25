import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';

// Globals del navegador que usa la SPA. Se declaran a mano para no arrastrar
// dependencias extra solo por la lista de globals.
const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  console: 'readonly',
  performance: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  ResizeObserver: 'readonly',
  IntersectionObserver: 'readonly',
  MutationObserver: 'readonly',
  IntersectionObserverEntry: 'readonly',
  HTMLElement: 'readonly',
  HTMLDivElement: 'readonly',
  Element: 'readonly',
  Node: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  KeyboardEvent: 'readonly',
  MouseEvent: 'readonly',
  WheelEvent: 'readonly',
  DOMRect: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  queueMicrotask: 'readonly',
  structuredClone: 'readonly',
  localStorage: 'readonly',
  matchMedia: 'readonly',
  crypto: 'readonly',
  process: 'readonly',
  globalThis: 'readonly',
};

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'target/**',
      'src-tauri/**',
      'crates/**',
      'schema/**',
      'scripts/**',
      'docs/**',
      '.hermes/**',
      'test-results/**',
      'playwright-report/**',
      // Generados por scripts/gen-types.mjs
      'src/lib/herdr/*.gen.ts',
    ],
  },
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
      },
      globals: browserGlobals,
    },
  },
  {
    files: ['**/*.ts', '**/*.js'],
    languageOptions: {
      globals: browserGlobals,
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
