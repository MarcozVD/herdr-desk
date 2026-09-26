# herdr-desk

GUI de escritorio (Windows 11) para [herdr](https://github.com/herdrdev/herdr), el multiplexor
de terminales para agentes de código, con estética glassmorphism sobre Mica.

Cubre el 100 % de las funciones del CLI herdr: espacios, tabs, panes, terminales en vivo,
panel de agentes con notificaciones, layouts, worktrees, settings, plugins, integraciones,
servidor y consola API.

## Arquitectura

- `crates/herdr-core` — Rust puro (sin UI): transporte por named pipe (NDJSON, 1 request por
  conexión), suscripción de eventos (conexión L global + conexión S por pane), snapshot
  coalescido y pool de bridges de terminal (`herdr terminal session control`).
- `src-tauri` — capa fina de Tauri 2: commands + channels, frames binarios y JSON crudo,
  gestión de sesiones (conectar/iniciar/detener/borrar) y reconexión con respawn de bridges.
- `src/` — SPA en Svelte 5 con xterm.js WebGL, Mica de Windows 11 y glass en CSS.

Detalles en `docs/03-arquitectura.md`.

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

### Tests backend

```powershell
cargo test -p herdr-core                                      # unitarios (sin herdr)
cargo test -p herdr-core --features sandbox -- --test-threads=1   # contra sesiones hd-test-*
$env:RECORD_FIXTURES = "1"
cargo test -p herdr-core --features sandbox --test record_fixtures -- --test-threads=1
Remove-Item Env:\RECORD_FIXTURES                              # re-graba schema/fixtures/events
```

## Estado

- [x] F0 — spike y medición (`docs/02-f0-resultados.md`)
- [x] F1 — núcleo usable a diario (backend: modelo, sesiones, reconexión, conexión S, pool de terminales)
- [ ] F1 — puerta de F1 (verificación consolidada con el frontend)
- [ ] F2 — agentes, notificaciones y palette
- [ ] F3 — layouts, worktrees, configuración y atajos
- [ ] F4 — plugins, integraciones, servidor y consola API
- [ ] F5 — pulido, rendimiento y distribución

Ver `docs/00-plan-desarrollo.md` para el plan completo.
