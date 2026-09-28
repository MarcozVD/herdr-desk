# herdr-desk

GUI de escritorio (Windows 11) para [herdr](https://github.com/herdrdev/herdr), el multiplexor
de terminales para agentes de código, con estética glassmorphism sobre Mica.

> **En desarrollo.** No es una release: la app funciona a diario, pero la interfaz todavía está
> en construcción y el surfaces cambia entre commits. Requiere herdr 0.8.0-preview
> (protocol 19) y Windows 11.

## Qué hay

- **Terminales en vivo** sobre los bridges de herdr, con WebGL, scrollback en el servidor y
  reconexión con respawn. Ocultar un panel no lo mata: se suelta el bridge y al volver se
  reengancha con repintado completo.
- **Espacios, tabs y panes** con splits anidados, redimensionado por arrastre y foco local
  que manda sobre el del servidor.
- **Panel de agentes** con orden por prioridad, glow por estado, rollups y notificaciones
  nativas con AUMID propia.
- **Acciones de agente**: arrancar un agente en un workspace, prompt, foco, lectura y espera de
  salida, todo vía RPC contra el CLI.
- **Paleta de acciones** con navegación de agentes y sonidos.
- **Ajustes** (`prefix+s`): formulario de la configuración real de herdr —secciones y claves
  generadas desde `herdr --default-config`, valores efectivos de `config.toml` y guardado con
  backup, check y recarga— más las preferencias que la GUI no puede meter en `config.toml`
  (cristal, WebGL, LRU), que van a `%APPDATA%\herdr-desk\settings.json`.
- **Editor de atajos**: captura de combinaciones, ámbitos y conflictos en vivo, y escritura
  sobre `[keys]` de `config.toml` (reinicio con `herdr config reset-keys`).
- **Temas en vivo**: las 18 paletas de herdr aplicadas a la interfaz y a la paleta ANSI del
  terminal, con `auto_switch` según la apariencia de Windows y el cristal Mica cambiando a
  claro/oscuro con el tema.
- **Paneles y pestañas**: modo redimensionar con las flechas (chip en la barra de título),
  intercambio de paneles arrastrando uno sobre otro, mover un panel a otra pestaña, a una
  pestaña nueva o a un espacio nuevo, y reordenar pestañas y espacios arrastrando.
- **Presets de layout** guardados con nombre y aplicables desde la paleta, validados contra el
  contrato antes de mandarlos al servidor.
- **Worktrees**: diálogo con los checkouts del repo, creación desde la ruta elegida, apertura y
  borrado con doble confirmación.
- **Comandos personalizados** de `[[keys.command]]`: cada uno atado a una tecla desde la
  configuración, con tipo `shell` (detached, sin consola), `pane` o `popup`.
- **Salida de los paneles**: buscar en el scrollback, abrirlo en el editor externo y esperar a
  que aparezca un texto o un `re:`.
- **Estado git** por espacio: rama y número de cambios sin limpiar en la barra lateral.
- **Bandeja y overlay** de la barra de tareas, con iconos propios: blanco en la barra de tareas
  y negro en la bandeja.
- **Backend** de configuración, worktrees, plugins, integraciones, estado del servidor y
  catálogo de métodos para la consola API, con `pnpm schema:check` vigilando que el schema
  commiteado no derive del que trae el herdr instalado.

Lo que todavía no está: el modo navegar de atajos, la consola API, el gestor de plugins y el
resto de superficies de F4, y el pulido de F5.

## Arquitectura

- `crates/herdr-core` — Rust puro (sin UI): transporte por named pipe (NDJSON, 1 request por
  conexión), suscripción de eventos (conexión L global + conexión S por pane), snapshot
  coalescido y pool de bridges de terminal (`herdr terminal session control`).
- `src-tauri` — capa fina de Tauri 2: commands + channels, frames binarios y JSON crudo,
  gestión de sesiones (conectar/iniciar/detener/borrar) y reconexión con respawn de bridges.
- `src/` — SPA en Svelte 5 con xterm.js WebGL, Mica de Windows 11 y glass en CSS.

Detalles en [`docs/03-arquitectura.md`](docs/03-arquitectura.md) (backend) y
[`docs/04-ui-arquitectura.md`](docs/04-ui-arquitectura.md) (UI).

## Desarrollo

Requisitos: Rust 1.97 (ver `rust-toolchain.toml`), Node 22, pnpm 10, herdr 0.8.0-preview
(protocol 19) en PATH.

```powershell
pnpm install
pnpm verify          # formato + lint + check + tests + rust lint/test
pnpm tauri dev       # desarrollo
```

El backend exige elegir sesión explícita con `HERDR_DESK_SESSION` (nunca usa `default` ni
hereda `HERDR_*`). Para desarrollo, levanta primero la sesión sandbox:

```powershell
powershell -File scripts\sandbox.ps1 start        # sesión herdr-desk-dev
$env:HERDR_DESK_SESSION = "herdr-desk-dev"
pnpm tauri dev
powershell -File scripts\sandbox.ps1 stop         # al terminar
```

### Scripts

| Script                | Qué hace                                                       |
| --------------------- | -------------------------------------------------------------- |
| `scripts/sandbox.ps1` | start/stop/status de la sesión sandbox `herdr-desk-dev`        |
| `scripts/smoke.ps1`   | lanza el exe, espera `[herdr-desk] ready`, lo mata             |
| `scripts/perf.ps1`    | arranque, RAM del árbol (exe + WebView2), CPU en reposo → JSON |

### Tests

```powershell
pnpm test                                                  # unit del frontend
pnpm e2e                                                   # e2e (Playwright)
pnpm gen                                                   # codegen de types y settings desde herdr
pnpm schema:check                                          # deriva del schema (sale != 0 si difiere)
cargo test --workspace                                     # unit de Rust
cargo test -p herdr-core --features sandbox -- --test-threads=1   # contra sesiones hd-test-*
```

Para re-grabar las fixtures de eventos del protocolo:

```powershell
$env:RECORD_FIXTURES = "1"
cargo test -p herdr-core --features sandbox --test record_fixtures -- --test-threads=1
Remove-Item Env:\RECORD_FIXTURES                           # re-graba schema/fixtures/events
```

## Estado

- [x] F0 — spike y medición
- [x] F1 — núcleo: modelo, sesiones, reconexión, conexión S, pool de terminales, workspaces
- [x] F2 — panel de agentes, acciones, notificaciones nativas, paleta
- [~] F3 — worktrees, configuración por RPC, redimensionado e intercambio de paneles, reordenar
  pestañas y espacios, formulario de configuración, editor de atajos, temas en vivo, presets de
  layout, worktrees, comandos personalizados, scrollback y estado git; falta el modo navegar de
  atajos
- [~] F4 — plugins, integraciones, estado del servidor y catálogo de la consola API por RPC;
  faltan sus superficies de UI
- [ ] F5 — pulido, rendimiento y distribución

## Licencia

Apache 2.0. Ver [LICENSE](LICENSE).
