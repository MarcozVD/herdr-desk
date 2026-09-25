# herdr-desk: plan de implementación (GUI glass para herdr)

> **Para Hermes:** este plan NO se ejecuta hasta que el usuario lo apruebe ("arranca F0").
> Se ejecuta tarea por tarea, en orden. Al terminar cada fase hay una puerta de verificación.
> Antes de tocar código cargar los skills `herdr-gui` y `tauri-desktop-app`.

**Objetivo.** App de escritorio para Windows 11 que cubra el 100 % de las funciones de herdr, con estética glassmorphism. Debe ser más rápida que el CLI (0,3–0,5 ms por acción contra 51–78 ms) y estar dentro del presupuesto de RAM y disco de la §4.

**Arquitectura.**
- `crates/herdr-core` (Rust puro, sin UI) habla con herdr por el named pipe (NDJSON, 1 request por conexión).
- La misma crate mantiene la suscripción de eventos, un snapshot canónico con refresco coalescido y un pool de bridges de terminal (`herdr terminal session control`).
- `src-tauri` es una capa fina: commands + `Channel`, con frames binarios y JSON crudo.
- `src/` es una SPA en Svelte 5 con xterm.js WebGL, sobre Mica de Windows 11 y glass en CSS.

**Stack.**
- Rust 1.97.1, Tauri 2.11, tokio 1.53.
- Svelte 5.57 + Vite 8 + TypeScript 6.0.3 (fijado).
- @xterm/xterm 6.0 + addon-webgl 0.19.
- pnpm 10.33 y Node 22.19.

Base: `docs/01-propuesta-stack.md` (propuesta y mediciones) y el skill `herdr-gui` (protocolo verificado).

---

## 0. Supuestos y decisiones cerradas

| # | Decisión | Motivo / origen |
|---|---|---|
| D1 | Opción A (Tauri + Svelte). La opción B (GPUI) solo se evalúa si F0 falla sus metas | Recomendación de la propuesta. El usuario no eligió, así que se usa el default |
| D2 | Nombre de trabajo `herdr-desk`, identifier `com.mvale.herdrdesk`. Cambiarlo cuesta 1 tarea (T0.2) | Evitar choque con "Herdglass" (proyecto macOS existente) |
| D3 | UI en español, con los strings centralizados en `src/lib/i18n/es.ts` | Idioma del usuario |
| D4 | Solo Windows 11 x64 en v1. `herdr-core` queda detrás de un trait de transporte para añadir Unix después | Entorno real. YAGNI |
| D5 | Protocolo objetivo: herdr 0.8.0-preview, `protocol 19`, `schema_version 1` | `herdr api schema --json` instalado |
| D6 | pnpm siempre y un solo `package.json` en la raíz | Preferencia del usuario |
| D7 | CSS propio con tokens. Sin Tailwind, librerías de UI, router ni librería de estado | Peso y control del glass |
| D8 | Instalador NSIS con `installMode: currentUser` (sin admin) | Evita los errores 1603/1730 de MSI vistos en FocusFlow |
| D9 | Git: 1 rama por fase (`f0-spike`, `f1-nucleo`…). Merge a `main` y se borra la rama. Commits convencionales por tarea | Preferencia del usuario |
| D10 | Desarrollo y tests SOLO contra la sesión aislada `herdr-desk-dev`. La sesión `default` del usuario no se toca | El agente corre dentro del herdr del usuario |

Fuera de alcance en v1:
- `--remote` / máquinas SSH.
- Imágenes kitty dentro de los panes: el bridge las descarta.
- Renderizar popups de herdr: no tienen `pane_id`.
- macOS y Linux.
- Firma de código y Microsoft Store.

---

## 1. Hechos del protocolo que el diseño asume

Todo lo siguiente está verificado el 2026-09-25, salvo lo marcado como "verificar en F0".

1. Pipe = `\\.\pipe\` + la ruta completa del socket (`%APPDATA%\herdr\herdr.sock`; sesiones con nombre en `%APPDATA%\herdr\sessions\<name>\herdr.sock`). La ruta autoritativa sale de `herdr session list --json` → `socket_path`.
2. Una request por conexión: el server cierra después de responder. La excepción es `events.subscribe`, que deja la conexión abierta: la primera línea es `subscription_started` y después llegan los eventos.
3. 90 métodos (§ Anexo A), 57 tipos de resultado y 26 variantes de `EventData`.
4. 27 tipos de suscripción. **24 son globales.** Estos 3 exigen `pane_id`: `pane.output_matched`, `pane.agent_status_changed` y `pane.scroll_changed`. Si un `pane_id` no existe, se rechaza la suscripción entera y se cierra la conexión.
5. `events_lost` obliga a resuscribirse y reconciliar con `session.snapshot`. Los eventos invalidan el estado; no se aplican "a ciegas".
6. `session.snapshot` = `{version, protocol, focused_*_id, workspaces[], tabs[], panes[], layouts[], agents[]}`, unos 7 KB con 8 panes.
7. `layout.export` devuelve un árbol `LayoutNode` (`{type:"pane", pane_id, cwd…}` o `{type:"split", direction, ratio, first, second}`). `layout.set_split_ratio {tab_id, path:[bool], ratio}` usa un `path` de bools desde la raíz.
8. Bridge de terminal: `herdr [--session N] terminal session control <pane_id> --takeover --cols C --rows R`.
   - stdout: `terminal.frame {seq, encoding:"ansi", width, height, full, bytes(base64)}`, y al final `terminal.closed {reason}`.
   - stdin: `terminal.input {text|bytes}`, `terminal.resize {cols, rows}`, `terminal.scroll {direction: up|down, lines, source?: wheel|page_key}`, `terminal.release {}`.
   - Sin `--cols/--rows` el viewport es 120×40.
9. Frame completo de 100×30 = 55,9 KB. Eco tecla→frame = 23–32 ms (base ConPTY + shell).
10. Los frames de un pane con opencode NO traían los modos DEC de la app interna (`?1000/?1006/?2004` ausentes). El passthrough de mouse y el bracketed paste no están garantizados (R3).
11. La doc preview menciona `pane.graphics.stream` y `pane.input.set`, pero **no están en el schema instalado**. Manda el schema instalado, no la doc.
12. El estado de un agente se puede simular sin un agente real: `pane.report_agent {pane_id, source:"custom:hd-test", agent:"hd-bot", state:"working"}` + `pane.release_agent`. Se usa en los tests.

---

## 2. Estructura final del repo

```
C:\Users\mvale\Documents\herdr\
├─ .gitattributes  .gitignore  README.md  THIRD-PARTY-NOTICES.md
├─ Cargo.toml                 # workspace
├─ rust-toolchain.toml        # channel "1.97", components rustfmt+clippy
├─ package.json  pnpm-lock.yaml  tsconfig.json  vite.config.ts  svelte.config.js
├─ eslint.config.js  .prettierrc  vitest.config.ts  playwright.config.ts  index.html
├─ schema/
│   ├─ herdr-api.schema.json  # herdr api schema --json --output …
│   ├─ VERSION                # "0.8.0-preview.2026-08-04-d78e3d3b5126 protocol=19"
│   └─ fixtures/*.json        # respuestas/eventos grabados del sandbox
├─ scripts/
│   ├─ sandbox.ps1            # start|stop|status de la sesión herdr-desk-dev
│   ├─ smoke.ps1              # lanza el binario debug, espera "[herdr-desk] ready", lo mata
│   ├─ perf.ps1               # arranque, RAM (árbol exe+WebView2), CPU en reposo → JSON
│   ├─ gen-types.mjs          # schema → src/lib/herdr/{types,methods}.gen.ts
│   ├─ gen-settings.mjs       # herdr --default-config → src/lib/settings/settings.gen.ts
│   └─ schema-check.mjs       # schema instalado vs commiteado (falla si difiere)
├─ crates/herdr-core/
│   ├─ Cargo.toml
│   ├─ src/ lib.rs paths.rs transport.rs rpc.rs error.rs model.rs events.rs
│   │       store.rs terminal.rs frame.rs cli.rs config.rs
│   └─ tests/ fixtures.rs  sandbox.rs (feature "sandbox")
├─ src-tauri/
│   ├─ Cargo.toml build.rs tauri.conf.json capabilities/default.json icons/
│   └─ src/ main.rs lib.rs state.rs window.rs notify.rs tray.rs
│           commands/{mod.rs,api.rs,session.rs,terminal.rs,config.rs,system.rs}
├─ src/
│   ├─ main.ts  App.svelte  app.css
│   ├─ lib/herdr/     client.ts types.gen.ts methods.gen.ts errors.ts
│   ├─ lib/stores/    session.svelte.ts ui.svelte.ts settings.svelte.ts reconcile.ts
│   ├─ lib/terminal/  TerminalView.svelte frames.ts pool.ts input.ts
│   ├─ lib/layout/    SplitTree.svelte tree.ts
│   ├─ lib/keys/      keymap.ts prefix.svelte.ts actions.ts
│   ├─ lib/theme/     tokens.css themes.ts ansi.ts apply.ts
│   ├─ lib/i18n/      es.ts
│   ├─ lib/ui/        GlassPanel Button IconButton Dialog Confirm Toast ContextMenu Field Kbd …
│   └─ features/      titlebar sidebar tabs panes agents palette sessions worktrees
│                     settings plugins integrations server notifications console
├─ tests/e2e/*.spec.ts        # Playwright + mockIPC de @tauri-apps/api/mocks
└─ docs/ 00-plan-desarrollo.md 01-propuesta-stack.md 02-f0-resultados.md 03-arquitectura.md
```

---

## 3. Guía de diseño (glassmorphism)

**Capas**

| Capa | Qué es |
|---|---|
| 0 | Mica de DWM: `windowEffects.effects:["micaDark"]`. Se cambia a `micaLight` con temas claros vía `window.set_effects` |
| 1 | Fondo mesh sutil con el `accent` del tema (2 radial-gradients, opacidad 0,12) + noise SVG al 3 % |
| 2 | Superficies glass: titlebar, sidebar, tab bar, status bar, palette, diálogos, toasts, menús. **Máximo 5 superficies con `backdrop-filter` vivas a la vez** |
| 3 | Terminales: fondo casi opaco = `panel_bg` del tema. Nunca llevan `backdrop-filter` |

**Tokens** (`src/lib/theme/tokens.css`):

```css
:root {
  --glass-alpha: 0.55; --glass-alpha-overlay: 0.72;
  --glass-blur: 20px;  --glass-blur-overlay: 28px; --glass-saturate: 140%;
  --glass-border: rgb(255 255 255 / 0.12);
  --glass-highlight: inset 0 1px 0 rgb(255 255 255 / 0.10);
  --radius-sm: 8px; --radius: 14px; --radius-lg: 20px;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px;
  --shadow-lg: 0 20px 50px -12px rgb(0 0 0 / 0.55);
  --ease: cubic-bezier(.2, .8, .2, 1); --t-fast: 120ms; --t-med: 180ms; --t-slow: 240ms;
  --font-ui: "Geist Variable", system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", "Cascadia Mono", monospace;
}
.glass {
  background: color-mix(in oklab, var(--panel-bg) calc(var(--glass-alpha) * 100%), transparent);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-highlight), var(--shadow-lg);
  border-radius: var(--radius);
}
:root[data-glass="off"] .glass { background: var(--panel-bg); backdrop-filter: none; }
@media (prefers-reduced-transparency: reduce) {
  :root:not([data-glass="force"]) .glass { background: var(--panel-bg); backdrop-filter: none; }
}
```

**Estado de agente**

Colores: working = `--blue` con pulso, blocked = `--yellow`, done = `--green`, idle = `--surface-dim`, unknown = `--mauve`.

El glow va en un `::after` con sombra fija y **solo se anima `opacity`**. `box-shadow` nunca se anima porque obliga a repintar.

**Temas**
- Tokens de herdr (`accent, panel_bg, sidebar_bg, active_row_bg, selection_bg, surface_dim, text, mauve, green, yellow, red, blue, teal, peach`) → variables CSS. Se lee `[theme] name` + `[theme.custom]` de `config.toml`.
- 17 nombres: `catppuccin, catppuccin-latte, terminal, tokyo-night, tokyo-night-day, dracula, nord, gruvbox, gruvbox-light, one-dark, solarized, solarized-light, kanagawa, kanagawa-lotus, rose-pine, rose-pine-dawn, vesper`.
- Los valores por tema se transcriben desde herdr@<commit fijado> (Apache-2.0, con atribución en `THIRD-PARTY-NOTICES.md`). Las paletas ANSI-16 de cada tema van en `ansi.ts`, con la fuente oficial citada.

**Tipografía e iconos**
- UI: Geist Variable (`@fontsource-variable/geist` 5.3.0).
- Terminal: JetBrains Mono Variable (fontsource; verificar la versión al instalar).
- Iconos: `@lucide/svelte` 1.48 (tree-shaking).

**Pantalla principal**

```
┌ titlebar glass (drag) ─ [sesión ▾] ─ [⌕ Ctrl+Shift+P] ─ ● online 0,4 ms ─ ─ □ × ┐
│ SIDEBAR glass           │ TAB BAR glass: [● t1] [◐ t2] [+]                      │
│ ESPACIOS                │ ┌ header: opencode · working · ~/proj ┐┌ header ────┐ │
│  1 ● focusflow   2▣     │ │ xterm WebGL                         ││ xterm      │ │
│  2 ◐ YumeTv  working    │ │                                     ││            │ │
│ AGENTES (prioridad)     │ └─────────────────────────────────────┘└────────────┘ │
│  ▲ opencode  blocked    │ STATUS glass: pane w6:p2 · pwsh · scroll 0/240 · eco 27 ms │
└─────────────────────────┴────────────────────────────────────────────────────────┘
```

---

## 4. Presupuesto de rendimiento (puertas de F0 y F5)

| Métrica | Meta | Cómo se mide |
|---|---|---|
| Arranque en caliente (proceso → primer render con sidebar viva) | ≤ 800 ms. En frío ≤ 1,5 s | `scripts/perf.ps1`: log `[herdr-desk] ready startup_ms=` |
| RAM total en reposo (exe + árbol WebView2, 1 terminal visible) | ≤ 200 MB (ideal ≤ 150) | `perf.ps1`: suma de PrivateMemorySize64 del árbol |
| CPU en reposo sin salida en los panes | ≤ 0,5 % promedio en 30 s | `perf.ps1` |
| Eco keydown → frame pintado | p95 ≤ 40 ms (base 23–32) | comando de debug `perf_echo` con 50 teclas |
| Evento → UI (glow de estado) | ≤ 50 ms | timestamps de log (evento recibido → store emitido) |
| Cambio de tab (mostrar contenido) | ≤ 150 ms | `terminal_open` → primer frame |
| Flood (`1..200000 \| % { $_ }`) | UI responde, input p95 ≤ 50 ms, RAM estable | manual + log de frames/s |
| JS inicial | ≤ 600 KB minificado (con xterm). Settings, plugins, etc. lazy | `pnpm build` + reporte de chunks |
| Instalador NSIS | ≤ 10 MB | tamaño del archivo |

Reglas que no se rompen:
1. Nunca lanzar el CLI por una acción de UI. Excepciones: bridges de terminal (1 proceso largo por pane visible) y comandos raros (session list, update, status, integration status, plugin install, config check).
2. Cero polling: todo por eventos y reconexión con backoff.
3. Los frames de terminal van fuera de la reactividad de Svelte.

---

## 5. Contrato IPC (Rust ↔ frontend)

```rust
// src-tauri/src/commands/*.rs  (todos async → Result; clonar state.inner() antes de await)
herdr_call(method: String, params: Value) -> Result<Value, ApiError>          // genérico, 0,3–0,5 ms
session_list() -> Result<Vec<SessionInfo>, ApiError>                          // CLI `session list --json`
session_connect(name: Option<String>) -> Result<(), ApiError>                 // cambia la sesión activa
session_start(name: String) / session_stop(name) / session_delete(name)
store_subscribe(on_msg: Channel<InvokeResponseBody>) -> Result<(), ApiError>  // Json(snapshot crudo) | Json(estado)
events_forward(on_evt: Channel<InvokeResponseBody>) -> Result<(), ApiError>   // eventos para notificaciones
terminal_open(pane_id: String, cols: u16, rows: u16, on_frame: Channel<InvokeResponseBody>) -> Result<u32, ApiError>
terminal_input(bridge_id: u32, data: String) / terminal_input_bytes(bridge_id, b64: String)
terminal_resize(bridge_id, cols, rows) / terminal_scroll(bridge_id, direction, lines) / terminal_close(bridge_id)
config_read() -> Result<ConfigDoc, ApiError>; config_write(patch: ConfigPatch) -> Result<CheckReport, ApiError>
cli_run(kind: CliKind, args: Vec<String>) -> Result<CliOutput, ApiError>      // lista blanca, nunca un shell
```

Frame binario (`frame.rs`, 16 bytes little-endian + payload):

```
[0..8)  seq u64   [8..10) width u16   [10..12) height u16
[12]    flags u8  (bit0 = full, bit1 = closed)   [13..16) reservado
[16..)  bytes ANSI (o razón UTF-8 si closed)
```

`ApiError = { code: String, message: String }`.
- Códigos de herdr: `not_found`, `invalid_params`, `agent_blocked`, `agent_prompt_stalled`, `events_lost`, `stream_conflict`, `popup_not_open`, etc.
- Códigos locales: `transport`, `timeout`, `not_connected`, `bridge_closed`, `cli_failed`.
- Mapeo a español en `src/lib/herdr/errors.ts` (Anexo C).

---

## F0. Spike y medición (2–3 días). Rama `f0-spike`

Salida: binario debug con Mica y glass, sidebar viva de la sesión sandbox y 1 terminal real funcionando; números medidos en `docs/02-f0-resultados.md`; y la decisión Go/No-Go.

### T0.1 Repo, git y reglas de EOL

Archivos:
- `.gitattributes`
- `.gitignore`
- `README.md` (esqueleto)
- `docs/00-plan-desarrollo.md` (copia de este plan aprobado)

```gitattributes
* text=auto eol=lf
*.ps1 text eol=crlf
*.cmd text eol=crlf
*.ico binary
*.png binary
```

```gitignore
/target/
/dist/
/node_modules/
/src-tauri/gen/
/test-results/
/playwright-report/
.hermes/
*.log
```

Pasos:
1. `git init -b main` en `C:\Users\mvale\Documents\herdr`.
2. Crear los archivos.
3. `git checkout -b f0-spike`.
4. Commit `chore: init repo`.

Verificación: `git status` limpio y `git check-attr eol -- scripts/x.ps1` → `crlf`.

### T0.2 Scaffold Tauri + Svelte TS (pnpm) y workspace Cargo

Pasos:
1. Ejecutar:
   ```
   cd C:/Users/mvale/AppData/Local/Temp && pnpm create tauri-app herdr-desk --template svelte-ts --manager pnpm --yes
   ```
2. Copiar el contenido de `herdr-desk/` a la raíz del repo, sin pisar `docs/`.
3. `tauri.conf.json`: `productName: "herdr-desk"`, `identifier: "com.mvale.herdrdesk"`, `build.beforeDevCommand: "pnpm dev"`, `beforeBuildCommand: "pnpm build"`, `devUrl: "http://localhost:1420"`, `frontendDist: "../dist"`.
4. `Cargo.toml` raíz (workspace):
   ```toml
   [workspace]
   resolver = "3"
   members = ["crates/herdr-core", "src-tauri"]

   [workspace.package]
   version = "0.1.0"
   edition = "2024"
   publish = false

   [workspace.dependencies]
   tokio = { version = "1.53", features = ["rt-multi-thread", "macros", "net", "io-util", "process", "sync", "time"] }
   serde = { version = "1.0.229", features = ["derive"] }
   serde_json = { version = "1.0.151", features = ["raw_value"] }
   base64 = "0.23"
   thiserror = "2"
   tracing = "0.1.44"
   tracing-subscriber = { version = "0.3.23", features = ["env-filter"] }
   toml_edit = "0.25"

   [profile.release]
   opt-level = "s"
   lto = true
   codegen-units = 1
   strip = true
   ```
   Si el template trae `edition = "2021"` y el 2024 da fricción con las macros, dejar 2021 y anotarlo.
5. `.gitignore`: el `target/` pasa a la raíz del workspace.

Verificación:
- `pnpm install`.
- `pnpm tauri build --debug --no-bundle` genera `target/debug/herdr-desk.exe`.
- Lanzar el exe: se abre la ventana. Matarlo.

Si pnpm dice "Ignored build scripts", añadir los paquetes a `"pnpm": {"onlyBuiltDependencies": [...]}` (no interactivo).

Commit: `chore: scaffold tauri+svelte workspace`.

### T0.3 Toolchain y dependencias fijadas

- `rust-toolchain.toml`:
  ```toml
  [toolchain]
  channel = "1.97"
  components = ["rustfmt", "clippy"]
  ```
- `pnpm add @xterm/xterm@6.0.0 @xterm/addon-webgl@0.19.0 @xterm/addon-fit@0.11.0 @xterm/addon-unicode11@0.9.0 @xterm/addon-web-links@0.12.0 @tauri-apps/api@2.11.1 @tauri-apps/plugin-notification@2.4.0 @tauri-apps/plugin-dialog@2.7.3 @tauri-apps/plugin-opener@2.5.5 @lucide/svelte@1.48.0 @fontsource-variable/geist@5.3.0 @fontsource-variable/jetbrains-mono`
- `pnpm add -D @tauri-apps/cli@2.11.5 svelte@5.57.1 @sveltejs/vite-plugin-svelte@7.3.1 vite@8.3.1 typescript@6.0.3 svelte-check@4.7.6 vitest@5.0.2 jsdom@30.1.1 @playwright/test@1.63.0 eslint@10.11.0 eslint-plugin-svelte@3.23.0 typescript-eslint@8.70.1 prettier@3.9.9 prettier-plugin-svelte@4.1.1 json-schema-to-typescript@16.0.0`
- **TypeScript 6.0.3, no 7.x:** svelte-check pide `^5 || ^6` y typescript-eslint pide `<6.1.0` (peers verificados).
- Scripts de `package.json`:
  ```json
  "dev": "vite", "build": "vite build", "check": "svelte-check --tsconfig ./tsconfig.json",
  "lint": "eslint .", "format": "prettier --write .", "format:check": "prettier --check .",
  "test": "vitest run", "e2e": "playwright test", "tauri": "tauri",
  "gen": "node scripts/gen-types.mjs && node scripts/gen-settings.mjs",
  "schema:check": "node scripts/schema-check.mjs",
  "rust:fmt": "cargo fmt --all", "rust:lint": "cargo clippy --workspace --all-targets -- -D warnings",
  "rust:test": "cargo test --workspace",
  "verify": "pnpm format:check && pnpm lint && pnpm check && pnpm test && pnpm rust:lint && pnpm rust:test"
  ```
- `vite.config.ts`: `server: { port: 1420, strictPort: true }`, `build: { target: "chrome120" }`.

Verificación: `pnpm verify` en verde (el template vacío pasa). Commit: `chore: pin toolchain and deps`.

### T0.4 Sandbox herdr aislado

Archivo: `scripts/sandbox.ps1`.

```powershell
param([ValidateSet('start','stop','status')][string]$Action = 'status',
      [string]$Session = 'herdr-desk-dev')
$ErrorActionPreference = 'Stop'
Get-ChildItem Env: | Where-Object { $_.Name -like 'HERDR_*' } | ForEach-Object { Remove-Item -Path ("Env:" + $_.Name) }
$herdr = (Get-Command herdr).Source
switch ($Action) {
  'start' {
    Start-Process -FilePath $herdr -ArgumentList @('--session', $Session, 'server') -WindowStyle Hidden
    for ($i = 0; $i -lt 50; $i++) {
      $s = (& $herdr session list --json | ConvertFrom-Json).sessions | Where-Object { $_.name -eq $Session -and $_.running }
      if ($s) { "ready $Session $($s.socket_path)"; exit 0 }
      Start-Sleep -Milliseconds 100
    }
    throw "sandbox $Session no arranco"
  }
  'stop'   { & $herdr session stop $Session --json; & $herdr session delete $Session --json }
  'status' { & $herdr session list --json }
}
```

Verificación:
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\sandbox.ps1 start` → `ready herdr-desk-dev …`.
- `stop` → `deleted: true`.
- `status` → solo queda `default`.

Commit: `chore: sandbox script`.

### T0.5 herdr-core: rutas, transporte, RPC y frame

Archivos:
- `crates/herdr-core/Cargo.toml` (deps del workspace + `[features] sandbox = []`)
- `src/{lib.rs, paths.rs, transport.rs, rpc.rs, error.rs, frame.rs}`

**`paths.rs`**
- `pipe_name(socket_path: &Path) -> String` = `format!(r"\\.\pipe\{}", socket_path.display())`.
- `default_socket()` = `%APPDATA%\herdr\herdr.sock`.
- `session_socket(name)` = `%APPDATA%\herdr\sessions\<name>\herdr.sock`.
- `find_herdr_exe()`, en este orden: config GUI `herdr_path`, luego `HERDR_BIN_PATH`, luego PATH (`which`), luego `%LOCALAPPDATA%\Programs\Herdr\bin\herdr.exe`.
- **Ignora `HERDR_SOCKET_PATH`** del entorno (D10).

**`transport.rs`** (Windows):

```rust
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};
const ERROR_PIPE_BUSY: i32 = 231;

pub async fn open(pipe: &str) -> Result<NamedPipeClient, TransportError> {
    let mut delay = std::time::Duration::from_millis(2);
    for _ in 0..8 {
        match ClientOptions::new().open(pipe) {
            Ok(client) => return Ok(client),
            Err(err) if err.raw_os_error() == Some(ERROR_PIPE_BUSY) => {
                tokio::time::sleep(delay).await;
                delay *= 2;
            }
            Err(err) => return Err(TransportError::Connect(err)),
        }
    }
    Err(TransportError::Busy)
}

/// One request per connection: write one line, read one line, drop.
pub async fn roundtrip(pipe: &str, line: &[u8]) -> Result<String, TransportError> {
    let client = open(pipe).await?;
    let (read_half, mut write_half) = tokio::io::split(client);
    write_half.write_all(line).await?;
    let mut reader = BufReader::new(read_half);
    let mut response = String::new();
    reader.read_line(&mut response).await?;
    if response.is_empty() { return Err(TransportError::ClosedWithoutResponse); }
    Ok(response)
}
```

**`rpc.rs`**
- `Client { pipe: String, next_id: AtomicU64 }`.
- `call(method, params) -> Result<Value, HerdrError>`: id `hd-<n>`, timeout de 5 s. Los métodos con espera (`agent.wait`, `agent.prompt` con `wait`, `pane.wait_for_output`, `events.wait`) usan timeout = su `timeout_ms` + 2 s.
- Parsea `{"id","result"}` o `{"id","error":{"code","message"}}`.

**`frame.rs`**
- `encode_frame(seq, width, height, full, bytes) -> Vec<u8>` y `encode_closed(reason) -> Vec<u8>` (layout de la §5).

Tests (unitarios, sin herdr): `cargo test -p herdr-core`
- `frame_roundtrip_header`
- `parse_ok_response`
- `parse_error_response`
- `parse_empty_id_error`
- `pipe_name_from_socket`

Test sandbox (`tests/sandbox.rs`, `#![cfg(feature = "sandbox")]`):
- `ping_returns_protocol_19`
- `snapshot_parses`
- Un guard `Sandbox::start("hd-test-<pid>")` que hace stop + delete en `Drop`.

Verificación:
- `cargo test -p herdr-core` → pasan 5 tests.
- `cargo test -p herdr-core --features sandbox -- --test-threads=1` → pasan 2 tests y `herdr session list --json` no deja la sesión `hd-test-*`.

Commit: `feat(core): transport, rpc and frame codec`.

### T0.6 herdr-core: eventos y snapshot coalescido

Archivos: `src/{events.rs, store.rs, model.rs}`.

**`model.rs`**
- Structs serde mínimas: `SessionSnapshot`, `WorkspaceInfo`, `TabInfo`, `PaneInfo`, `AgentInfo`, `PaneLayoutSnapshot`, `EventEnvelope { event: String, data: Value }`.
- `#[serde(default)]` en los opcionales. Se ignoran los campos desconocidos (así lo indica la doc).

**`events.rs`**
- Conexión **L** con los 24 tipos globales en un solo `events.subscribe`.
- Lee línea a línea y reenvía por `mpsc`.
- Si hay EOF o `events_lost`: resuscribir con backoff de 250 ms a 5 s y pedir snapshot.

**`store.rs`**

```rust
pub struct Store { tx: watch::Sender<Arc<str>>, kick: Arc<Notify> }
// refresher: loop { kick.notified().await; sleep(30ms); drenar kicks;
//   let raw = rpc.call_raw("session.snapshot").await?;   // RawValue del campo snapshot
//   if raw != *tx.borrow() { tx.send(raw.into()) } }
```

- Cada evento hace `kick.notify_one()`: hay 1 refresco en vuelo como máximo y se coalescen los demás.
- Se reenvía el JSON **crudo** del snapshot, sin re-serializar.

Tests:
- `store_coalesces_burst`: 100 kicks → ≤ 3 refrescos, con un rpc falso.
- `events_lost_triggers_resubscribe`, con un transporte falso.
- Sandbox `split_emits_pane_created_and_layout_updated`.

Commit: `feat(core): events and coalesced snapshot store`.

### T0.7 herdr-core: bridge de terminal

Archivo: `src/terminal.rs`.

```rust
use std::process::Stdio;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;   // sin esto aparece una consola por pane

pub async fn spawn_bridge(exe: &Path, session: Option<&str>, pane_id: &str, cols: u16, rows: u16)
    -> std::io::Result<Bridge> {
    let mut cmd = tokio::process::Command::new(exe);
    if let Some(name) = session { cmd.args(["--session", name]); }
    cmd.args(["terminal", "session", "control", pane_id, "--takeover",
              "--cols", &cols.to_string(), "--rows", &rows.to_string()])
       .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
       .kill_on_drop(true)
       .creation_flags(CREATE_NO_WINDOW);
    for (key, _) in std::env::vars() { if key.starts_with("HERDR_") { cmd.env_remove(key); } }
    // …: tarea de lectura de stdout → parse terminal.frame → base64 decode → callback(encode_frame(…))
    //    tarea de stderr → tracing::warn!
}
```

- `Bridge::input_text(&str)`, `input_bytes(&[u8])`, `resize(cols, rows)`, `scroll(Up|Down, lines)`: cada una escribe 1 línea JSON en stdin.
- `release()`: manda `terminal.release`, espera 300 ms y luego `kill`.
- Si llega EOF sin `terminal.closed`, se emite `closed("bridge_exit")`.

Tests:
- Unitario `parse_frame_line` usando `schema/fixtures/terminal_frame.ndjson`.
- Sandbox `bridge_echo_roundtrip`: escribe `zqxj`, espera un frame que contenga `z` y registra la latencia en el log.

Commit: `feat(core): terminal bridge`.

### T0.8 src-tauri: estado, commands y ventana glass

Archivos: `src-tauri/src/{lib.rs, state.rs, commands/mod.rs, commands/api.rs, commands/terminal.rs, window.rs}`, `tauri.conf.json` y `capabilities/default.json`.

`tauri.conf.json` → `app.windows[0]`:

```json
{ "label": "main", "title": "herdr", "width": 1280, "height": 800, "minWidth": 720, "minHeight": 480,
  "decorations": false, "transparent": true, "shadow": true, "visible": false,
  "windowEffects": { "effects": ["micaDark"] } }
```

`app.security.csp`:

```
default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src ipc: http://ipc.localhost
```

`capabilities/default.json` → `permissions`:

```json
["core:default", "core:window:allow-start-dragging", "core:window:allow-minimize",
 "core:window:allow-toggle-maximize", "core:window:allow-close", "core:window:allow-show",
 "core:window:allow-set-focus", "notification:default", "dialog:allow-open", "opener:allow-open-url"]
```

`core:window:allow-start-dragging` es obligatorio: sin él, `data-tauri-drag-region` se ignora en silencio (pitfall del skill).

Commands de F0: `herdr_call`, `store_subscribe`, `terminal_open`, `terminal_input`, `terminal_resize`, `terminal_scroll`, `terminal_close`. Los frames salen con `on_frame.send(InvokeResponseBody::Raw(bytes))` y el snapshot con `InvokeResponseBody::Json(raw)`.

Sesión en dev:
- Variable de entorno `HERDR_DESK_SESSION`. Si falta, se usa la última guardada; si no hay ninguna, `default`.
- En F0 se exige `HERDR_DESK_SESSION=herdr-desk-dev`: si falta, la app aborta con un error claro.

Boot log: `[herdr-desk] ready session=<s> protocol=<p> startup_ms=<n>`, emitido cuando el frontend avisa del primer render (command `ui_ready`, que además hace `window.show()`).

Verificación:
- `pnpm tauri build --debug --no-bundle`.
- `scripts/smoke.ps1` lanza el exe con `HERDR_DESK_SESSION=herdr-desk-dev`, espera la línea `ready` (timeout 10 s) y lo mata. Resultado esperado: `SMOKE OK startup_ms=…`.

Commit: `feat(app): tauri shell, ipc and glass window`.

### T0.9 Frontend spike

Archivos:
- `src/App.svelte`, `src/app.css`, `src/lib/theme/tokens.css`
- `src/lib/terminal/{TerminalView.svelte, frames.ts}`
- `src/lib/stores/session.svelte.ts`

Titlebar glass con drag region y botones; sidebar glass con los workspaces del snapshot en vivo; área principal con 1 `TerminalView` del pane enfocado.

```ts
// src/lib/terminal/frames.ts
export function decodeFrame(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const flags = view.getUint8(12);
  return { seq: Number(view.getBigUint64(0, true)), width: view.getUint16(8, true),
           height: view.getUint16(10, true), full: (flags & 1) === 1, closed: (flags & 2) === 2,
           bytes: new Uint8Array(buffer, 16) };
}
```

Claves de `TerminalView.svelte`:
- `new Terminal({ scrollback: 0, allowTransparency: false, fontFamily: 'var(--font-mono)', … })`. `scrollback: 0` porque herdr manda el viewport ya renderizado: el scrollback vive en el server.
- WebGL: `try { const gl = new WebglAddon(); gl.onContextLoss(() => gl.dispose()); term.loadAddon(gl) } catch {}`.
- Cola de frames + `requestAnimationFrame`. **Un frame `full` descarta los frames anteriores en cola.**
- `term.onData` → `terminal_input`, con buffer de las teclas que llegan antes de que el bridge esté listo. `term.onBinary` → `terminal_input_bytes`.
- `attachCustomWheelEventHandler` → `terminal_scroll(up|down, ui.mouse_scroll_lines)` y `return false`.
- `ResizeObserver` → `fit.fit()` → `terminal_resize` con debounce de 60 ms.

Verificación:
- Con el sandbox arriba: la sidebar muestra el workspace de prueba.
- En la terminal se escribe `dir` + Enter y sale el output.
- Resize de la ventana: el prompt se reacomoda.

Commit: `feat(ui): spike glass shell + live terminal`.

### T0.10 Experimentos de riesgo

Protocolo fijo. Cada resultado se anota en `docs/02-f0-resultados.md`.

**R1. Semántica de resize y convivencia con la TUI**
1. En el pane: `powershell -NoProfile -Command "[Console]::WindowWidth; [Console]::WindowHeight"`.
2. `terminal.resize` a 90×20 y repetir el paso 1. Esperado: 90 y 20, lo que prueba que se redimensiona el PTY.
3. El usuario abre la TUI sobre el sandbox (`herdr --session herdr-desk-dev`, en otra ventana de Windows Terminal) y se repite. Anotar quién gana y si la TUI se descuadra.

Si la GUI y la TUI se pelean, se usa el **modo espejo**: `observe` + `pane.send_input` + escala CSS para encajar cols×rows, activado cuando hay una TUI conectada.

**R2. Mica + ventana sin marco + WebView2 transparente**
- Se ve Mica detrás del glass: captura con PowerShell `CopyFromScreen` + `vision_analyze`, o confirmación del usuario.
- Arrastrar y redimensionar sin tirones: lo confirma el usuario.

Fallback: `decorations: true` + Mica, o glass solo en CSS sobre un fondo propio.

**R3. Fidelidad de input**
- Flechas del historial de PSReadLine.
- `Ctrl+C` corta `ping -t localhost`.
- Pegar 3 líneas en PowerShell: ¿se ejecutan de golpe?
- Clic dentro de opencode.
- Probar vim (`C:\Program Files\Git\usr\bin\vim.exe`) si existe.

Si falla el pegado, usar `pane.send_text`. El mouse queda documentado como limitación de v1.

**R4. RAM, arranque y CPU:** `scripts/perf.ps1` (§4).

**R5. Costo por bridge:** `terminal_open` → primer frame en ms, y RAM privada por proceso bridge, con 1, 4 y 8 panes visibles.

**R6. Deriva del schema:** `pnpm schema:check` pasa.

**R7. Flood:** `1..200000 | % { $_ }` en un pane visible. Medir frames/s, que la RAM sea estable y que no llegue `events_lost` en L.

**R8. Consola fantasma:** ninguna ventana de consola aparece al abrir bridges (confirmación visual).

**R10. Takeover doble:** abrir 2 bridges al mismo pane. El primero recibe `terminal.closed` y la UI muestra "Controlado por otra conexión · Retomar".

**R11. Foco:** `workspace.focus` desde la GUI con la TUI conectada. ¿Mueve la vista de la TUI? Si sí, añadir el ajuste "Sincronizar foco con TUI" (off por defecto) y que la GUI use foco local.

**R12. Eventos de estado:** `pane.report_agent state=working` y luego `idle`. ¿Llega `pane_updated` o `workspace_updated` por L? Si no, se crea la conexión **S** con suscripciones por pane a `pane.agent_status_changed`, reconstruida con make-before-break cuando cambia el conjunto de panes (debounce 100 ms).

### T0.11 Medición, informe y Go/No-Go

`scripts/perf.ps1`:
1. Lanza el exe release (`pnpm tauri build --no-bundle`) con `HERDR_DESK_SESSION`.
2. Hace tail del log hasta `ready`.
3. Espera 5 s y suma la memoria privada del árbol (exe + `msedgewebview2` descendientes; misma lógica que `%TEMP%\herdr-probe\apps.ps1`).
4. Muestrea la CPU 30 s, imprime un JSON y mata el árbol.

Debug `perf_echo`: 50 teclas y reporta p50/p95.

`docs/02-f0-resultados.md`: tabla meta vs medido, resultados R1–R12 y decisión.

| Resultado | Decisión |
|---|---|
| Todas las metas de §4 OK, R1 resuelto (control o espejo) y R2 OK | **Go A**: seguir a F1 |
| RAM > 250 MB o eco p95 > 45 ms con glass mínimo | Spike B de 2 días: GPUI + gpui-component 0.6.6 + `alacritty_terminal` 0.26 como parser/grid, reusando `herdr-core`. Se compara y decide |
| R1 sin salida (ni control ni espejo) | Re-plan: portar el protocolo binario de cliente de herdr (Apache-2.0) a `herdr-core` |

Cierre de F0:
1. `pnpm verify` en verde.
2. Merge `f0-spike` → `main` y borrar la rama.
3. Borrar `%TEMP%\herdr-probe`.
4. Actualizar el skill `herdr-gui` con los resultados.

---

## F1. Núcleo usable a diario (5–7 días). Rama `f1-nucleo`

Salida: se puede trabajar el día completo sin la TUI (sesiones, espacios, tabs, panes, terminales y atajos prefix).

| Tarea | Contenido | Archivos | Tests / verificación |
|---|---|---|---|
| T1.1 Modelo y fixtures | Grabar las respuestas y eventos reales del sandbox (`RECORD_FIXTURES=1 cargo test -p herdr-core --features sandbox record_fixtures`) → `schema/fixtures/`. Parseo tipado de las 26 variantes de `EventData` (las usadas por el core) | `model.rs`, `tests/fixtures.rs` | Cada fixture deserializa. `cargo test -p herdr-core` |
| T1.2 Codegen TS | `gen-types.mjs`: sube todos los `$defs` de los 5 schemas a un `$defs` raíz (deduplica los idénticos por JSON; si hay conflicto, sufijo con el nombre del schema), reescribe los `$ref` y compila con json-schema-to-typescript. También genera `methods.gen.ts` (`interface MethodParams { 'pane.split': PaneSplitParams; … }`, 90 entradas) y la unión `ResponseResult` por `type` | `scripts/gen-types.mjs`, `src/lib/herdr/*.gen.ts` | vitest `methods.gen` = 90 métodos, igual a `schema/herdr-api.schema.json` |
| T1.3 Cliente TS | `call<M extends keyof MethodParams>(m, p)` sobre `herdr_call` + `errors.ts` (Anexo C) | `src/lib/herdr/client.ts`, `errors.ts` | Unit: mapeo de errores y parseo |
| T1.4 Store frontend | `SessionStore` con runes (`$state`): workspaces, tabs, panes, agents, layouts y focus. `reconcileById()` muta en su lugar (mantiene la identidad, sin remontar). Estado de conexión: connecting, online u offline | `src/lib/stores/session.svelte.ts`, `reconcile.ts` | Unit: 10 casos de reconcile (alta, baja, reorden, cambio de campo) |
| T1.5 Reconexión | Server caído → UI "desconectado · reintentando" con backoff de 250 ms a 5 s. Al volver: resuscribir, snapshot y respawn de los bridges visibles. Si no hay server: botón "Iniciar servidor" (`herdr [--session N] server` con `DETACHED_PROCESS\|CREATE_NEW_PROCESS_GROUP`) | `events.rs`, `commands/session.rs`, `features/titlebar` | Sandbox: stop → start → la UI vuelve sola. **Verificar que el server lanzado por la GUI sobrevive al cerrar la GUI y que la TUI puede adjuntarse** |
| T1.6 Shell de UI | Titlebar (drag, min/max/close, selector de sesión, botón palette, píldora de conexión con latencia RPC p50), sidebar Espacios (número, label, rollup `agent_status`, conteos, activo), tab bar, status bar. Honra `ui.sidebar_width/min/max`, `sidebar_start_collapsed`, `sidebar_collapsed_mode`, `tab_bar_position`, `hide_tab_bar_when_single_tab` | `features/{titlebar,sidebar,tabs}`, `lib/ui/*` | Playwright + mockIPC: renderiza el snapshot de fixture |
| T1.7 SplitTree | Árbol desde `layout.export` del tab visible (se vuelve a pedir en `layout_updated` de ese tab). Flex con los `ratio`; cada hoja es `PaneFrame` (header + `TerminalView`). Zoom: si `zoomed`, solo el pane enfocado. `pane_borders` y `pane_gaps` salen de la config | `lib/layout/{tree.ts,SplitTree.svelte}`, `features/panes/PaneFrame.svelte` | Unit `tree.ts`: árbol → geometría y path de cada divisor |
| T1.8 Pool de terminales | Bridge solo para panes visibles. Al ocultar un tab, release tras 3 s de gracia. Instancias xterm en LRU (máx. 12) para volver sin parpadeo. WebGL para 8 panes como máximo; el resto usa el renderer DOM. Scrollbar propia desde `PaneInfo.scroll` / `pane.scroll_changed` (conexión V con los panes visibles). Copiar/pegar (`copy_on_select`, Ctrl+Shift+C/V, menú contextual) con `tauri-plugin-clipboard-manager` (verificar versión). Links abiertos con opener | `lib/terminal/pool.ts`, `TerminalView.svelte`, `commands/terminal.rs` | Sandbox: alternar 2 tabs 20 veces → 0 bridges huérfanos (`Get-CimInstance` cuenta los hijos `herdr.exe`) |
| T1.9 Acciones básicas | Workspace create (diálogo cwd + label, `prompt_new_workspace_name`), rename inline, close (confirm si `ui.confirm_close`), focus. Tab create (`prompt_new_tab_name`), rename, close, focus. Pane split right/down, close, zoom, rename, focus | `features/{sidebar,tabs,panes}` | e2e (mockIPC): crear, renombrar y cerrar con confirm. Sandbox manual con checklist |
| T1.10 Motor de atajos | `keymap.ts` parsea la sintaxis de herdr (`ctrl+b`, `prefix+shift+n`, `prefix+1..9`, `minus/comma/plus/backtick`, especiales) desde `[keys]` de config.toml + defaults. Modo prefix: chip glass "PREFIX"; la tecla siguiente resuelve la acción; `prefix` dos veces manda el `ctrl+b` literal. Bindings directos. Atajos globales de la GUI: `ctrl+shift+p` (palette) y `ctrl+shift+c/v`. Todo lo demás va a la terminal. Cheatsheet (acción `help`) | `lib/keys/*` | Unit con las 54 entradas de `--default-config` como fixture + tests de conflictos |
| T1.11 Sesiones | Selector: list (CLI `session list --json`), conectar, nueva (spawn server detached), stop (confirm fuerte), delete (solo detenidas, nombre exacto) | `features/sessions`, `commands/session.rs` | Sandbox: crear `hd-test-x`, conectar, stop, delete |
| T1.12 Puerta F1 | `pnpm verify`, `cargo test --features sandbox`, `pnpm e2e`, smoke y perf (sin regresión frente a F0). Demo de 5 min al usuario | `docs/03-arquitectura.md` | Checklist firmada |

---

## F2. Agentes, notificaciones y palette (3–4 días). Rama `f2-agentes`

| Tarea | Contenido | API |
|---|---|---|
| T2.1 Panel Agentes | Lista desde `snapshot.agents`. Orden `ui.agent_panel_sort` = spaces (agrupado) o priority (blocked > done > working > idle > unknown). Filas: icono de estado, nombre o `display_agent`, workspace/tab, `terminal_title_stripped`. Respeta `[ui.sidebar.agents] rows` / `rows_by_agent` y tokens `$name` | `agent.list` |
| T2.2 Acciones de agente | Caja de prompt: `agent.prompt` con opción `wait {until, timeout_ms}`, spinner cancelable y los errores `agent_blocked` / `agent_prompt_stalled` en español. Botones Esc y Ctrl+C (`agent.send_keys`). Renombrar (validación `[a-z][a-z0-9_-]{0,31}`). Enfocar (`agent.focus`, marca como visto). Transcript (`agent.read` recent-unwrapped, 200 líneas, visor con búsqueda). Esperar (`agent.wait`). Explicar (`agent.explain`, visor JSON) | `agent.*` |
| T2.3 Iniciar agente | Diálogo: pane existente en prompt o "nuevo split" (`pane.split` y luego `agent.start`), kind, nombre, args extra, timeout (3000 < t ≤ 300000). La lista de kinds se parsea en runtime de `herdr agent start --help` (`[possible values: …]`), así queda al día sola | `agent.start`, `pane.split` |
| T2.4 Estado visual | Glow por estado en PaneFrame, rollups en sidebar y tabs, overlay en la barra de tareas (`window.set_overlay_icon`) con el conteo de blocked, bandeja (`tray-icon`) con menú de sesiones y agentes | eventos + snapshot |
| T2.5 Notificaciones | Toast nativo (`tauri-plugin-notification`) cuando un agente pasa a blocked o done y la ventana no tiene foco o el pane no se ve. Clic → foco. Registrar el AUMID en el registro (patrón `windows-toast-identity.md` del skill tauri-desktop-app) para que no diga "Windows PowerShell". Toasts in-app glass. Sonidos según `[ui.sound]` (`enabled`, `path`, `done_path`, `request_path`, `[ui.sound.agents]`). Ajuste de la GUI "evitar duplicados con herdr" (aviso si `ui.toast.delivery = "system"`) | `pane.agent_status_changed` / snapshot |
| T2.6 Palette | `ctrl+shift+p`: acciones curadas (Anexo B) + búsqueda fuzzy de workspaces, tabs, panes y agentes + entrada "Consola API…" (F4) | — |
| T2.7 Navegación de agentes | `previous_agent`, `next_agent`, `focus_agent` (indexado), `open_notification_target` (último pane notificado) | `agent.focus` |
| T2.8 Puerta F2 | Tests: orden de prioridad, validación de nombres, mapeo de errores. Sandbox con `pane.report_agent` simulando blocked → llega el toast y el glow. `pnpm verify` + e2e + perf | — |

---

## F3. Layouts, worktrees, configuración y atajos completos (5–6 días). Rama `f3-layouts-config`

| Tarea | Contenido | API |
|---|---|---|
| T3.1 Edición de layout | Arrastrar un divisor → `layout.set_split_ratio {tab_id, path, ratio}` (con throttle de 30 ms y confirmación al soltar). Modo resize (`prefix+r`, flechas → `pane.resize {direction, amount:0.05}`). `pane.focus_direction`, `cycle_pane_next/previous`, `last_pane` (historial local). Swap arrastrando un header sobre otro pane (`pane.swap`). Mover a tab, tab nuevo o workspace nuevo (`pane.move` con los 3 `destination`) | `layout.*`, `pane.*` |
| T3.2 Reordenar | Drag de workspaces (`workspace.move`) y selección múltiple (`workspace.move_block`). Drag de tabs (`tab.move`) | `workspace.move*`, `tab.move` |
| T3.3 Presets de layout | "Guardar layout del tab" (`layout.export` → `%APPDATA%\herdr-desk\layouts\<nombre>.json`). "Aplicar preset" (`layout.apply {root, workspace_id, tab_label, focus}`). Editor JSON validado contra `LayoutNode` (hojas con `command`, `cwd`, `env`, `label`) | `layout.export/apply` |
| T3.4 Worktrees | Lista (`worktree.list` por cwd o workspace: branch, path y los flags bare/detached/linked/prunable, `open_workspace_id`). Crear (branch, base, path con default de `[worktrees] directory`, label, focus). Las ramas vienen de `git branch --format=%(refname:short)` (proceso con `CREATE_NO_WINDOW`). Abrir existente. Quitar (con `force`, doble aviso) | `worktree.*` |
| T3.5 Settings | `gen-settings.mjs` parsea `herdr --default-config` (secciones, `# key = valor`, comentarios previos como descripción, `[[keys.command]]`, líneas no comentadas como `pane_history = false`) y genera `settings.gen.ts` `{section, key, default, type, doc}`. Formulario auto-generado por secciones: Tema, Terminal, Actualización, Atajos, Worktrees, UI, Toasts, Sonidos, Sesión, Remoto (solo lectura), Experimental, Avanzado. Escritura: backup `config.toml.bak-<ts>` en la 1.ª escritura → `toml_edit` (conserva comentarios, solo guarda claves cambiadas) → `herdr config check` (diagnósticos visibles) → `server.reload_config`. Sección "GUI" aparte en `%APPDATA%\herdr-desk\settings.json`: nivel de glass, reducir transparencia, fuente y tamaño de terminal, WebGL on/off, bandeja al cerrar, sincronizar foco, notificaciones y sonidos de la GUI | `config.rs`, `server.reload_config` |
| T3.6 Editor de atajos | Tabla de las 54 acciones + navigate. Captura de combinación, detección de conflictos, "Restablecer" (`herdr config reset-keys`, confirm) | CLI `config reset-keys` |
| T3.7 Temas en vivo | Selector con preview. Aplica tokens CSS + tema xterm + `micaDark`/`micaLight`. Honra `auto_switch`, `dark_name`, `light_name` con `prefers-color-scheme` | `window.set_effects` |
| T3.8 Comandos personalizados | `[[keys.command]]`: `shell` → `cmd.exe /d /c <command>` detached (igual que herdr en Windows). `pane` → split temporal + `pane.send_input {text, keys:["enter"]}` + cierre en `pane_exited`. `popup` → se emula como pane temporal con zoom (desviación documentada) | `pane.*` |
| T3.9 Scrollback y búsqueda | "Buscar en salida" (`pane.read` recent-unwrapped, N líneas configurable, visor con resaltado y copia). `edit_scrollback` → archivo temporal + opener (editor externo). "Esperar salida" en el menú del pane (`pane.wait_for_output` substring/regex + timeout → toast al coincidir) | `pane.read`, `pane.wait_for_output` |
| T3.10 Git en espacios | Tokens `branch` y `git_status` para las filas de la sidebar: watcher (`notify`) sobre `.git/HEAD` y `.git/index` de los workspaces visibles → `git status --porcelain=v2 --branch`. Nada de polling | — |
| T3.11 Puerta F3 | Unit: parser de settings contra la salida real de `--default-config` (fixture), roundtrip de toml_edit que conserva comentarios, paths de divisores. e2e: divisor, preset, settings. Sandbox: worktree en un repo temporal (`git init` en `%TEMP%`). `pnpm verify` + perf | — |

---

## F4. Plugins, integraciones, servidor y consola API (3–4 días). Rama `f4-plugins-servidor`

| Tarea | Contenido | API / CLI |
|---|---|---|
| T4.1 Plugins | Lista (`plugin.list`: nombre, versión, enabled, descripción, warnings, source, acciones, panes, eventos). Enable y disable. Unlink (confirm). Link local (selector de carpeta → `plugin.link`). **Instalar desde GitHub** con `herdr plugin install owner/repo[/subdir] --ref X -y`, solo después de una vista previa propia (repo, ref, manifiesto) y confirmación explícita. Acciones (`plugin.action.list` → botones; `plugin.action.invoke` con contexto workspace/tab/pane). Logs (`plugin.log.list`). Panes de plugin (`plugin.pane.open/focus/close`; placement `popup` → fallback `zoomed`). Abrir carpeta de config (`herdr plugin config-dir`) | `plugin.*` + CLI install/uninstall/config-dir |
| T4.2 Integraciones | Estado (parsea `herdr integration status`: `^(\S+): (not installed\|current \(v\d+\)\|…) \((.*)\)$`, con fixture). Install y uninstall (`integration.install/uninstall`, 16 targets; normalizar `antigravity-cli` ↔ `antigravity_cli`) | CLI + `integration.*` |
| T4.3 Servidor | Estado (`herdr status --json` + `ping`: versión, protocolo, capabilities). Manifiestos (`server.agent_manifests` en tabla). Actualizar manifiestos (CLI `server update-agent-manifests --json`) y recargar (`server.reload_agent_manifests`). Recargar config. **Detener server** (doble confirmación: "termina todos los procesos de los panes"). Live handoff solo en Avanzado → Experimental | `server.*` |
| T4.4 Update y canal | `herdr update` con salida en vivo (y la opción `--handoff`). Al terminar se vuelve a resolver el exe y se reinician los bridges. `channel show/set` | CLI |
| T4.5 Consola API | Selector de los 90 métodos; formulario generado desde el schema de params (string, bool, int, enum, arrays, objetos → JSON); visor de respuesta; historial. Visor de eventos en vivo (suscripción elegible). **Garantiza el 100 % de cobertura** | `methods.gen.ts` |
| T4.6 Avanzado | Vista de agentes de herdr (`agent.view.set/clear`: filtro y orden). Metadata (`pane.report_metadata`, `workspace.report_metadata`, `report_agent*`, `clear_agent_authority`, `release_agent`). `client.window_title.*`, `pane.graphics.*`, `popup.close`, `notification.show` ("probar notificación de herdr"). Ayuda: "Copiar skill de agente" (`herdr --skill`) | varios |
| T4.7 Test de cobertura | Test vitest: cada método de `methods.gen.ts` está en `coverage.ts` como `curated:<ruta UI>` o `console`. Si herdr añade un método sin clasificar, **falla el build**. `schema:check` en `pnpm verify` | — |
| T4.8 Puerta F4 | Sandbox: link de un plugin de ejemplo local (manifiesto mínimo en `%TEMP%`), invocar una acción y ver el log. Consola: ejecutar `ping` y `pane.list`. `pnpm verify` + e2e | — |

---

## F5. Pulido, rendimiento y distribución (3–4 días). Rama `f5-release`

| Tarea | Contenido |
|---|---|
| T5.1 Pulido glass | Noise, highlights, estados vacío, error y carga con copy en español; motion (solo transform/opacity; `prefers-reduced-motion`); temas claros; a11y: contraste AA sobre glass (fondo mínimo 0,55 bajo texto), foco visible, todo operable con teclado |
| T5.2 Pase de rendimiento | Análisis de chunks; lazy de settings, plugins, worktrees, consola y servidor. WebView2 `MemoryUsageTargetLevel = Low` al minimizar o ir a bandeja (`webview.with_webview` + `webview2-com` 0.39.1). Tuning del LRU de xterm y de la gracia de bridges. Repetir `perf.ps1`: debe cumplir la §4 |
| T5.3 Empaquetado | Icono (`pnpm tauri icon <svg>`), NSIS `installMode: currentUser`, versión 0.1.0. Probar instalar, desinstalar y actualizar sin admin. Verificar qué exe corre (`Get-Process herdr-desk \| Select Path`: pitfall del exe instalado que tapa al de debug) |
| T5.4 Lanzador desde la TUI | Documentar el snippet `[[keys.command]] key="prefix+alt+d" type="shell" command="herdr-desk"` |
| T5.5 Auto-update (opcional, lo decide el usuario) | `tauri-plugin-updater` + GitHub Releases + clave de firma |
| T5.6 Docs y release | README (instalación, atajos, límites), `docs/03-arquitectura.md` final, CHANGELOG, tag `v0.1.0` |

**Criterios de aceptación de v1.0**
1. Los 90 métodos son alcanzables desde la GUI (test T4.7).
2. Los comandos CLI-only con sentido en la GUI están cubiertos (Anexo A).
3. Se cumple el presupuesto de la §4.
4. `pnpm verify`, `pnpm e2e` y los tests sandbox pasan en verde.
5. Instalador ≤ 10 MB.
6. Una jornada real de uso sin abrir la TUI.

---

## 6. Flujo de verificación por tarea

```
pnpm format:check && pnpm lint && pnpm check && pnpm test
cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
cargo test -p herdr-core --features sandbox -- --test-threads=1    # cuando toque el core
pnpm tauri build --debug --no-bundle && powershell -File scripts\smoke.ps1
```

- No encadenar con `| tail` (esconde el exit code; pitfall del skill).
- Usar `pnpm build`, no `npx vite build` (el guard de procesos lo bloquea).
- El CLI de Tauri se corre desde la raíz, que contiene `src-tauri/`.
- Antes de recompilar: matar `herdr-desk.exe` y sus bridges (el exe bloqueado da "os error 5"), esperar unos 10 s si Defender lo retiene y reintentar **una sola vez**.
- Commit por tarea después de verificar.

## 7. Qué NO hacer (guardarraíles)

- No lanzar `herdr` sin argumentos (abre la TUI). No probar subcomandos mutantes sin argumentos (se ejecutan con defaults).
- No usar la sesión `default` en desarrollo ni en tests. No correr `herdr server stop` salvo en sesiones sandbox.
- No heredar `HERDR_SOCKET_PATH` ni otras `HERDR_*`: la sesión siempre se elige explícitamente.
- No usar `cmd /c` con strings del usuario. La única excepción son los `[[keys.command]] type="shell"` de la propia config del usuario, igual que herdr. `cli_run` es una lista blanca.
- No poner `backdrop-filter` en filas de lista ni en terminales. No animar `box-shadow`, `filter` ni `width`/`height`.
- No meter frames ni buffers de terminal en `$state`.

## 8. Riesgos

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| R1 | Resize del controller pelea con la TUI | Media | T0.10 → modo control o modo espejo |
| R2 | Mica no se ve en una ventana sin marco y transparente | Media | Fallback con decoraciones nativas o glass solo en CSS |
| R3 | Mouse y bracketed paste no llegan a las apps internas | Alta | `pane.send_text` para pegar; mouse como limitación de v1; a futuro, protocolo binario |
| R4 | WebView2 > 200 MB | Media | Tuning en T5.2; spike B si > 250 MB |
| R5 | Muchos panes visibles = muchos procesos bridge | Media | Máx. 8 con WebGL; medir en R5; a futuro, protocolo binario nativo |
| R6 | API preview cambia (ya pasó: `pane.input.set` y `graphics.stream` en la doc) | Alta | `schema:check` + test de cobertura + errores "método no soportado" sin romper |
| R7 | `events_lost` bajo carga | Baja | Resuscribir + snapshot (T0.6) |
| R8 | Consola fantasma por proceso hijo | Baja | `CREATE_NO_WINDOW` en todo spawn |
| R9 | Popups e imágenes kitty no visibles | Cierta | Documentado; popup → pane temporal |
| R10 | Otro cliente toma el control del pane | Media | Estado "controlado por otra conexión · Retomar" |
| R11 | El foco de la GUI mueve la TUI | Media | T0.10 → foco local + ajuste de sincronización |

## 9. Estimación

| Fase | Días |
|---|---|
| F0 | 2–3 |
| F1 | 5–7 |
| F2 | 3–4 |
| F3 | 5–6 |
| F4 | 3–4 |
| F5 | 3–4 |

**Total: 21–28 días de trabajo.** Es una estimación, no una medición. Se re-estima al cerrar F0.

## 10. Preguntas abiertas (tienen default; no bloquean F0)

| # | Pregunta | Default |
|---|---|---|
| Q1 | Nombre | `herdr-desk` |
| Q2 | ¿Tiene que convivir con la TUI abierta a la vez? | Sí, en modo espejo si R1 lo exige |
| Q3 | Al cerrar la ventana | Salir (el server sigue vivo). Bandeja opcional |
| Q4 | ¿Repo privado o público? ¿Licencia? | Privado, sin licencia hasta decidir |
| Q5 | ¿Auto-update (T5.5)? | No en v0.1 |

---

## Anexo A. Cobertura de funcionalidades (90 métodos + CLI)

| Grupo | Métodos | Dónde en la GUI | Fase |
|---|---|---|---|
| Servidor (6) | `ping`, `server.stop`, `server.live_handoff`, `server.reload_config`, `server.agent_manifests`, `server.reload_agent_manifests` | Píldora de conexión, panel Servidor, Settings | F1/F4 |
| Notificación (1) | `notification.show` | Settings › Notificaciones (probar) | F4 |
| Cliente (2) | `client.window_title.set`, `client.window_title.clear` | Consola / Avanzado | F4 |
| Sesión (1) | `session.snapshot` | Store (bootstrap y reconciliación) | F0 |
| Workspace (9) | `workspace.create`, `list`, `get`, `focus`, `rename`, `move`, `move_block`, `report_metadata`, `close` | Sidebar, drag&drop, diálogo, consola (metadata) | F1/F3/F4 |
| Worktree (4) | `worktree.list`, `create`, `open`, `remove` | Diálogos Worktrees | F3 |
| Tab (7) | `tab.create`, `list`, `get`, `focus`, `rename`, `move`, `close` | Tab bar | F1/F3 |
| Agente (12) | `agent.list`, `get`, `read`, `explain`, `send_keys`, `rename`, `view.set`, `view.clear`, `focus`, `start`, `prompt`, `wait` | Panel Agentes, diálogos, Avanzado (view) | F2/F4 |
| Pane (29) | `pane.split`, `swap`, `move`, `zoom`, `layout`, `process_info`, `neighbor`, `edges`, `focus_direction`, `resize`, `list`, `current`, `get`, `focus`, `rename`, `send_text`, `send_keys`, `send_input`, `read`, `graphics.set`, `graphics.clear`, `graphics.info`, `report_agent`, `report_agent_session`, `report_metadata`, `clear_agent_authority`, `release_agent`, `close`, `wait_for_output` | PaneFrame, SplitTree, menús, atajos, búsqueda, consola (graphics, report_*) | F1/F3/F4 |
| Layout (3) | `layout.export`, `layout.apply`, `layout.set_split_ratio` | SplitTree, divisores, presets | F1/F3 |
| Popup (1) | `popup.close` | Palette / consola | F4 |
| Eventos (2) | `events.subscribe`, `events.wait` | Core + visor de eventos | F0/F4 |
| Integración (2) | `integration.install`, `integration.uninstall` | Settings › Integraciones | F4 |
| Plugin (11) | `plugin.link`, `list`, `unlink`, `enable`, `disable`, `action.list`, `action.invoke`, `log.list`, `pane.open`, `pane.focus`, `pane.close` | Pantalla Plugins | F4 |

Total: 6+1+2+1+9+4+7+12+29+3+1+2+2+11 = **90**.

Solo CLI, cubierto por `cli_run` (lista blanca):

| Comando | Fase |
|---|---|
| `session list/attach/stop/delete` | F1 |
| `server` (arrancar headless) | F1 |
| `status --json` | F4 |
| `update [--handoff]` | F4 |
| `channel show/set` | F4 |
| `config check`, `config reset-keys` | F3 |
| `integration status` | F4 |
| `plugin install/uninstall/config-dir` | F4 |
| `server update-agent-manifests --json` | F4 |
| `terminal session control/observe` (bridge) | F0 |
| `--default-config` (gen-settings) | F3 |
| `--skill` | F4 |
| `agent start --help` (kinds) | F2 |

No aplica: `completion`, `--remote` (fuera de v1), `terminal title` (concepto de terminal externa; se cubre con `client.window_title.*` en la consola).

## Anexo B. Acciones de teclado de herdr → GUI (54 + navigate)

| Acción herdr | Implementación GUI | Fase |
|---|---|---|
| help | Overlay de atajos | F1 |
| settings | Abrir Settings | F3 |
| detach | Cerrar o minimizar la GUI sin tocar el server | F1 |
| reload_config | `server.reload_config` | F1 |
| open_notification_target | Foco al pane de la última notificación | F2 |
| workspace_picker | Selector fuzzy de espacios | F2 |
| goto (+ navigate_*) | Modo navegar: ↑↓ espacios, h/j/k/l panes, 1..9, enter | F3 |
| new_workspace | Diálogo | F1 |
| new_worktree | Diálogo | F3 |
| open_worktree | Diálogo | F3 |
| remove_worktree | Diálogo | F3 |
| rename_workspace | Inline | F1 |
| close_workspace | Confirm | F1 |
| previous_workspace / next_workspace | `workspace.focus` por orden | F1 |
| previous_agent / next_agent / focus_agent | `agent.focus` por orden de atención | F2 |
| new_tab | `tab.create` | F1 |
| rename_tab | Inline | F1 |
| previous_tab / next_tab / switch_tab (1..9) / switch_workspace (indexado) | Foco por índice | F1 |
| close_tab | Confirm | F1 |
| rename_pane | Inline | F1 |
| edit_scrollback | Visor o editor externo | F3 |
| focus_pane_left/down/up/right | `pane.focus_direction` | F1 |
| cycle_pane_next/previous | Orden del árbol | F3 |
| last_pane | Historial local | F3 |
| split_vertical / split_horizontal | `pane.split` right / down | F1 |
| close_pane | `pane.close` | F1 |
| zoom | `pane.zoom` toggle | F1 |
| resize_mode | Modo resize | F3 |
| toggle_sidebar | Colapsar según `sidebar_collapsed_mode` | F1 |
| `[[keys.command]]` | Comandos personalizados | F3 |
| `[keys.indexed]` (legacy) | Se parsea igual | F1 |
| remote_image_paste | N/A (solo remoto) | — |

## Anexo C. Errores en español (`src/lib/herdr/errors.ts`)

| Código | Mensaje |
|---|---|
| `not_found` | "Ya no existe (se cerró o cambió de id). Actualicé la vista." |
| `invalid_params` | "Datos inválidos: {message}" |
| `agent_blocked` | "El agente está esperando tu respuesta. Revísalo antes de enviar otro prompt." |
| `agent_prompt_stalled` | "El agente no reaccionó en 5 s. Comprueba que esté listo." |
| `stream_conflict` | "Otra conexión ya controla esa capa." |
| `popup_not_open` | "No hay ningún popup abierto." |
| `transport` | "No hay conexión con el servidor herdr (sesión {s}). ¿Está corriendo?" + botón Iniciar |
| `timeout` | "herdr no respondió a tiempo ({method})." |
| `bridge_closed` | "La terminal se desconectó ({reason})." + Reconectar |
| Método no soportado o desconocido | "Esta versión de herdr no soporta «{method}»." (se muestra `message` tal cual) |
