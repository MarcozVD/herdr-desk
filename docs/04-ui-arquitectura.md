# 04 · Arquitectura de la UI (herdr-desktop)

Fecha: 2026-09-25 · ramas `f0-spike` (cerrada) y `f1-nucleo` · herdr 0.8.0-preview, protocol 19
Alcance: la parte FRONTEND (Vite + Svelte 5 + xterm 6 dentro del WebView2 de Tauri 2).
El backend (herdr-core + `src-tauri`) se documenta en `03-arquitectura.md`.

## 1. Resultados de F0 (mi parte)

F0 cerró con el spike usable: configs raíz, núcleo de frontend (frames binarios, snapshot
reconciliado, cliente IPC, shell glass) y validación en la sesión sandbox `herdr-desk-dev`.

| Riesgo | Meta / criterio | Medido en F0 | Cómo |
|---|---|---|---|
| **R2** Mica + ventana sin marco | glass real, no maqueta | `decorations: false` + Mica confirmados por el backend; la UI pinta 3 superficies glass (titlebar, sidebar, status bar) sobre `backdrop-filter: blur(20px) saturate(140%)`, fondo mesh al 12 % + ruido SVG al 3 %, y la terminal **sin** backdrop-filter | e2e + captura de la ventana real |
| **R3** Fidelidad de input | bytes exactos, pegado multilínea en un solo input | flechas `\x1b[A`/`\x1b[B`, `Ctrl+C`=`\x03`, `Enter`=`\r` y pegado de 3 líneas en **un** `terminal_input`; eco tecla→frame bridge-level p50 21 ms / p95 50 ms (el eco keydown→pintado lo mide el backend: p50 31 / p95 32 ms) | e2e (bytes reenviados) + `r3-probe.py` contra pane real 100×30 |
| **R8** Consola fantasma | 0 ventanas de consola | el frontend no lanza procesos (no hay spawn en `src/**`): el `CREATE_NO_WINDOW` de los bridges es del backend; verificado abriendo bridges reales | revisión de código + ejecución real |
| **R11** Foco con TUI | no romper la vista de la TUI | el foco es **local** por defecto: el clic en un espacio/panel no emite `workspace.focus` ni `pane.focus`; hay un ajuste «Sincronizar foco con TUI» (apagado por defecto, persistido) que sí los emite | e2e con el registro de IPC en ambos modos |

Dato de la §4 medido ya en F0: **snapshot → atributo en el DOM = 1,4 ms** (meta ≤ 50 ms) y
`resize` → `terminal_resize` en **una** llamada (debounce de 60 ms).

## 2. Capas y estructura

```
src/
  main.ts               arranque: ajustes + temas + keymap + montaje + ui_ready
  App.svelte            composición del shell, efecto del árbol y manejador de teclado
  app.css               glass, layout del shell, botones, overlays
  lib/
    herdr/              contrato con el backend: client, errors, actions, types(.gen), methods.gen
    stores/             session (runas + reconciliación), layout (árbol), ui (efímero), settings
    terminal/           frames.ts (decoder/FrameWriter), pool.ts, TerminalView, TerminalScrollbar
    layout/             tree.ts (geometría y vecinos) + SplitTree.svelte
    keys/               parse.ts, keymap.ts, actions.ts, Cheatsheet.svelte
    actions/flows.ts    flujos de UI (diálogos + comandos) usados por menús y atajos
    ui/                 primitivas glass: Dialog, Confirm, Prompt, Field, IconButton, Kbd, Toast, ContextMenu
    i18n/es.ts          todos los strings (decisión D3)
    theme/tokens.css    tokens del §3 (glass, radios, tipografías, acentos)
  features/             titlebar, sidebar, tabs, panes, statusbar, sessions
tests/e2e/              Playwright + mockIPC (arnés en src/lib/testing/harness.ts)
tests/fixtures/         default-config.toml (`herdr --default-config`)
```

Regla de oro del §4/§7: **los frames de terminal no entran en la reactividad**. Van del
Channel al `FrameWriter` (en `lib/terminal/frames.ts`) y de ahí a xterm; si un frame llega
con `full`, los frames anteriores en cola se descartan.

## 3. Stores

| Store | Qué guarda | Notas de diseño |
|---|---|---|
| `session.svelte.ts` | snapshot crudo (`$state.raw`), colecciones reconciliadas, foco, conexión, versión/protocolo, latencia p50, `revision`, `connectionEpoch` | el snapshot se reemplaza entero en cada evento; las colecciones se reconcilian **en sitio** (`reconcileById`) para que nada se remonte |
| `layout.svelte.ts` | árbol del tab visible (`layout.export`), `zoomed`, `revision` | `schedule()` no lee runas: se llama desde un `$effect` y Svelte corta con `effect_update_depth_exceeded` si un efecto lee y escribe el mismo estado |
| `ui.svelte.ts` | qué está abierto (paleta, cheatsheet, contexto, sesiones), foco local, toasts y promesas de confirmación/prompt | un solo `ConfirmDialog`/`PromptDialog` montado; `{#key}` lo recrea con cada petición |
| `settings.svelte.ts` | preferencias (ancho de sidebar, `collapsed_mode`, posición de la tab bar, `pane_borders/gaps`, `mouse_scroll_lines`, `webgl_max_panes`, LRU, `copy_on_select`, sincronizar foco…) | por defecto salen de `herdr --default-config`; se persisten en `localStorage` y en F3 se leerán de `config.toml` + `settings.json` |

`reconcileById(current, next, key, assign)` conserva la identidad de los objetos que siguen
existiendo (mutando sus campos), añade los nuevos y descarta los que ya no están; devuelve
estadísticas (`added/removed/changed/moved`) que usan los tests.

Estados de conexión: `connecting → online ⇄ offline`. `online` exige **snapshot** (un `ping`
correcto no basta: sin datos la UI no sirve). Si el snapshot no llega en 2,5 s (watchdog) o
la suscripción falla, pasa a `offline` y reintenta con backoff 250 ms → 5 s; `connectionEpoch`
sube en cada reconexión y es la señal para que el pool reabra los bridges visibles.

## 4. Terminal

- **Contrato**: `terminal_open(pane_id, cols, rows, onFrame)` devuelve un `bridgeId`; el frame
  es el binario de 16 bytes + ANSI del §5 (`seq u64 · width u16 · height u16 · flags u8 ·
  reservado 3 · bytes`).
- **Pool** (`pool.ts`): decide qué panes tienen bridge (**solo los montados = visibles**),
  mantiene las instancias de xterm en un LRU de 12, da WebGL como máximo a 8 panes (el resto
  cae al renderer DOM sin avisar) y libera el bridge al ocultarse el panel. El backend aplica
  su propia gracia de 3 s y reusa `bridge_id`/Channel al respawnear tras una caída del server,
  así que la UI solo reabre cuando el panel vuelve a ser visible (durante la gracia el bridge
  rechaza input con `bridge_closed`).
- **Scroll**: `scrollback: 0` en xterm; el scrollback vive en el server. La rueda y la barra
  propia (`TerminalScrollbar`) traducen cada gesto a `terminal_scroll(direction, lines)`, con
  `mouse_scroll_lines` de la configuración (3 por defecto).
- **Copiar/pegar**: `@tauri-apps/plugin-clipboard-manager` (crate y capability los registra el
  backend): `Ctrl+Shift+C/V`, menú contextual del panel y `copy_on_select` (por defecto
  activo, copia al soltar la selección). Los links van al navegador con el plugin `opener`.
- **Input**: se reenvía **tal cual** lo produce xterm (`onData`/`onBinary`) — nada de filtros ni
  reescrituras, que es lo que hace que PSReadLine, Ctrl+C y vim funcionen (R3). Los bytes
  previos a la apertura del bridge se guardan y se envían al abrir.

## 5. Atajos (T1.10)

- `parse.ts` entiende la sintaxis de herdr: `ctrl+b`, `prefix+shift+n`, `prefix+1..9`, nombres
  de puntuación (`minus`, `comma`, `plus`, `backtick`…), alias de teclas especiales
  (`esc`, `enter`, `pageup`…) y convierte un `KeyboardEvent` en un chord canónico
  (letras en minúscula conservando `shift`; `?`/`!` con el shift ya consumido por el carácter).
- `keymap.ts` carga los **mismos valores por defecto** que `herdr --default-config` (fixture
  `tests/fixtures/default-config.toml`; el test unitario compara ambos para que no divergieran),
  resuelve prefix/índices directos y detecta conflictos.
- Ámbitos: `prefix` (tras pulsar `Ctrl+B`), `direct` (ej. `Ctrl+V` de `remote_image_paste`,
  reservado para `--remote`) y `navigate` (**F3**: las flechas y `h/j/k/l` sueltos solo valen
  dentro del modo navegar — si se capturaran fuera, dejarían de llegar a la terminal).
- Reservados de la GUI: `Ctrl+Shift+P` (paleta), `Ctrl+Shift+C/V` (copiar/pegar del panel).
  Todo lo demás sin binding va a la terminal.
- La tecla de prefix dos veces manda el `Ctrl+B` literal (`\x02`) al panel, como la TUI. Las
  teclas modificadoras solas no son atajo: el `Control` de `Ctrl+B` no consume el modo prefix.
- La acción `help` abre el cheatsheet con todos los atajos activos, los del modo navegar
  (marcados como F3) y los conflictos si los hubiera.

## 6. Shell, acciones y sesiones

- **Titlebar**: drag region, selector de sesión, botón de paleta, chip `PREFIX`, píldora de
  conexión (estado + latencia p50 del RPC) y controles de ventana min/max/cerrar.
- **Sidebar**: espacios con número, etiqueta, rollup de estado de agente y conteos; agentes
  ordenados por prioridad; respeta `sidebar_width/min/max` y los modos `compact`/`hidden`.
- **Tab bar**: pestañas del espacio activo con `tab_bar_position` (arriba/abajo) y
  `hide_tab_bar_when_single_tab`.
- **Paneles**: `SplitTree` renderiza el árbol de `layout.export` con flex y los ratios reales;
  cada `PaneFrame` lleva estado, título, cwd, acciones (dividir, zoom, renombrar, cerrar) y su
  terminal. Los divisores son visuales en F1 (el arrastre con `layout.set_split_ratio` es T3.1).
- **Status bar**: panel enfocado, cwd, scroll, número de paneles, indicador de zoom, latencia
  y versión/protocolo.
- **Acciones** (`lib/actions/flows.ts`): crear/renombrar/cerrar/mover espacio, nueva
  pestaña/renombrar/cerrar/enfocar, dividir/zoom/renombrar/cerrar panel, con diálogos glass y
  confirmación cuando `confirm_close` está activo. Los cierres destructivos piden el nombre.
- **Selector de sesiones** (T1.11): lista las sesiones del CLI (`session_list`), conecta
  (`session_connect`, arrancando antes si está detenida), arranca/detiene/borra con
  confirmación y crea sesiones nuevas validando el nombre.

## 7. Huecos del contrato §5 encontrados

1. `session_current` no está en el §5 y la UI lo usa para el nombre de la sesión: hoy cae a
   «sesión» si el command no existe. El backend ya expone `session_list`, así que se puede
   resolver con eso o añadiendo el command.
2. `store_subscribe` entrega el snapshot como objeto crudo (sin envoltorio `{type, snapshot}`);
   la UI tolera las dos formas y también bytes.
3. `ui_ready` no aparece en la tabla del §5 pero el §T0.8 lo define; la UI lo llama y tolera
   que falle.

## 7bis. Fallos reportados en la app en vivo (diagnóstico y arreglo)

Tres síntomas reportados por el usuario: (a) «la UI perdió forma», (b) «no se conecta a nada»
y (c) «al pulsar Iniciar servidor sale *El backend todavía no expone session_start*».

### (a) Layout: el shell era un grid de 3 filas con 4 hijos

`.shell` usaba `grid-template-rows: var(--titlebar-height) minmax(0,1fr) var(--statusbar-height)`
con **tres** filas y, desde T1.5, **cuatro** hijos (titlebar, franja de reconexión, cuerpo y
status bar). La franja —condicional— se quedaba la fila elástica.

Medido con el bundle de producción (`vite preview`, ventana 1280×800):

| Elemento | Antes | Después |
|---|---|---|
| franja de reconexión | **709 px** | 36 px |
| `.body` (cuerpo) | **26 px** | 690 px |
| sidebar | 26 px de alto | 674 px |
| área de paneles | 0 px | 636 px |
| status bar | 17 px, texto cortado | 26 px, legible |

Arreglo: `.shell` pasa a **columna flex** (`titlebar` y `statusbar` con su alto propio,
`.body` con `flex: 1 1 auto; min-block-size: 0`) y la franja con `flex: 0 0 auto`. La captura
de la ventana real (CopyFromScreen) confirmó la estructura correcta y el presupuesto de
espacio. Se añadieron dos pruebas e2e de regresión que miden la geometría de las cuatro
bandas (franja < 80 px, cuerpo > 400 px, cero desbordamiento horizontal) porque las pruebas
existentes comprobaban visibilidad, no forma.

### (b) «No se conecta a nada»

Causa del backend: el Store no hacía refresh inicial (corregido en `45a1420 fix(app): store
bootstrap refresh and session_current`, ya en `f1-nucleo`). Del lado UI se endureció:
`online` **solo** con snapshot (un `ping` correcto no basta), watchdog de 2,5 s → offline con
backoff, y —hallazgo de la validación en vivo— **si un bridge se cierra porque desapareció el
servidor, la UI lo toma como caída**: antes se quedaba «en línea» con los paneles muertos
porque el store no avisa por ese canal. Ahora el cierre dispara `noteOutage()` → offline →
reintento → `connectionEpoch` sube → los paneles se reenganchan.

### (c) «El backend todavía no expone session_start» era un mensaje engañoso

`optionalCommand` colapsaba **cualquier** error en `false`, y la UI traducía eso a «no
expone». Tres fallos encadenados:

1. El mensaje real de Tauri al faltar un command es `Command <nombre> not found` (p. ej.
   `Command session_start not found`); el patrón de detección (`/command not found/`) no lo
   reconocía, así que ni siquiera ese caso se clasificaba bien.
2. `startServer()` llamaba a `session_start` con **nombre vacío** cuando `session_current`
   no estaba disponible, y el error del contrato («invalid args») salía también como «no
   expone».
3. Un error de negocio (p. ej. la guarda del backend «no se permite iniciar la sesion default
   desde la GUI») se mostraba como «no expone», que es falso y confunde.

Arreglo: `CommandOutcome<T>` distingue **`missing`** (el command no está registrado) de
**`error`** (existe y falló: se muestra **su** mensaje), `resolveSessionName()` nunca manda
nombre vacío (usa `session_current`, y si no hay sesión el botón pasa a «Elegir sesión»),
`errorText()` prioriza el mensaje del backend y los errores de `__TAURI_INTERNALS__`
(página fuera de Tauri) se explican como «sin puente IPC» en vez de un TypeError crudo.

## 7ter. Validación en vivo (ventana real, backend real)

Con `pnpm tauri dev` y `HERDR_DESK_SESSION=herdr-desk-dev`, capturando la ventana con
CopyFromScreen y leyendo el pane por el API para no depender de la vista:

| Comprobación | Resultado |
|---|---|
| Arranque | `[herdr-desk] ready session=herdr-desk-dev protocol=19 startup_ms=402` + `stage=ui` |
| Conexión | píldora **«en línea · 5,7 ms»** (antes 37,1 ms con el server recién arrancado) |
| Snapshot | sidebar con **ESPACIOS 2** (spike-r3, docs-r11 con sus contadores) y AGENTES 0 |
| Terminal | paneles con frames reales (TUI de opencode y prompts de PowerShell pintados) |
| Input (R3) | `echo hd-ui-vivo` escrito en la ventana → el pane real responde `hd-ui-vivo` |
| Caída | server `stop` → píldora **«desconectado»**, franja con **el error de transporte real** del backend y los paneles en «Reconectando…» |
| Vuelta | server arriba → **«en línea · 5,7 ms»** sin franja y paneles con prompt **vivo** (sin «Retomar control») |
| Layout | tras el arreglo, la forma se mantiene en los tres ciclos de caída/vuelta |

Nota de coordinación: en la prueba en vivo, el respawn del backend **no** mandó frames por el
canal viejo, así que el reenganche lo resolvió la UI (timer de `bridge_reopen_grace_ms`,
3 s) en vez de duplicar attaches (evita el `terminal attach taken over`). Si el backend
prefiere ser él quien respawnee los bridges de la UI, basta con que reemita frames por el
mismo `bridge_id`/Channel: el panel vuelve a «open» solo y el timer se cancela.

## 8. Verificación de F1 (frontend)

```text
pnpm install            OK
pnpm format:check       OK
pnpm lint               OK (0 problemas)
pnpm check              svelte-check: 0 errores, 0 warnings
pnpm test               108 tests en 9 archivos (frames, errores, cliente + clasificación de
                        errores de command, codegen, reconcile, snapshot, árbol de splits,
                        parser de atajos, keymap)
pnpm e2e                68 pruebas en 9 specs (shell, shell F1 con regresión de layout,
                        terminal, foco, layout, acciones, atajos, sesiones, reconexión y
                        caída/vuelta del servidor)
pnpm build              dist/assets/index-*.js 491,46 kB min (134,73 kB gzip) + CSS 35,05 kB
                        → dentro del presupuesto (§4: ≤ 600 KB con xterm)
```

Mediciones de la corrida de F1:

| Métrica | Meta | Medido | Cómo |
|---|---|---|---|
| snapshot → cambio en el DOM | ≤ 50 ms | **6,7 ms** | e2e `shell.spec.ts` (se imprime `[hd-perf]`) |
| redimensionar ventana → `terminal_resize` | 1 llamada | **1 llamada** (cols/rows reales, debounce 60 ms) | e2e `terminal.spec.ts` |
| JS inicial | ≤ 600 KB min | **489,14 kB** (134,12 kB gzip) | `pnpm build` |
| RPC real (sandbox `herdr-desk-dev`) | — | ping 1,0 ms · snapshot 1,1 ms · `workspace.list` 0,9 ms · `tab.list` 1,1 ms · `layout.export` 1,0–2,6 ms | `f1-probe.py` contra el pipe de la sesión |
| Escritura real | — | `pane.split` 29,2 ms → 1→2 paneles; `pane.close` 819 ms → vuelve a 1 | `f1-probe.py` (sandbox queda limpio) |
| Bundle/webgl | WebGL en ≤ 8 panes | WebGL en los primeros 8 paneles visibles; LRU de 12 instancias | e2e `layout.spec.ts` + `pool.ts` |

## 9. Pendiente / deuda para F2–F3

- **Paleta de acciones** (F2) y **consola** (F3): hoy la paleta es un stub declarado.
- **Modo navegar** (F3): el keymap ya clasifica sus atajos; falta el modo y el `Hint`.
- **Arrastrar divisores** (T3.1) y **drag & drop de pestañas/paneles** (T3.2).
- **Config real** (F3): `settings.svelte.ts` usa `localStorage`; falta leer `config.toml`
  (`config_read`) y el codegen de settings (`scripts/gen-settings.mjs`).
- **Respawn de bridges del backend**: hoy la UI se reengancha sola si el respawn no manda
  frames; si el backend lo asume, hay que quitar el timer (o dejarlo como red de seguridad).
