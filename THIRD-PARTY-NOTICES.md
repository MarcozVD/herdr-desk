# Avisos de terceros

herdr-desk se distribuye bajo la licencia Apache 2.0 (ver `LICENSE`). Incluye o se basa en
material de terceros que se lista aquí con su licencia original.

## herdr

- Proyecto: https://github.com/herdrdev/herdr
- Licencia: Apache License 2.0
- Copyright: los autores de herdr (herdrdev).
- Versión de referencia: 0.8.0-preview, commit `d78e3d3b5126` (protocolo 19).

Material usado en herdr-desk:

- **Paletas de los 18 temas**: transcritas de `src/app/state.rs` a `src/lib/theme/themes.ts`.
  La paleta ANSI de `src/lib/theme/ansi.ts` se deriva de ellas (herdr no trae ANSI propio).
- **Logotipo**: `assets/icons/herdr.svg`, `herdr-white.svg`, `herdr-black.png` y
  `herdr-black.webp`, y los iconos de la aplicación generados a partir de ellos en
  `src-tauri/icons/`, derivados de `assets/logo.svg` de herdr. herdr-desk es una GUI para
  herdr, no un producto oficial de herdrdev; el nombre y el logo identifican la herramienta a
  la que se conecta.
- **Esquema del API**: `schema/herdr-api.schema.json` es la salida de
  `herdr api schema --json`, y `schema/fixtures/` son respuestas grabadas de un servidor herdr.
  Los tipos de `src/lib/herdr/*.gen.ts` se generan desde ese esquema.
- **Protocolo del bridge de terminal**: el formato NDJSON (`terminal.frame`, `terminal.input`,
  `terminal.resize`, `terminal.scroll`, `terminal.release`) se implementó a partir de
  `src/client/terminal_sessions.rs` de herdr. No se copió código.

herdr no publica un archivo NOTICE; si lo añade, su contenido debe reproducirse aquí.

## Dependencias incluidas en el instalador

| Paquete                                                         | Licencia                  |
| --------------------------------------------------------------- | ------------------------- |
| Tauri 2 y sus plugins (`tauri-plugin-*`)                        | MIT o Apache-2.0          |
| xterm.js (`@xterm/xterm` y addons)                              | MIT                       |
| Svelte 5                                                        | MIT                       |
| Lucide (`@lucide/svelte`)                                       | ISC                       |
| Geist Variable (`@fontsource-variable/geist`)                   | SIL Open Font License 1.1 |
| JetBrains Mono Variable (`@fontsource-variable/jetbrains-mono`) | SIL Open Font License 1.1 |
| tokio, serde, serde_json, base64, thiserror, tracing, toml_edit | MIT o Apache-2.0          |
| webview2-com, windows-core                                      | MIT o Apache-2.0          |
| winreg                                                          | MIT                       |

Las licencias completas están en cada paquete (`node_modules/<paquete>/LICENSE` y
`~/.cargo/registry/src/*/<crate>/LICENSE*`).
