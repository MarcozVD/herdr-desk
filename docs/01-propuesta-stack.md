# herdr GUI: propuesta de stack (glassmorphism, liviana)

Fecha: 2026-09-25 · herdr 0.8.0-preview (protocol 19, schema_version 1) · Windows 11

## 1. Hallazgos medidos en esta máquina

| Qué | Dato | Cómo se midió |
|---|---|---|
| API | NDJSON sobre named pipe `\\.\pipe\C:\Users\mvale\AppData\Roaming\herdr\herdr.sock`. 90 métodos + 27 tipos de evento | `herdr api schema --json` (261 KB, JSON Schema 2020-12) |
| Latencia pipe directo | 0,31–0,55 ms por request (connect + request + respuesta) | Python, 10 × `workspace.list` |
| Latencia CLI | 51–78 ms por llamada (`herdr workspace list`), unas 150 veces más lento | 5 corridas |
| Conexión | 1 request por conexión (el server cierra después de responder) | 2.º request en la misma conexión devolvió EOF |
| Eventos | `events.subscribe` mantiene la conexión abierta; `pane.created` y `layout.updated` llegaron unos 90 ms después del split (incluye crear ConPTY + shell) | sesión aislada `gui-probe` (ya borrada) |
| Terminal | `herdr terminal session control <pane> --takeover --cols C --rows R`: stdout NDJSON `terminal.frame` (ANSI en base64, `full`/delta, `seq`), stdin NDJSON `terminal.input/resize/scroll/release` | idem |
| Tamaño de frame | frame completo de 100×30 = 55,9 KB; los deltas son chicos | idem |
| Eco tecla→frame | 23–32 ms (incluye ConPTY + shell). Es la base de herdr; la GUI no debe sumar más de 5 ms | idem |
| RAM herdr | server 42 MB privados + cliente TUI 3,9 MB | `Get-Process` |
| RAM de Tauri (referencia) | FocusFlow: exe 8 MB, **243 MB en total** con sus 8 procesos WebView2 | `Get-CimInstance` árbol |
| Disco de Tauri (referencia) | exe 7,8–19,3 MB; NSIS 5,2 MB; MSI 7,3 MB (focusflow/anidesk) | archivos |

Limitaciones de la API:
- El bridge de terminal descarta `ServerMessage::Graphics` (`src/client/terminal_sessions.rs:152` en herdrdev/herdr). Las imágenes kitty dentro de los panes no llegan a la GUI.
- `terminal session control` habla con `herdr-client.sock`, que usa el protocolo binario interno. Por eso se usa el CLI como bridge (documentado para bridges). Más adelante se puede portar ese protocolo, porque herdr es Apache-2.0.

Precedentes: herdr-gui (GPUI + libghostty, solo macOS), Herdglass y herdrm (Swift, macOS), Herdr-Dash (Node web, Windows). No hay una GUI nativa para Windows con glass.

## 2. Recomendación

### Opción A (recomendada): Tauri 2 + Svelte 5 + xterm.js WebGL + core Rust propio

- Glass: se hace con CSS (`backdrop-filter`) y Mica de Windows 11, que ya viene en Tauri 2 (`windowEffects`). El blur del escritorio lo hace DWM, fuera del proceso.
- Svelte 5 compila sin VDOM, así que el runtime es mínimo. Es el framework web más liviano de los viables.
- xterm.js 6 + `@xterm/addon-webgl` es el motor de terminal de VS Code. Los frames de herdr ya vienen renderizados en ANSI, así que se hace `term.write(bytes)` y listo.
- Ya conoces el stack (Inkboard, FocusFlow), así que se llega rápido a "todas las funcionalidades". El instalador queda entre 5 y 10 MB.
- Costo: 150–250 MB de RAM por WebView2. Es liviano al lado de Electron, pero no al lado de la TUI (46 MB).

### Opción B (RAM mínima): 100 % nativo con GPUI + gpui-component + vte + el mismo core

- RAM de 40–80 MB (estimado, no medido), arranque por debajo de 200 ms, 120 fps.
- GPUI trae `MicaBackdrop`, `MicaAltBackdrop` y `Blurred` (verificado en zed main).
- Contras:
  - No hay blur de contenido dentro de la app: el glass son tintes translúcidos sobre Mica, y el blur real necesita un shader propio.
  - La API es inestable (gpui en crates.io es la 0.2.2 de 2025-10, así que habría que usar git).
  - Compila lento.
  - La terminal de Zed es GPL: no se puede copiar si quieres una licencia permisiva.

### Descartados

- Electron: 300+ MB de RAM y 100+ MB de disco.
- egui: estética de herramienta y glass pobre.
- Slint / iced: sin blur y la terminal hay que hacerla a mano.
- Dioxus desktop: usa el mismo WebView que Tauri, no aporta nada.

Clave: `herdr-core` no depende de ninguna UI. Se puede empezar con A y migrar a B sin reescribir el protocolo.

## 3. Arquitectura (A)

```
herdr server (ya corre)
 ├─ herdr.sock  JSON API ◄── herdr-core::rpc     (1 conexión/request, 0,3–0,5 ms)
 ├─ herdr.sock  events   ◄── herdr-core::events  (1 conexión persistente)
 └─ herdr-client.sock    ◄── `herdr terminal session control` (1 hijo por pane VISIBLE, NDJSON stdio)

crates/herdr-core   (Rust puro, sin Tauri)
 ├─ transport  tokio named_pipe (Windows) / UnixStream (cfg unix)
 ├─ api        tipos generados del schema (typify) + 90 métodos
 ├─ store      session.snapshot + invalidación por eventos; events_lost → resuscribir + snapshot
 └─ terminal   pool de controllers; base64→bytes en Rust
src-tauri           shell fino
 ├─ api_call(method, params) genérico + wrappers tipados
 ├─ Channel<InvokeResponseBody::Raw> por pane → ArrayBuffer en JS (sin base64/JSON en WebView)
 └─ Channel de eventos → store Svelte
ui/                 Svelte 5 + Vite SPA (sin SvelteKit), pnpm
 ├─ stores $state normalizados: sessions/workspaces/tabs/panes/agents
 ├─ TerminalView: xterm.js WebGL; los frames van directo a xterm (fuera de la reactividad)
 └─ vistas pesadas lazy: settings, plugins, worktrees
schema/herdr-api.schema.json   (regenerar: herdr api schema --json)
```

## 4. Presupuesto de rendimiento

- Nunca lanzar el CLI por cada acción. La única excepción es el bridge de terminal: 1 proceso de larga vida por pane visible.
- Cero polling: todo por eventos, con CPU en reposo cerca de 0 %.
- Solo los panes visibles tienen controller. Al ocultar una tab se hace `terminal.release`. La preview de agentes usa `pane.read --source visible` bajo demanda (0,3 ms).
- Frames coalescidos por `requestAnimationFrame`; se escribe con `xterm.write(Uint8Array)`.
- Glass solo en el chrome (sidebar, tabs, palette, modales, toasts). La terminal va con fondo casi opaco.
- Usar Mica, no Acrylic. Según el README de window-vibrancy, Acrylic tiene "bad performance when resizing/dragging" en Win11 22000 y Win10 1903+.
- Metas:
  - arranque por debajo de 800 ms
  - RAM en reposo por debajo de 200 MB
  - overhead de eco por debajo de 5 ms sobre la base de 23–32 ms
  - instalador por debajo de 10 MB

## 5. Diseño glassmorphism

1. Capa 0: Mica. Configurar `transparent: true`, `windowEffects.effects: ["mica"]`, `decorations: false` y una titlebar propia con `data-tauri-drag-region`. Requiere la capability `core:window:allow-start-dragging`.
2. Capa 1: fondo de gradiente mesh sutil con el acento del tema de herdr (hoy `dracula`).
3. Capa 2: paneles glass:
   - `rgba(255,255,255,.06)`
   - `backdrop-filter: blur(20px) saturate(140%)`
   - borde de 1 px `rgba(255,255,255,.12)`
   - highlight interno y noise del 2–3 %
4. Glow por estado de agente: working = azul con pulso, blocked = ámbar, done = verde, idle = gris, unknown = violeta.
5. Temas: los 11 temas built-in de herdr pasan a tokens CSS y al theme de xterm, así la GUI y la TUI comparten paleta.
6. Toggle "reducir transparencia" (glass sólido), para legibilidad y rendimiento.

## 6. Cobertura de funcionalidades

| Grupo herdr | Métodos / CLI | Superficie GUI |
|---|---|---|
| Sesiones | `session list/attach/stop/delete` (1 socket por sesión) | selector en la titlebar |
| Workspaces | `workspace.create/list/get/focus/rename/move/move_block/report_metadata/close` | sidebar "Spaces" con drag&drop, rollup de estado, tokens (branch, git_status) |
| Worktrees | `worktree.list/create/open/remove` | diálogo con selector de branch |
| Tabs | `tab.create/list/get/focus/rename/move/close` | tab bar con drag |
| Panes / layout | `pane.split/swap/move/zoom/layout/process_info/neighbor/edges/focus_direction/resize/list/current/get/focus/rename/close`, `layout.export/apply/set_split_ratio` | árbol de splits con divisores arrastrables, menú contextual, zoom, presets de layout |
| I/O terminal | `pane.send_text/send_keys/send_input/read/wait_for_output` + session control | TerminalView, broadcast de input, búsqueda en el output |
| Agentes | `agent.list/get/read/explain/send_keys/rename/view.set/view.clear/focus/start/prompt/wait` | panel con cola de atención, lanzar agente (21 kinds), caja de prompt con `--wait`, botones Esc/Ctrl+C, transcript, debug de detección |
| Eventos / notificaciones | `events.subscribe/wait`, `notification.show` | toasts glass + notificación nativa de Windows (blocked/done) |
| Integraciones | `integration install/uninstall/status` | Settings › Integraciones |
| Plugins | `plugin.link/list/unlink/enable/disable/action.list/action.invoke/log.list/pane.open/pane.focus/pane.close`, `popup.close` | Settings › Plugins + acciones en la palette |
| Config | `config.toml`, `config check`, `config reset-keys`, `server.reload_config` | Settings (tema, UI, editor de keybindings) con validación |
| Servidor | `status`, `server.stop/reload_config/agent_manifests/reload_agent_manifests`, `update-agent-manifests`, `live_handoff` | panel Servidor |
| Update | `herdr update`, `channel show/set` | Settings › Actualizaciones |
| Otros | `pane.graphics.*`, `client.window_title.*`, `pane.report_*` | baja prioridad |
| Remoto | `--remote` SSH | fuera de v1: la API JSON es local y haría falta un bridge SSH |
| Todo | los 90 métodos | command palette Ctrl+K generada del schema + keybindings de herdr (prefix `ctrl+b`) |

## 7. Riesgos a verificar en la Fase 0

- GUI y TUI abiertas a la vez sobre el mismo pane: `--takeover` + resize, y un PTY tiene un solo tamaño, así que pueden pelear por el tamaño. **No verificado.**
- herdr está en canal preview: la API puede cambiar. Mitigación: codegen desde el schema y chequear el `protocol` del `ping` al arrancar.
- Las imágenes kitty no pasan por el bridge.
- Cada pane visible es un proceso hijo (unos 4 MB, estimado a partir del cliente TUI). Si hay muchos panes visibles, portar el protocolo binario.
- Mica requiere Windows 11; en Windows 10 se cae a fondo sólido.

## 8. Fases

- **F0, spike (1 día):**
  - `herdr-core` con ping + snapshot + events
  - 1 terminal xterm.js en una ventana Tauri con Mica
  - medir RAM, arranque y eco contra las metas
  - decidir entre A y B con números reales
- **F1:** sidebar de Spaces, tabs, árbol de panes, terminal por pane, selector de sesión.
- **F2:** panel de agentes, notificaciones, command palette.
- **F3:** worktrees, layouts, settings/config, keybindings.
- **F4:** plugins, integraciones, servidor/update.
- **F5:** pulido glass, temas, MSI/NSIS, auto-update.
