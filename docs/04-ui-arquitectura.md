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
  main.ts               arranque: ajustes por defecto + config real asíncrona (T3.5) + temas +
                        keymap (con [keys] de config.toml, T3.6) + montaje + ui_ready
  App.svelte            composición del shell, efecto del árbol y manejador de teclado
  app.css               glass, layout del shell, botones, overlays
  lib/
    herdr/              contrato con el backend: client, errors, actions, types(.gen), methods.gen
    stores/             session (runas + reconciliación), layout (árbol), ui (efímero), settings
    terminal/           frames.ts (decoder/FrameWriter), pool.ts, TerminalView, TerminalScrollbar
    layout/             tree.ts (geometría y vecinos) + SplitTree.svelte + presets.ts (T3.3)
    keys/               parse.ts (sintaxis de herdr + captura), keymap.ts, config.ts ([keys] de
                        config.toml → overrides), customCommands.ts ([[keys.command]]), actions.ts,
                        Cheatsheet.svelte
    git/status.svelte.ts  rama y cambios sucios por espacio (T3.10)
    actions/flows.ts    flujos de UI (diálogos + comandos) usados por menús y atajos
    ui/                 primitivas glass: Dialog, Confirm, Prompt, Field, IconButton, Kbd, Toast, ContextMenu
    i18n/es.ts          todos los strings (decisión D3)
    settings/           settings.gen.ts (config por defecto, GENERADO por scripts/gen-settings.mjs),
                        spec.ts (contrato de payload + TOML), map.ts (config.toml ↔ ajustes)
    theme/tokens.css    tokens del §3 (glass, radios, tipografías, acentos)
    theme/              themes.ts (18 paletas transcritas de herdr), ansi.ts (ANSI-16 derivada),
                        apply.ts (tema efectivo + variables CSS), F3/T3.7
  features/             titlebar, sidebar, tabs, panes, statusbar, sessions, settings
                        (SettingsDialog.svelte + KeymapEditor.svelte, F3/T3.5-T3.6), worktrees
                        (WorktreesDialog.svelte, T3.4)
tests/e2e/              Playwright + mockIPC (arnés en src/lib/testing/harness.ts) — 21 specs
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
| `ui.svelte.ts` | qué está abierto (paleta, cheatsheet, contexto, sesiones, **ajustes**, **worktrees**), el **modo redimensionar** (`resizeMode`, T3.1), foco local, toasts y promesas de confirmación/prompt | un solo `ConfirmDialog`/`PromptDialog` montado; `{#key}` lo recrea en cada petición. `resizeMode` cuenta como «algo abierto» para el manejador global: mientras está, las flechas redimensionan y no llegan a la terminal |
| `settings.svelte.ts` | preferencias (ancho de sidebar, `collapsed_mode`, posición de la tab bar, `pane_borders/gaps`, `mouse_scroll_lines`, `webgl_max_panes`, LRU, `copy_on_select`, sincronizar foco, **`layout_presets`** y **`search_lines`**, T3.3/T3.9) **y `configEntries`** (las entradas de `config.toml`, que alimentan el keymap en T3.6) | **ya no usa `localStorage`** (F3/T3.5): al arrancar, `init()` pide `config_read` + `gui_settings_read` y aplica los valores efectivos de `config.toml` más las claves exclusivas de la GUI; si un command falta, se sigue con los defaults. `set()` decide el destino: clave de herdr → `config_write` (una clave por escritura), clave GUI → `settings.json` con debounce de 400 ms. `applyConfigEntries()` reaplica la config tras guardar en el formulario; los fallos de persistencia salen por `onPersistError` (toast), no por excepción |
| `git/status.svelte.ts` | rama y nº de cambios sucios por espacio (T3.10) | no es un store del snapshot: se refresca **atado a la revisión** con un tope de 3 s por espacio y sin peticiones solapadas; si el command `git_status` no está, `infoOf()` devuelve `null` y la sidebar no pinta tokens |

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
- **F3/T3.6**: `keymap.load(overrides?)` acepta `KeymapOverrides` (`prefix`, `bindings`,
  `indexed`), que es lo que traduce `lib/keys/config.ts` desde `[keys]` de `config.toml`, y
  `parse.ts` añade el camino inverso: `serializeChord()` (chord → sintaxis de herdr) y
  `bindingFromEvent()` (evento → binding, con `prefix+` delante si el llamador ya consumió la
  tecla de prefix). Ver §6quinquies(b).

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

## 6bis. Componentes UI reutilizables: tarjetas desplegables y presets de animación

### `lib/ui/motion.ts` — presets de animación

Un único sitio para springs y easings, para que los componentes compartan el mismo «feel».
Nada de dependencias nuevas: solo `svelte/motion`.

- `SPRINGS.card | panel | snap` y `springFromPhysics(k, c, m)`.
- `springOptions()`, `createSpring()`, `setSpringTarget(spring, target, reduced)` (salta de golpe
  con movimiento reducido y devuelve la promesa de asentamiento).
- `EASINGS`, `DURATIONS` y `cssTransition()` para la parte CSS.
- `prefersReducedMotionNow()`: consulta viva de `prefers-reduced-motion` (con guarda para
  entornos sin `matchMedia`).

**Unidades (esto costó un fallo real).** La clase `Spring` integra con un paso `dt` normalizado a
frames (`dt = 1` a 60 fps; el tiempo transcurrido se acota a 1/30 s, así que `dt ∈ [1, 2]`):

```
k_svelte = k · dt² / m        d_svelte = c · dt / m        (dt = 1/60)
```

El spring de referencia del encargo (**600/50/1**) es exactamente
`{ stiffness: 0.1667, damping: 0.8333 }`: se asienta en ~400 ms y sin rebote. Copiar los números
«de catálogo» no funciona: `k = 600` se recortaría a 1, y valores intermedios (el primer intento
fue `k = 1, d = 0.2`) quedan al borde de la estabilidad y **con `dt > 1` se desbocan** (rebote del
80-100 % y oscilación que no se asienta). Medido en `motion.test.ts`, que fija tiempos, rebote y
estabilidad con `dt = 1.5` y `2` para los tres presets:

| Preset | Física | k / d | Asienta (dt=1) | Rebote |
|---|---|---|---|---|
| `card` | 600/50/1 | 0.1667 / 0.8333 | 400 ms | 0 % |
| `panel` | 400/40/1 | 0.1111 / 0.6667 | 467 ms | 0 % |
| `snap` | 900/45/1 | 0.2500 / 0.7500 | 200 ms | 0 % |

### `lib/ui/CardSplitAccordion.svelte` — porte del `CardSplitAccordian` de watermelon.sh

El original es React (registry de watermelon.sh: `useState`, `motion/react`, `lucide-react`,
`react-icons`, `react-use-measure`, clases Tailwind). Se portó a Svelte 5 **sin dependencias
nuevas** (`pnpm-lock.yaml` intacto) y sin Tailwind:

- **`cardSplit.ts`**: tipos (`AccordionItem`), geometría pura `itemChrome(index, total, openIndex)`
  y los items por defecto (los mismos temas del original, en español vía `i18n/es.ts`).
- **`CardSplitAccordionItem.svelte`**: una fila = botón (cabecera) + panel. Su `Spring` se crea en
  la inicialización (identidad estable) y el objetivo es `bind:clientHeight` del contenido; el
  chevron gira con una transición CSS del mismo preset. La fila no comparte estado con la lista.
- **`CardSplitAccordion.svelte`**: la lista. API data-driven `items` (`id`, `title`, `icon` como
  snippet o `iconKey` integrado, `content`), `openId` bindable, `onOpenChange`, `maxWidth`,
  `class`, `testId`. Un solo item abierto; el clic en el abierto lo cierra. Reexporta
  `itemChrome` y `DEFAULT_ITEMS` para testes y consumidores.
- **Iconos**: `@lucide/svelte` (Layers, Hand, Send, Timer, ChevronDown) y un SVG inline propio
  para el cursor (el original usaba `react-icons`).
- **Accesibilidad** (el original no la traía): botón real, `aria-expanded`, `aria-controls`,
  panel `role="region"` + `aria-labelledby`, navegación con ↑/↓/Inicio/Fin con envoltura,
  `aria-hidden` al cerrar y foco visible con token `--accent`.
- **Estilos**: tokens existentes (`--glass-border`, `--panel-bg-solid`, `--accent`, `--text-dim`,
  `--space-*`, `--t-med`, `--ease`, `--shadow-lg`); radio 20 px y margen 10 px del abierto, como el
  original; `@media (prefers-reduced-motion: reduce)` corta las transiciones CSS.
- **No está cableado al shell** (no aporta al layout actual): queda listo para usar.

**Tests (29 nuevos, 137 en total).** `motion.test.ts` mide los presets con la recurrencia exacta
de `svelte/motion` copiada en el test y valida la conversión de unidades, el salto instantáneo, el
asentamiento y la estabilidad. `CardSplitAccordion.test.ts` monta el componente de verdad
(`mount` + `flushSync`, sin librerías de testing añadidas) en jsdom con stubs mínimos:
`matchMedia` como `EventTarget` real (Svelte propaga el evento: con un objeto plano reventaba),
`ResizeObserver`, un `clientHeight` simulado y un `requestAnimationFrame` determinista (el de jsdom
no es puntual y congelaba los springs). Dos ajustes de configuración, ninguno con dependencias
nuevas: `resolve.conditions: ['browser']` (sin él `svelte` resuelve al build de servidor y
`mount()` falla con `lifecycle_function_unavailable`) y `ssr.resolve.conditions: ['browser']`
(sin él `esm-env` da `BROWSER = false` y el bucle de rAF de svelte/motion es un noop: ningún spring
se mueve).

**Dos trampas de Svelte 5 + Spring, ambas con test de regresión:**

1. Hay que leer `measured[key]` **dentro** del `$effect`: leer solo el objeto no registra
   dependencia y la medición de `bind:clientHeight` nunca despierta al efecto.
2. `spring.set()` lee internamente `spring.current`, así que sin `untrack` el efecto se reejecuta
   en cada tick del spring, lo reinicia y el valor oscila sin asentarse.

## 6ter. Tipografía de la terminal y menú de contexto nativo (reporte en vivo)

### (a) La terminal no usaba el token `--font-mono`

xterm.js **no resuelve variables CSS**: `new Terminal({ fontFamily: 'var(--font-mono)' })` es una
lista de familias inválida para el canvas, así que el WebView2 caía en su monoespaciada por
defecto (y el token de `tokens.css` nunca llegaba). Además el `fontSize: 13` estaba a pelo.

Solución (`lib/terminal/font.ts`, `lib/terminal/pool.ts`, `main.ts`):

- **`gui_defaults`** (backend, `docs/03`): devuelve la familia resuelta en la máquina por cascada
  (`Cascadia Code` → `Cascadia Mono` → `Consolas`), el tamaño (`terminal_font_size_px`) y el
  interlineado. El cliente lo pide al arrancar; si el command todavía no existe (`kind: 'missing'`),
  falla o revienta, se aplica el **fallback local** con la misma pila y los mismos valores, así que
  la app nunca se rompe ni se queda sin fuente.
- **Pila real**: `'Cascadia Code', 'Cascadia Mono', Consolas, monospace` (la familia del backend va
  delante; el resto son red de seguridad y no se repiten). Nada de `var(...)`.
- **Tamaño e interlineado juntos**: `terminalOptions(font)` deriva las tres opciones del mismo
  preset (13 px / 1.0, los valores del backend).
- **Celdas cuadradas**: al llegar el preset se repinta lo ya abierto (`pool.applyFont`) y, con las
  fuentes del sistema cargadas (`whenFontsReady()` → `document.fonts.ready`), se rehace el `fit` de
  todas las instancias (`pool.refitAll`) avisando del nuevo tamaño al bridge si cambió. Sin esto,
  xterm mide la celda con la fuente de reserva y la rejilla queda descuadrada.
- La tipografía de la GUI (**Geist**) no cambia.

Medido en navegador real (`tests/e2e/font-menu.spec.ts`, imprime `[hd-font]`):

```json
{"fontFamily":"'Cascadia Code', 'Cascadia Mono', Consolas, monospace","fontSize":13,"lineHeight":1,
 "cellWidth":7,"anchos":[{"familia":"'Cascadia Code'","ancho":7.62,"disponible":true},
                          {"familia":"'Cascadia Mono'","ancho":7.62,"disponible":true},
                          {"familia":"Consolas","ancho":7.15,"disponible":true},
                          {"familia":"monospace","ancho":7.15,"disponible":true}]}
```

La primera familia de la pila existe en la máquina (es la que pinta el navegador) y el ancho de
celda que calcula xterm cae en su rango.

### (b) El menú de contexto del WebView2

Los menús propios (terminal, paneles, pestañas, espacios) se abrían, pero el nativo seguía
apareciendo en cualquier otra zona: `openPaneMenu`/`openTabMenu`/`openWorkspaceMenu` no llamaban a
`preventDefault`.

- **Supresión global** (`lib/ui/context-menu.ts`, instalada en el `onMount` de `App.svelte`): un
  único listener en fase de **captura** sobre `window` que solo hace `preventDefault`. Corre antes
  que los handlers propios y no corta la propagación, así que los menús de la app se abren igual.
- **`preventDefault` también en los tres handlers** de `flows.ts` (defensa en profundidad).
- **No se toca** `mousedown`/`mouseup`/`auxclick`/`selectstart`: el pegado con botón central, la
  selección de texto del terminal y los atajos `Ctrl+C`/`Ctrl+V` siguen igual.

Verificado en la ventana real (sesión `herdr-desk-dev`): clic derecho dentro de un panel → menú
propio con «Copiar/Pegar» (estilo glass, en español) y sin menú del navegador; clic derecho en la
barra de estado (zona sin menú propio) → **ningún** menú.

### Tests

28 unit nuevos (`font.test.ts` 15, `pool-font.test.ts` 5, `context-menu.test.ts` 8) y 2 e2e
(`font-menu.spec.ts`). El arnés e2e responde a `gui_defaults` con el payload real del backend.

De paso se arreglaron dos carreras preexistentes de `reconnect.spec.ts` (no relacionadas con este
cambio): el estado «reintentando» dura ~250 ms y el polling lo perdía, así que ahora se comprueba
sobre una historia del DOM registrada desde el arranque; y el conteo exacto de `terminal_open`
tras una caída competía con el temporizador de gracia (se fija la gracia larga en el test y se
acota el conteo a 1–2: sin tormenta de reattaches).

### Pendiente en el plan maestro (no editado)

El plan asume el enfoque roto en dos sitios: **línea 143** (`--font-mono: "JetBrains Mono Variable",
"Cascadia Mono", monospace;` como fuente de la terminal) y **línea 588**
(`new Terminal({ …, fontFamily: 'var(--font-mono)', … })`). Además la tabla del §5 no incluye
`gui_defaults` (ya documentado por el backend en `docs/03`). Lo anota el usuario.

## 6quinquies. Configuración real: formulario y editor de atajos (F3 / T3.5, T3.6)

Dos tareas, una sola superficie: el diálogo `features/settings/SettingsDialog.svelte` con dos
pestañas («Configuración» y «Atajos»), abierto con `prefix+s` (acción `settings` →
`ui.openSettings()`, cerrado con `Esc` desde `App.svelte`).

### (a) Formulario de configuración (T3.5)

- **Secciones y claves**: no hay lista escrita a mano. Al abrir, `config_default()` trae las
  secciones de `herdr --default-config` (22 secciones, 120 claves) y `payloadToSections()` las
  tipa; si el command no está, se cae a la copia estática `SETTINGS_SECTIONS` de
  `lib/settings/settings.gen.ts` (generada por `pnpm gen`), así que el formulario funciona
  aunque el backend no exista.
- **Valores efectivos**: `config_read()` da `entries` (`path`, `value` TOML, `origin`);
  `entriesByPath()` los indexa y cada campo se pinta con `displayValue()` según el tipo
  declarado. Nada de lo que se ve es un valor inventado por la GUI.
- **Edición y guardado**: los cambios van a un borrador `path → value` (borrar = `null`); al
  guardar se manda **un único `config_write` con todos los cambios**, que por debajo hace
  check con un temporal, backup, escritura con `toml_edit` y `reload_config` (ver `docs/03`).
  Tras guardar, un `config_read` refresca los valores y `settings.applyConfigEntries()` +
  `applyTheme()` los aplican en caliente. `rejected` y `rolled_back` se muestran como aviso,
  igual que `reload.skipped`/`failed`.
- **Filtro y read-only**: la búsqueda case-insensitive matchea path y descripción; la sección
  `[remote]` se pinta pero no se edita (`isReadOnlySection`).
- **Claves desconocidas**: las entradas de `config_read` cuyo path no está en los defaults se
  listan aparte y son editables (así no se pierde nada que el usuario tenga a mano).
- **Sección GUI** (`settings-gui`), la última: cristal (`auto`/`full`/`off`), sincronizar foco
  con la TUI, WebGL, máximo de panes con WebGL, LRU de terminales, tiempos de gracia de
  cierre/reapertura del bridge y duración del toast. Son las 9 claves de `GUI_KEYS` de `lib/settings/map.ts`:
  **no** van a `config.toml` (el server las avisaría como `unknown_section`) sino a
  `%APPDATA%\herdr-desk\settings.json` mediante `gui_settings_write` (ver `docs/03`).
- **Preferencias al arrancar**: `main.ts` llama a `settings.init()` (no bloquea el montaje) y
  cuando resuelve reaplica tema, sidebar y —ya con los atajos— el keymap.

### (b) Editor de atajos (T3.6)

- **Origen**: `KeymapEditor.svelte` lee `config_read()` y traduce las claves `keys.*` de
  `config.toml` a `KeymapOverrides` con `keymapOverridesFromEntries()`
  (`lib/keys/config.ts`): `keys.prefix`, `keys.<acción>` y `keys.indexed.{tabs,workspaces,agents}`.
  Las tablas `[[keys.command]]` se ignoran (no son atajos) y un valor no-string se descarta.
  Los **defaults son los de herdr** (`DEFAULT_KEYBINDINGS`): `[keys]` sobrescribe, no reemplaza.
- **Captura**: `bindingFromEvent()` (nuevo en `parse.ts`, con `serializeChord()` y el mapa
  `KEY_TO_NAME` → sintaxis de herdr: `minus`, `pageup`, `up`…) convierte el `KeyboardEvent` en
  `ctrl+shift+n`. Si el primer chord pulsado es la tecla de prefix, se **arma** y espera la
  acción: el resultado es `prefix+…`. `Esc` cancela. El listener va en fase de captura
  (`window.addEventListener('keydown', onKey, true)`) para ganarle al manejador global de atajos.
- **Ámbitos y conflictos**: cada fila muestra su ámbito real (`prefix` / `direct` / `navigate`,
  calculado con una instancia de `Keymap` sobre el borrador) y una etiqueta «Conflicto» si
  `map.conflicts()` la marca. `dirtyCount` cuenta qué cambia y habilita «Guardar».
- **Guardado**: un `config_write` con las claves `keys.*` modificadas, y después
  `keymap.load(currentOverrides())` — los atajos nuevos rigen **sin reiniciar**.
- **Restablecer**: pide confirmación y llama a `config_reset_keys()` (envuelve
  `herdr config reset-keys`, que ya hace backup); si el exit code no es 0 muestra su salida, y
  si va bien recarga con `keymap.load()` sin overrides.
- **Arranque**: `main.ts` pasa `keymapOverridesFromEntries(settings.configEntries)` a
  `keymap.load()`, de modo que `[keys]` de `config.toml` manda sobre los defaults del motor
  desde el primer arranque.

## 6sexies. Temas en vivo (F3 / T3.7)

El tema dejó de ser una constante de CSS: ahora sale de `[theme]` de `config.toml`, se aplica
como variables CSS **y** como paleta ANSI de xterm, y Mica acompaña al modo claro/oscuro.

- **Paletas transcritas, no inventadas** (`lib/theme/themes.ts`): los **18** temas de herdr
  (`catppuccin`, `catppuccin-latte`, `terminal`, `tokyo-night`, `tokyo-night-day`, `dracula`,
  `nord`, `gruvbox`, `gruvbox-light`, `one-dark`, `one-light`, `solarized`, `solarized-light`,
  `kanagawa`, `kanagawa-lotus`, `rose-pine`, `rose-pine-dawn`, `vesper`) con sus 16 tokens,
  **transcritos de `herdr@d78e3d3b5126` `src/app/state.rs`** (Apache-2.0, atribución en
  `THIRD-PARTY-NOTICES.md`, T5.6). `LIGHT_THEMES` marca los 7 claros.
  - **Desviación anotada**: el plan hablaba de 17 temas; hay **18** porque herdr incluye
    `one-light` además de los del plan.
  - El tema `terminal` de herdr usa colores ANSI con nombre de ratatui; aquí se resuelve a los
    fallbacks de `RESET_FALLBACK` (la GUI no tiene terminal host que heredar).
- **ANSI derivado** (`lib/theme/ansi.ts`): herdr **no** define una paleta ANSI por tema —su
  terminal hereda la del terminal exterior por OSC 10/11/4—, así que aquí se **deriva** de los
  tokens del tema activo y los `bright` se aclaran hacia su color de texto. Es la única parte
  del tema que no viene de herdr, y está anotado como tal en el propio archivo.
- **Aplicación** (`lib/theme/apply.ts`): `applyThemeToDocument()` resuelve el tema efectivo
  (`resolveThemeName`: con `auto_switch` gana `theme_dark_name`/`theme_light_name` según
  `prefers-color-scheme`; si no, `theme_name`; nombre desconocido → `catppuccin`), superpone
  `[theme.custom]` (`parseCssColor` acepta `#rgb`/`#rrggbb`, `rgb()` y los nombres de herdr;
  `reset`/`default` = quitar), deja que `ui.accent` legacy mande si no hay acento propio, y
  escribe ~18 variables CSS + las 16 ANSI. Deja `data-theme` y `data-theme-name` en `<html>`.
- **Terminal**: `pool.applyXtermTheme()` relee esas variables y las pone en
  `terminal.options.theme` de cada xterm vivo, así que el cambio de tema se ve sin reiniciar.
- **Mica**: `App.svelte` llama a `setMica(dark)` (command `set_mica`, ver `docs/03`) cuando
  cambia el tema, y tolera el fallo. `auto_switch` se reevalúa con el evento `change` de
  `prefers-color-scheme` registrado en `onMount`.
- **Selector**: la primera sección del formulario es el tema —`select` con los 18 nombres
  (`THEME_NAMES`), interruptor de `auto_switch` y, cuando está activo, los select de
  `theme_dark_name` y `theme_light_name`. `settings.applyTheme()` es el punto único: pone
  `data-glass`/`data-mica`/`lang` y delega la paleta en `applyThemeToDocument()`; `resolvedTheme`
  expone el nombre aplicado.
- Tests: 9 en `lib/theme/theme.test.ts` (los 18 temas con tokens hex, manual vs `auto_switch`,
  nombre desconocido, overrides de `[theme.custom]`, parseo de colores, derivación de las 16
  claves con `bright` aclarados, escritura de la paleta y `data-theme`, y precedencia de
  `ui.accent` legacy).

## 6septies. El resto de F3 en la UI (T3.1-T3.4, T3.8-T3.10)

Todo lo que falta para cerrar F3 del lado del cliente. Los commands de backend que usan ya
estaban (ver `docs/03`); aquí está cómo los llama la UI y qué se degrada cuando faltan.

### (a) Redimensionar, intercambiar y mover paneles (T3.1)

- **Modo redimensionar** (`ui.resizeMode`): se activa desde el menú del panel; mientras está
  activo, las cuatro flechas mueven el divisor del panel enfocado (`pane.resize` con
  `amount: 0.05` y `direction` `left`/`right`/`up`/`down`), y `Esc` lo desactiva. El modo se ve
  en la titlebar con un chip (`data-testid="resize-chip"`, el mismo estilo que el chip `PREFIX`),
  y el teclado global lo trata como diálogo abierto: no se lo come la terminal.
- **Intercambio por arrastre**: el header de `PaneFrame.svelte` es `draggable` y usa el tipo
  MIME propio `application/x-herdr-pane`; el `drop` sobre otro panel llama a `pane.swap`
  (`source_pane_id`/`target_pane_id`). El divisor redimensionable ya existía (`split-drag`), así
  que esta tarea no lo reimplementa.
- **Mover un panel** (`pane.move`) a tres destinos: una pestaña existente, una pestaña nueva o
  un espacio nuevo (`flows.movePane()` pide el destino con un diálogo).

### (b) Reordenar pestañas y espacios por arrastre (T3.2)

`moveTabTo`/`moveWorkspaceTo` envían el **índice destino absoluto** (`tab.move` y el equivalente
de workspace). El drop lo calcula `TabBar.svelte`/`Sidebar.svelte` sobre la posición del puntero,
no por exchanging de objetos: el store sigue siendo la autoridad.

### (c) Presets de layout (T3.3)

- Se guardan en los ajustes de la GUI (`layout_presets`, clave de `settings.json`), no en
  `config.toml`: son un árbol `LayoutNode`, no un valor TOML.
- `lib/layout/presets.ts` valida antes de aplicar: `isLayoutNode()` acepta hoja `pane` y
  `split` con `direction` `right`/`down` y `ratio` en `[0,1]`, recursivo; `sanitizePresetName()`
  limita el nombre a 40 caracteres de `[\w .-]`. Aplicar un preset corrupto avisa en vez de
  mandarlo al server.
- `flows.saveLayoutPreset()` exporta el árbol de la pestaña visible (`layout.export`), pide
  nombre y lo guarda; `applyLayoutPreset()` valida y llama a `layout.apply` con foco; también
  hay borrado. Entradas en la paleta: guardar/aplicar/quitar.

### (d) Worktrees (T3.4, UI)

`features/worktrees/WorktreesDialog.svelte` sobre los commands que ya expone el backend
(`worktree_list`/`worktree_create`/`worktree_open`/`worktree_remove`). Lista el repo y sus
checkouts, informa de los **prunable** (los que se pueden borrar) y pide confirmación doble en
el borrado (el propio command exige `confirm`). Se abre desde la paleta («worktrees del espacio»)
o el menú del espacio.

### (e) Comandos personalizados de `[[keys.command]]` (T3.8)

- `config_read` entrega esa tabla como texto TOML bajo `keys.command`;
  `lib/keys/customCommands.ts` la parsea al contrato del motor (`key`, `type`
  `shell`/`pane`/`popup`, `command`, `width`, `height`) respetando comillas y comentarios.
- `keymap.load()` convierte cada comando atado a una tecla en la acción `command:<índice>`, con
  su ámbito según lleve o no `prefix`. Aparece en el cheatsheet y en el editor de atajos.
- Ejecución (`flows.runCustomCommand`): `shell` → command `run_shell_command` **detached y sin
  consola** (excepción documentada del §7: es configuración del propio usuario, no una
  superlista de la app); `pane`/`popup` → `pane.split` del panel enfocado. Si el command no
  existe, aviso «no disponible» en vez de error.

### (f) Salida del panel: buscar, editar, esperar (T3.9)

- `searchPaneOutput()` → `pane.read` de las últimas `search_lines` y visor de texto.
- `editScrollback()` → `pane.read` (mínimo 500 líneas) → `write_scratch_file` → se abre con el
  plugin `opener`. El backend sanea el nombre del temporal (solo alfanumérico, `-` y `_`, 60
  chars) y devuelve la ruta.
- `waitPaneOutput()` → `pane.wait_for_output` con `substring` o `re:<regex>` y timeout de 60 s
  (`source: recent_unwrapped`, `strip_ansi: true`).

### (g) Estado git por espacio (T3.10)

- Backend: `git_status(cwd)` parsea `git status --porcelain=v2 --branch` por lista blanca (con
  `run_whitelisted_in`, variante nueva con directorio de trabajo) y devuelve
  `{ branch, dirty, ahead, behind }`; sin watcher de archivos.
- Frontend: `lib/git/status.svelte.ts` lo refresca **atado a las revisiones del snapshot**, con
  tope de una vez cada 3 s por espacio y sin peticiones solapadas. La sidebar pinta la rama y un
  contador de cambios sucios. Si el command falta, los tokens no aparecen.

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

## 7quater. Ronda de fallos en vivo (5 reportes) — diagnóstico y arreglo

Cinco fallos reportados sobre la app viva (`herdr-desk-dev`, ventana real). Lo
que sigue es el diagnóstico, la causa raíz y el arreglo de cada uno, más la
verificación en vivo (capturas de la ventana + API del pane como fuente de
verdad, que no depende de la vista).

### (a) La terminal no llenaba el marco al agrandar la ventana

`.terminal-host` es un ítem flex de `.pane-frame__body` (`display: flex`) y no
tenía `flex` ni tamaño propios: se dimensionaba **por contenido**, así que al
redimensionar la ventana el marco crecía y la terminal no. Además llevaba
padding asimétrico (`var(--space-2) 0 var(--space-2) var(--space-3)`) con
`overflow: hidden`, que recorta celdas por la izquierda.

- Arreglo: `.terminal-host` ocupa el 100 % × 100 % del cuerpo (`flex: 1 1 auto;
  inline-size: 100%; block-size: 100%; min-inline-size: 0; min-block-size: 0`) y
  **padding 0** (el aire lo pone el `padding` del propio cuerpo del marco, que
  forma parte del contenedor y no recorta celdas). El `ResizeObserver` del pool
  re-hace el `fit` de xterm y el bridge recibe `terminal_resize` cuando cambian
  las cols/rows reales (debounce 60 ms, ya existente).
- Test: `src/lib/terminal/terminal-host-size.test.ts` fija el contrato de CSS
  (host 100 %×100 % del cuerpo del marco, sin padding asimétrico, y `.terminal-surface`
  llenando el host).

### (b) «Retomar control»: fuera; la recuperación es automática y silenciosa

Se elimina el botón manual y los tres overlays que lo ofrecían
(`reconnecting`, `closed` y `error`) en `TerminalView.svelte`, y la clave
`retake` de `i18n/es.ts`. Si el bridge vuelve, el panel pasa a `open` sin pedir
nada; si no vuelve, el panel muestra **el estado real del error** y el reenganche
automático se queda con la temporización del pool (`bridge_reopen_grace_ms`).
Los tests de `terminal.spec.ts` se reescriben para el contrato «sin botón
manual».

### (c) Cerrar un panel dejaba el marco en pantalla con overlay de desconectado

Dos causas, ambas de frontend:

1. **Render sin clave**: `SplitTree.svelte` montaba `<PaneFrame paneId=…>` sin
   `{#key}`. Cuando el hueco de un panel cerrado lo ocupaba otro pane, Svelte
   **reutilizaba la instancia**: el terminal y el bridge seguían siendo los del
   pane viejo (ya cerrado en el server) con el `paneId` nuevo en el árbol. De ahí
   el marco fantasma con «La terminal se desconectó». Arreglo: `{#key node.paneId}`
   → al cambiar el pane de un hueco, la instancia se destruye (con `pool.release`:
   bridge cerrado y terminal soltada) y se monta una nueva.
2. **Export de layout viejo**: ver (f). El árbol podía quedarse con el layout
   anterior y mostrar un pane que ya no existe.

- Tests: `src/lib/layout/SplitTree.test.ts` (jsdom + xterm real) fija que al
  cerrarse un pane desaparece su marco, que su entrada del pool se libera y que
  el hueco reutilizado monta una instancia NUEVA (el test falla sin el `{#key}`).

### (d) Los botones del header de los paneles no respondían

`PaneFrame.svelte` hacía `focus()` en **cada** `pointerdown` del `<article>`,
incluidos los botones del header; si ese cambio de foco re-clavaba el árbol de
paneles entre `pointerdown` y `click`, el botón nunca recibía el clic.

- Arreglo 1 (acotar): el `pointerdown` del marco ya no toca el foco si el evento
  nace en un control interactivo (`closest('button, a, input, textarea, select')`);
  el clic en el **cuerpo** o en el **título** sí enfoca el panel (sigue pasando el
  e2e de foco).
- Arreglo 2 (estabilizar): los nodos del árbol van estabilizados por clave
  (`{#key node.paneId}`, ver (c)), así un clic siempre se completa.
- Arreglo 3 (menú): el botón «…» abría y cerraba el menú en el mismo gesto porque
  el `click` subía hasta el `window` de `ContextMenu` —que cierra el menú con
  cualquier clic—. Los tres abridores del menú (`flows.openPaneMenu`,
  `openTabMenu`, `openWorkspaceMenu`) ahora hacen `stopPropagation()`. Además el
  menú se **corre hacia dentro** si el clic fue pegado al borde (antes se recortaba
  contra la ventana y no se leían las etiquetas).
- Tests: `src/features/panes/PaneFrame.test.ts` (jsdom) hace clic en los cinco
  botones y comprueba su acción (`pane.split` con su dirección, `pane.zoom`,
  el menú, `pane.close` con confirmación) y que el `pointerdown` de un botón no
  cambia el foco local; `src/lib/ui/ContextMenu.test.ts` fija el corrimiento;
  e2e nuevo en `actions.spec.ts` («el botón «…» del panel abre el menú con un
  clic izquierdo y se queda abierto», el caso que el e2e no cubría porque sólo
  usaba clic derecho).

### (e) Control de espacios: cambio de sesión y de workspace

`session.connect()` re-suscribía al store pero **no limpiaba** el estado de la
sesión anterior: snapshot, workspaces, tabs, panes, agentes, layouts, foco,
árbol de layout, terminales y bridges. De ahí paneles de la sesión vieja con
terminales «desconectados».

- `flows.switchSession(name)` (nuevo, y el que usa `SessionsDialog`) ordena el
  cambio: `pool.disposeAll()` (bridges y terminales fuera) → `layout.reset()`
  (árbol a null; el área queda en «sin panel») → `ui.resetSessionState()` (foco
  local, historial de paneles y zoom) → `session.switchTo(name)` (nombre +
  `reset()` + `connect()`).
- `session.reset()` amplía lo que descarta (versión, protocolo, último mensaje,
  error de arranque) e **invalida la suscripción anterior**.
- **Una sola suscripción viva**: `connect()` toma un token de suscripción y el
  callback descarta todo mensaje que llegue por un canal viejo (el backend además
  rota la suscripción; esto es la red de seguridad del lado UI).
- Verificación: e2e `tests/e2e/session-switch.spec.ts` (cambio de sesión sin
  restos + estado nuevo encima + un solo bridge del pane nuevo) y
  `src/lib/actions/switch-session.test.ts` (unidad: nada del estado anterior, y
  los mensajes del canal viejo se ignoran).

### (f) El snapshot del store se quedaba congelado (causa raíz encontrada en vivo)

Verificado en vivo: con la app abierta, un `pane.split` hecho **por el API**
creaba el pane en el server pero la UI no lo veía (sidebar «spike-r3 (5)» contra
9 panes reales) durante minutos; al recargar la página sí aparecía. Es decir: el
estado se refrescaba al arrancar/reconectar, pero **no durante la operación
normal**.

Causa (backend, fuera del alcance de esta tarea de frontend): en
`crates/herdr-core/src/events.rs`, `run_with` llama `kick.notify_one()` **sólo
cuando la conexión de eventos termina** (o falla), no por evento recibido; el
bucle que consume `ev_tx` en `lib.rs` sólo traza. Como la conexión L se mantiene
abierta, el store no vuelve a hacer fetch y su `watch` no emite: el canal
`store_subscribe` no manda nada nuevo. El comentario del propio `lib.rs` («L:
eventos globales → kick del store (coalescing)») describe el diseño; falta el
kick por evento (p. ej. `store_kick.notify_one()` en el consumidor de `ev_rx`,
que coalesce solo, o dentro de `subscribe_once` al reenviar cada evento).

Mitigación en el frontend (esta tarea): el **latido** que ya existía para
detectar la caída del server hace ahora también de catch-up — si el store no ha
empujado nada en el último intervalo (`HEARTBEAT_MS`, 5 s), pide
`session.snapshot` por RPC (~1 ms) y lo aplica. Y cada acción de la GUI
(split, cierre, zoom, rename, tabs, espacios) refresca el snapshot al terminar,
así la acción se ve reflejada de inmediato en vez de esperar al siguiente
latido. Con el canal del store funcionando, el catch-up no hace peticiones
(el push reciente lo cancela).

- Test: `src/lib/stores/session-refresh.test.ts` (aplica el snapshot; el latido
  pide el snapshot cuando el store está callado y **no** lo pide si acaba de
  empujar).

**Cerrado en backend (F1, commit `e303f55`)**: el kick por evento ya está en
`crates/herdr-core/src/events.rs` y la ráfaga coalesce (50 eventos → 2 refrescos,
tests de regresión incluidos). El latido de catch-up del frontend deja de ser
necesario y se retira en la tanda siguiente; el store queda como única fuente de
verdad y el ping de salud se mantiene solo para detectar la caída del server.
Ya se retiró: commit `a27facb` (el catch-up y su test `session-refresh.test.ts`
desaparecieron; ahora es `session-heartbeat.test.ts` quien comprueba que el latido
hace **cero** llamadas a `session.snapshot`).

## 6quater. Panel de agentes y estados (F2a / T2.1, T2.4)

- **Orden y filtro** (`36b7bcb`, `ddbeab9`): el panel de agentes agrupa por
  workspace/tab con orden estable (persistido) y filtro por texto/estado; las
  filas salen de la config (`rows_by_agent`, `$name`) y respetan el `row_gap`.
- **Glow por estado** (`051e361`): cada marco lleva un rim del color del estado
  (`working`/`blocked`/`done`/`unknown`) mediante `::after` con `data-status`, sin
  `box-shadow` ni `filter` animados y con `prefers-reduced-motion` respetado;
  `unknown` deja el rim en opacidad 0.
- **Rollups** (`AgentRollup.svelte`): punto + conteo por estado, peor estado
  calculado si falta el del backend, sin chip cuando no hay bloqueados y sin
  `backdrop-filter` (rendimiento en listas largas).
- **Conteo de bloqueados → overlay** (`src/lib/agents/taskbarOverlay.ts`): el
  frontend envía `taskbar_overlay` con el número de bloqueados (0 → `null` para
  quitar la insignia) y no repite la llamada si el valor no cambia; si el command
  no existe en el backend avisa una sola vez.
- Tokens: `$name` (nombre del agente) y `state_labels` (rótulo por estado) para no
  duplicar número y etiqueta («1 bloqueado», singular incluido).
- Tests: `paneGlow.test.ts` (6), `AgentRollup.test.ts` (4),
  `taskbarOverlay.test.ts` (3), `agents.spec.ts` (6) y `agent-state.spec.ts` (3) en
  e2e; suite completa 81 tests en 13 specs. Build 506,82 kB min (139,60 gzip),
  dentro del presupuesto de ≤ 600 KB.


### Validación en vivo de esta ronda (ventana real + API del pane)

La ventana se captura con `CopyFromScreen` y cada acción se contrasta contra la
API del pane (`pane.list`, `layout.export`), que no depende de la vista. El
usuario estaba trabajando en la misma máquina y la ventana se movía entre
capturas, así que los clics se hacen calculando la posición desde el rect vivo y
sólo si el GUI tiene el foco (si otra ventana está encima, se aborta el clic en
vez de arriesgar un clic en la ventana equivocada).

| Comprobación | Resultado |
|---|---|
| Terminal a todo el marco | llena el marco sin hueco lateral, en la ventana de arranque (1296×809) y tras el redimensionado del usuario (1671×809 → 1296×809) |
| Sin «Retomar control» | el botón no aparece en ningún estado; el panel muestra el motivo real del cierre |
| `◫` dividir a la derecha | **crea pane de verdad**: 8→9 paneles (y 3→4 en la segunda tanda), con el marco nuevo en pantalla |
| `⬓` dividir abajo / `⤢` zoom | zoom leído por `layout.export` antes/después: `false` → `true` → `false`; el área queda con un solo panel y el indicador «zoom» en la barra de estado |
| `…` menú | el menú se abre con clic izquierdo y **se queda abierto** (5 entradas: Dividir, Dividir, Alternar, Renombrar, Cerrar) |
| `×` cerrar | cubierto por e2e (clic real + confirmación) y por el cierre en vivo por API: el marco del pane cerrado **desaparece**, el contador baja (5→4) y no queda ningún panel huérfano ni overlay de desconectado |
| Catch-up del snapshot | `pane.split` por API con la app abierta y **sin recargar**: la UI converge sola en ~8 s (sidebar y barra de estado 9→10 paneles) |
| Cambio de sesión (ida y vuelta) | desde el selector, «Conectar» a una sesión temporal vacía (`hd-verify`, creada por API con un solo espacio `verify-ws`): el título pasa a «Sesión: hd-verify», el sidebar muestra **sólo** `verify-ws (1)`, el área queda con **un** panel (`w1:p1`) y **no queda ningún rastro** de `spike-r3`/`docs-r11` ni de sus 4 paneles. Al volver a `herdr-desk-dev`, el sidebar y los 4 paneles vuelven tal cual. La sesión temporal se paró y se borró después |

## 8. Verificación de F1 (frontend)

```text
pnpm install            OK
pnpm format:check       OK
pnpm lint               OK (0 problemas)
pnpm check              svelte-check: 0 errores, 0 warnings
pnpm test               197 tests en 21 archivos (frames, errores, cliente + clasificación de
                        errores de command, codegen, reconcile, snapshot, árbol de splits,
                        parser de atajos, keymap, presets de animación, CardSplitAccordion en
                        jsdom + los 28 de tipografía de terminal y menú de contexto + los 32
                        nuevos de esta ronda: host de terminal, cierre de paneles con clave,
                        botones de header, menú contextual, cambio de sesión y catch-up del
                        snapshot)
pnpm e2e                72 pruebas en 11 specs (shell, shell F1 con regresión de layout,
                        terminal, foco, layout, acciones, atajos, sesiones, cambio de sesión,
                        reconexión y caída/vuelta del servidor + font-menu)
pnpm build              dist/assets/index-*.js 498,32 kB min (136,76 kB gzip) + CSS 35,51 kB
                        → dentro del presupuesto (§4: ≤ 600 KB con xterm)
```

Ese bloque es la foto del cierre de F1 y así se queda. Los números **de hoy**, medidos en esta
máquina con `pnpm test` y contando `tests/e2e/`: **388 tests unit en 45 archivos** y **21 specs
e2e**. Lo que se ha sumado desde el cierre de F1, tarea a tarea: los 5 de
`lib/settings/settings.test.ts` (codegen de T3.5), los 13 de `lib/settings/map.test.ts` (puente
`config.toml` ↔ ajustes), los 7 de T3.6 en `lib/keys/{config,parse}.test.ts`, los 9 de
`lib/theme/theme.test.ts` (T3.7), los de `lib/layout/presets.test.ts` y
`lib/keys/customCommands.test.ts` (T3.3/T3.8) y los de `PaneFrame.test.ts` (T3.1).
Los specs nuevos son `f3.spec.ts` (preset de layout, modo redimensionar, mover panel y
worktrees) y `settings.spec.ts` (guardar en `config.toml` y la pestaña de atajos con su reset);
el arnés acepta ya `guiSettings` y `configEntries` iniciales. La lista es: `shell`, `shell-f1`,
`terminal`, `terminal-stale`, `focus`, `layout`, `split-drag`, `actions`, `keys`, `palette`,
`sessions`, `session-switch`, `reconnect`, `font-menu`, `navigation`, `agents`, `agent-state`,
`agent-actions`, `agent-notices`, `f3`, `settings`.

Bundle tras añadir el acordeón y los presets (no cableados al shell, así que no entran en el
grafo inicial): `pnpm build` sigue en 493 kB min. `pnpm-lock.yaml` sin cambios: **cero
dependencias nuevas**.

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

- **Consola API** (F3/T4.5): solo existe el catálogo por RPC (`api_catalog`, ver `docs/03`); falta
  la UI. La **paleta de acciones** (F2) ya no es un stub declarado: `features/palette/CommandPalette.svelte`
  con `lib/palette/{commands,fuzzy}.ts` (commit `e4bfaa1`) hace fuzzy sin acentos, agrupa por tipo
  y navega con ↑↓/Enter.
- **Modo navegar** (F3): el keymap ya clasifica sus atajos (`navigate`) y el editor de T3.6
  muestra el ámbito de cada fila; falta el modo y el `Hint`.
- **Paneles y pestañas** (T3.1, T3.2): cerrados (§6septies a/b) — modo redimensionar con flechas
  y chip, intercambio por arrastre, mover panel a 3 destinos y reordenar pestañas/espacios.
  El divisor por arrastre venía de `48eab4d` (`split-drag.spec.ts`).
- **Config real** (F3): cerrada la primera mitad. Backend (`config_default`/`config_read`/
  `config_write`/`config_reset_keys` y `gui_settings_read`/`gui_settings_write`, en `docs/03`),
  codegen (`pnpm gen` → `src/lib/settings/settings.gen.ts`, 22 secciones / 120 claves, con el
  parser `parseDefaultConfig` verificado en `settings.test.ts` contra
  `tests/fixtures/default-config.toml`), y ahora las superficies: formulario (T3.5) y editor de
  atajos (T3.6), ambas en `features/settings/`, con `settings.svelte.ts` **sin `localStorage`**
  (§6quinquies), y e2e propia (`settings.spec.ts`). Pendiente: persistencia real verificada
  contra un backend vivo y `theme_custom` sigue siendo solo lectura en el formulario.
  - El codegen ahora exige que el valor de una línea sea TOML válido (igual que
    `try_parse_value` del backend), así que los comentarios de prosa del `--default-config` que
    empezaban por comilla o corchete —p. ej. `# type = "shell" runs detached`— ya no cuentan
    como clave: de ahí el descenso de 127 a 120 claves.
- **Temas** (F3/T3.7): cerrados en cliente (§6sexies) — 18 paletas transcritas, ANSI derivada,
  aplicación en caliente a CSS y xterm, y Mica claro/oscuro. Pendiente: la atribución formal de
  las paletas en `THIRD-PARTY-NOTICES.md` (T5.6) y validar el contraste de los 7 temas claros
  sobre el glass en vivo.
- **Presets, worktrees, comandos personalizados, scrollback y git** (F3/T3.3, T3.4, T3.8-T3.10):
  implementados en cliente (§6septies c-g) y con commands de backend ya registrados. Pendiente
  la verificación **en vivo** de cada uno contra un herdr real (aquí todo se ha medido con el
  arnés y los 388 tests), y decidir si `run_shell_command` —que sale de la superlista a
  propósito— se queda así.
- **Respawn de bridges del backend**: hoy la UI se reengancha sola si el respawn no manda
  frames; si el backend lo asume, hay que quitar el timer (o dejarlo como red de seguridad).
- **Kick del store por evento (backend)**: cerrado en `e303f55` (ver §7quater(f)) y el catch-up del
  frontend se retiró en `a27facb`: el latido solo hace ping de salud y
  `session-heartbeat.test.ts` comprueba que **ni una** llamada a `session.snapshot`. Ya no es deuda.
- **Clics en vivo con la ventana tapada**: si el usuario tiene otra ventana encima, el GUI no
  puede ganar el foco y la verificación en vivo de botones no es posible (los clics irían a la
  ventana de encima). Los scripts de verificación abortan en ese caso.
