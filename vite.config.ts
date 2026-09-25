import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// Vite sirve el frontend de herdr-desk. Tauri lo levanta en 1420 (devUrl del
// tauri.conf.json) y embebe dist/ en el build; strictPort evita que Vite cambie
// de puerto en silencio y deje a Tauri apuntando a un servidor inexistente.
export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // El workspace Rust no debe disparar recargas del frontend.
      ignored: ['**/src-tauri/**', '**/crates/**', '**/target/**', '**/.hermes/**'],
    },
  },
  build: {
    // WebView2 en Windows 11 = Edge 120+; no hace falta transpilar a navegadores viejos.
    target: 'chrome120',
    sourcemap: true,
    chunkSizeWarningLimit: 700,
  },
});
