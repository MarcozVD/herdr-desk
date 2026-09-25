# herdr-desk

GUI de escritorio (Windows 11) para [herdr](https://github.com/herdrdev/herdr), el multiplexor
de terminales para agentes de código, con estética glassmorphism sobre Mica.

Cubre el 100 % de las funciones del CLI herdr: espacios, tabs, panes, terminales en vivo,
panel de agentes con notificaciones, layouts, worktrees, settings, plugins, integraciones,
servidor y consola API.

## Arquitectura

- `crates/herdr-core` — Rust puro (sin UI): transporte por named pipe (NDJSON, 1 request por
  conexión), suscripción de eventos con resuscripción, snapshot coalescido y pool de bridges
  de terminal (`herdr terminal session control`).
- `src-tauri` — capa fina de Tauri 2: commands + channels, frames binarios y JSON crudo.
- `src/` — SPA en Svelte 5 con xterm.js WebGL, Mica de Windows 11 y glass en CSS.

## Desarrollo

Requisitos: Rust 1.97, Node 22, pnpm 10, herdr 0.8.0-preview (protocol 19).

```powershell
pnpm install
pnpm verify          # formato + lint + check + tests + rust lint/test
pnpm tauri dev       # desarrollo (requiere sesión sandbox: HERDR_DESK_SESSION=herdr-desk-dev)
```

## Estado

- [x] F0 — spike y medición
- [ ] F1 — núcleo usable a diario
- [ ] F2 — agentes, notificaciones y palette
- [ ] F3 — layouts, worktrees, configuración y atajos
- [ ] F4 — plugins, integraciones, servidor y consola API
- [ ] F5 — pulido, rendimiento y distribución

Ver `docs/00-plan-desarrollo.md` para el plan completo.
