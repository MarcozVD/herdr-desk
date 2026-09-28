# herdr-desk

GUI de escritorio (Windows 11) para [herdr](https://github.com/herdrdev/herdr), el multiplexor
de terminales para agentes de código, con estética glassmorphism sobre Mica.

> **En desarrollo.** F0–F5 están cerradas y `pnpm verify` + `pnpm e2e` pasan, pero la app
> todavía no está firmada ni verificada en una jornada real fuera de esta máquina: el
> instalador y el lanzador de abajo los tiene que probar el usuario. Requiere herdr
> 0.8.0-preview (protocol 19) y Windows 11.

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
- **Plugins**: lista con estado, activar y desactivar, desvincular, vincular una carpeta local,
  instalar desde GitHub con vista previa, acciones con contexto, logs y panes.
- **Integraciones**: estado, versión y ruta de cada una, con instalación y desinstalación bajo
  confirmación.
- **Servidor**: estado por CLI y por sesión viva, manifiestos de agentes, recarga de configuración,
  detener con doble confirmación, y **update y canal** desde la lista blanca del CLI.
- **Consola API**: los 90 métodos del catálogo con formulario generado desde el schema,
  respuesta en el visor, historial y **24 tipos de evento en vivo**.
- **Avanzado**: metadata de pane y workspace, agentes reportados, título de ventana, gráficos
  kitty, cierre de popup, traspaso en vivo, notificación de prueba y skill del agente.
- **Backend** de configuración, worktrees, plugins, integraciones, estado del servidor y
  catálogo de métodos para la consola API, con `pnpm schema:check` vigilando que el schema
  commiteado no derive del que trae el herdr instalado. Los 90 métodos están clasificados
  (`curated:<feature>` o `console`) y un test falla si el schema añade uno sin clasificar.

Lo que todavía no está: el modo navegar de atajos (F3) y la auto-actualización (T5.5, omitida a
falta de decisión; hoy se actualiza reinstalando el instalador encima).

## Instalación

Hay dos caminos.

### Instalador (release)

`pnpm tauri build` produce el instalador NSIS en
`target/release/bundle/nsis/herdr-desk_0.1.0_x64-setup.exe` (3,51 MB). Se instala **sin
administrador**: `installMode: currentUser` lo deja en `%LOCALAPPDATA%\herdr-desk` y no pide
UAC. Los ajustes de la GUI siguen en `%APPDATA%\herdr-desk\settings.json`.

```powershell
pnpm tauri build
& target\release\bundle\nsis\herdr-desk_0.1.0_x64-setup.exe
```

- **Comprobar cuál corre**: `Get-Process herdr-desk | Select-Object Path` debe dar
  `C:\Users\<usuario>\AppData\Local\herdr-desk\herdr-desk.exe`. Si da `target\release\…` es la
  copia de desarrollo, no la instalada.
- **Desinstalar**: Configuración > Aplicaciones > herdr-desk, o
  `%LOCALAPPDATA%\herdr-desk\uninstall.exe`. Sin permisos de administrador.
- **Actualizar**: reinstalar el `.exe` nuevo encima.

Al lanzar la copia instalada no hay `HERDR_DESK_SESSION` en el entorno: la app resuelve sola la
sesión `default` (o la primera que devuelva el CLI) con `herdr session list --json`, y solo
aborta si el CLI no responde. Para apuntarla a otra sesión:

```powershell
$env:HERDR_DESK_SESSION = "herdr-desk-dev"
& "$env:LOCALAPPDATA\herdr-desk\herdr-desk.exe"
```

### Desarrollo

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

### Lanzarlo desde herdr

Un comando personalizado en `[keys]` de `config.toml` abre la GUI sobre la sesión que ya
tenías en la TUI, porque herdr exporta `HERDR_DESK_SESSION` a los comandos `shell`:

```toml
[[keys.command]]
key = "prefix+alt+d"
type = "shell"
command = "herdr-desk"
```

En Windows herdr ejecuta los comandos `type = "shell"` en `cmd`, así que `herdr-desk` tiene que
estar en el `PATH`. El instalador **no** lo añade: o se agrega
`%LOCALAPPDATA%\herdr-desk` al PATH del usuario, o se usa la ruta absoluta:

```toml
command = "\"%LOCALAPPDATA%\\herdr-desk\\herdr-desk.exe\""
```

## Atajos principales

El prefijo es `Ctrl+B` (los valores por defecto son los de herdr y se pueden cambiar por
completo en `[keys]` de `config.toml`, con el editor de atajos de `prefix+s`).

| Atajo                             | Acción                                          |
| --------------------------------- | ----------------------------------------------- |
| `Ctrl+Shift+P`                    | paleta de acciones                              |
| `Ctrl+Shift+C` / `Ctrl+Shift+V`   | copiar/pegar de la terminal                     |
| `prefix+?`                        | cheatsheet con todos los atajos activos         |
| `prefix+s`                        | ajustes: configuración, atajos, temas y cristal |
| `prefix+c` / `prefix+shift+x`     | nueva pestaña / cerrar pestaña                  |
| `prefix+n` / `prefix+p`           | pestaña siguiente / anterior                    |
| `prefix+1..9`                     | ir a la pestaña N                               |
| `prefix+w` / `prefix+shift+n`     | selector de espacios / nuevo espacio            |
| `prefix+v` / `prefix+minus`       | dividir panel a la derecha / abajo              |
| `prefix+h j k l`                  | enfocar panel izquierda/abajo/arriba/derecha    |
| `prefix+tab` / `prefix+shift+tab` | siguiente / anterior panel                      |
| `prefix+z`                        | zoom del panel                                  |
| `prefix+x`                        | cerrar panel                                    |
| `prefix+r`                        | modo redimensionar con las flechas              |
| `prefix+b`                        | plegar la sidebar                               |
| `prefix+e`                        | editar el scrollback del panel                  |
| `prefix+q`                        | soltar el panel (detach)                        |
| `prefix+g` / `prefix+shift+g`     | ir a un espacio / nuevo worktree                |

## Límites conocidos

- **Sin auto-actualización** (T5.5 omitida): no hay `tauri-plugin-updater` ni claves de firma.
  Actualizar es reinstalar el instalador.
- **Sin firmar**: el ejecutable y el instalador no llevan certificado, así que Windows SmartScreen
  avisa la primera vez.
- **Modo navegar de atajos pendiente** (F3): el keymap clasifica ya el ámbito `navigate`, pero no
  existe el modo ni su `Hint`.
- **CPU en reposo** con la ventana visible: 0,42–1,04 % (la meta de la §4 del plan era ≤ 0,5 %).
  Es el suelo del compositor de WebView2 con ventana transparente y capas de cristal; el cursor de
  la terminal ya no parpadea para no empeorarlo.
- **RAM** ≈ 200 MB con una terminal visible (177,8 MB sin paneles). El presupuesto se cumple
  justo.
- **Temas claros de herdr**: algunas paletas (p. ej. `solarized-light`, `catppuccin-latte` en su
  `--text-dim`) no llegan a contraste AA sobre el cristal, ni con la capa opaca. El piso de
  opacidad garantiza los tokens de respaldo de la GUI, no cualquier paleta.
- **Contraste en tema claro**: a partir del nivel de cristal ~7 (surface) el deslizador deja de
  cambiar la opacidad en claro; es el precio de cumplir AA contra un fondo negro.
- **Eco, evento→UI, cambio de pestaña y flood** no se remedieron en F5: los valores son los de F0/F1.
- **Cierre automático de los paneles que abre un comando `pane`/`popup`**: hoy hay que cerrarlos a
  mano (no hay canal de eventos que avise de `pane_exited` en la UI).
- **La jornada real fuera de esta máquina** (instalar, usar un día entero sin TUI) la tiene que
  validar el usuario: no es verificable desde el agente.

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
- [x] F4 — plugins, integraciones, estado del servidor, update y canal, consola API con los 90
      métodos y eventos en vivo, panel avanzado, y cobertura de métodos vigilada por test
- [x] F5 — pulido, accesibilidad y contraste medido, diálogos cargados bajo demanda, memoria del
      WebView2, instalador NSIS sin administrador y lanzador desde herdr; queda fuera la
      auto-actualización (T5.5)

## Licencia

Apache 2.0. Ver [LICENSE](LICENSE).
