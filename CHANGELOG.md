# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versión semántica.

## [Unreleased]

Arreglos de la GUI de terminal y del panel de agentes contra sesiones reales: la sidebar reparte el
alto como la TUI, el terminal reconcilia su tamaño con el servidor al redimensionar, y los links y
el ratón llegan a donde deben.

### Corregido

- **Sidebar sin solapes**: con muchos espacios o agentes, `.sidebar__section` (item flex con
  `flex-shrink: 1` y `min-block-size: 0`) bajaba del alto de su contenido y las filas se dibujaban
  encima de la sección siguiente. Ahora usa `flex: 0 0 auto`, el scroll vertical queda en el
  sidebar entero y hay un e2e de regresión (`sidebar-overflow.spec.ts`).
- **Terminal al redimensionar**: con la sidebar expandida o al arrastrar divisores, el panel quedaba
  en blanco o redimensionaba a saltos: el pool daba por confirmado un resize antes del `full` del
  servidor y no reconciliaba. El `full` ahora se compara contra la rejilla real, reintenta hasta 3
  veces y si el servidor clampa adopta su tamaño; el fit corre por `requestAnimationFrame`
  (durante el arrastre solo reflow local y un único `terminal_resize` al soltar) y `#refit` usa el
  mismo camino. Cubierto por tests de clamp y de throttle.
- **Scroll de la terminal**: el scrollback vive en el servidor y cada scroll reemplaza el viewport;
  la selección de xterm quedaba en coordenadas viejas y resaltaba líneas que ya no estaban
  seleccionadas. Ahora se limpia antes de pedir el scroll, con test nuevo.
- **Links abiertos en el navegador**: faltaba el scope `opener:allow-default-urls` del plugin
  opener, así que `openUrl` siempre rechazaba, y el error se tragaba (ahora se registra). Se usa
  `linkHandler` para los OSC 8 en vez de `window.open`, y en panes con agente los links se abren
  con Ctrl/Cmd+clic. Nuevos `src/lib/terminal/links.ts` y su test.
- **Panel activo unificado**: el panel de agentes, la status bar y los avisos usan `visible.paneId`
  como única fuente de verdad. Se poda la memoria de tabs muertos, la adopción del foco del
  servidor se rearma por sesión y el foco local se reconcilia con el snapshot sin bucle de
  `effect`; `resetSessionState` limpia menús, toasts y resuelve `confirm`/`prompt`/`form`
  pendientes; `isKnownId`/`pickKnownId` compartidos en `stores/ids.ts`. Con tests unitarios y e2e.
- **openPath con scope acotado**: `opener:allow-open-path` no tenía scope y el plugin lo negaba.
  Ahora queda limitado a `$TEMP/herdr-desk-*` y `$DATA/herdr/**`, y `PluginsDialog` y
  `edit_scrollback` registran el error real. Tests de scope y de `edit_scrollback`.

### Cambiado

- **Reparto 50/50 de la sidebar**: la sidebar reparte el alto 50/50 entre espacios y agentes, como
  la TUI; cada sección con scroll propio, y cabeceras y botón de nuevo espacio fijos. El caso
  compacto (muchos datos) queda cubierto por el e2e.
- **Ratón en panes con agente**: los frames del bridge no traen los DECSET de ratón, así que en
  panes con agente se sintetiza SGR 1006 (`press`/`release`/`drag`) igual que ya ocurría con la
  rueda; Shift+arrastre selecciona en local y allí los links requieren Ctrl/Cmd+clic. Además, el
  pool recrea la vista si el `terminal_id` de un pane cambia (el servidor recicló el id para otra
  terminal). e2e de input que enfoca por teclado.

## [0.1.1] - 2026-09-28

Parche de la GUI de terminal y del arranque contra servidores más nuevos.

### Corregido

- **Portapapeles de la terminal**: `Ctrl+V` salía como `^V` y no pegaba nada, y `Ctrl+C` con texto
  seleccionado mataba el proceso en vez de copiar. Las dos teclas pasan por el portapapeles del
  sistema; `Ctrl+C` sin selección sigue siendo SIGINT.
- **Repintado al cambiar de espacio**: al volver a un espacio, la terminal se pintaba con la rejilla
  de la vista anterior (`#forceRepaint` pedía el full con `lastCols/lastRows` viejos): la terminal
  quedaba sin llenar el marco y las gráficas de los agentes salían deformadas. La vista registra su
  tamaño real antes de `show`/`open` y `syncSize` compara contra la rejilla del servidor.
- **Directorio de las terminales nuevas**: `tab.create`, `pane.split` y `workspace.create` heredaban
  el `cwd` del panel enfocado por el servidor, que puede estar en otro espacio. Ahora heredan el del
  panel que se está viendo.
- **Rueda en los TUI**: los agentes TUI (opencode, claude) sin scrollback recibían la secuencia SGR
  de los botones 64/65 en la celda del puntero.
- **Sidebar y barra de scroll**: la sidebar ya no se desborda al aparecer su barra vertical, y la
  barra propia de xterm se oculta (el scrollback vive en el servidor).

### Añadido

- **Servidor incompatible**: al arrancar contra un backend más nuevo que el de la GUI, el título lo
  avisa con un banner persistente y hay un botón para reiniciar la sesión. `server_incompatible`
  deja el panel en error, sin watchdog ni reenganche. `herdr-core` acepta `server_status --json`
  (con respaldo en texto) y propaga `BridgeEvent::Stderr`.

### Verificación

`pnpm verify` en verde (format:check, lint, `svelte-check`, 439 tests unit, `schema:check`, clippy
con `-D warnings`, `cargo test --workspace`) sobre 52 archivos de test.

## [0.1.0] - 2026-09-28

Primera versión completa de `herdr-desk`: GUI de escritorio (Windows 11) para
[herdr](https://github.com/herdrdev/herdr), el multiplexor de terminales para agentes de código.
Requiere herdr 0.8.0-preview (protocol 19) y Windows 11. Tauri 2 + Svelte 5 + xterm.js sobre
WebView2, con Mica y cristal por encima.

El trabajo se hizo por fases (F0-F5), cada una con su bitácora. Resumen:

### F0 — spike y medición

- Scaffold Tauri 2 + Svelte 5 + Vite con dependencias fijadas y toolchain anclado (Rust 1.97,
  Node 22, pnpm 10).
- `herdr-core`: transporte por named pipe (NDJSON, 1 request por conexión) con reintentos, cliente
  RPC con id y timeouts, códec del frame binario de 16 B, modelo de eventos tipado y fixtures
  grabadas del servidor.
- Bridge de terminal (`herdr terminal session control`) con `CREATE_NO_WINDOW`.
- Suscripción a eventos y store con snapshot coalescido.
- Shell glass sobre Mica y terminal en vivo; scripts de smoke y de perf; experimentos de riesgo
  (latencia de eco, R1/R5/R7/R10/R12).
- Decidido y verificado: foco local por defecto, la lista blanca de procesos, el scrollback vive
  en el servidor.

### F1 — núcleo

- Modelo y stores en Svelte 5 runes con reconciliación en sitio, cliente TS generado desde el
  schema (90 métodos) y clasificación de errores de command.
- Sesiones: listar, conectar, arrancar, detener y borrar; conexión L (eventos globales) y
  conexión S (estado de agente por pane).
- Reconexión con backoff y respawn de bridges; watchdog de conexión.
- Pool de terminales: LRU de 12 instancias, WebGL hasta 8 panes, scrollback propio con barra
  propia, portapapeles.
- Árbol de splits, divisores y marcos de panel; motor de atajos con prefix, cheatsheet y
  detección de conflictos; acciones de espacios, pestañas y paneles con diálogos.

### F2 — panel de agentes, acciones y notificaciones

- Panel de agentes con orden por prioridad, filtro, filas configurables, glow por estado
  (solo `opacity`) y rollups.
- Conteo de bloqueados con overlay en la barra de tareas.
- Acciones de agente: arrancar agente, prompt, foco, lectura y espera de salida, vía RPC contra el
  CLI.
- Notificaciones nativas con AUMID propia y bandeja/overlay con iconos propios.
- Paleta de acciones con búsqueda difusa, navegación de agentes y sonidos.

### F3 — superficies de trabajo

- **Configuración real por RPC**: `config_default`/`read`/`write`/`reset_keys` con backup, check y
  recarga; formulario generado desde `herdr --default-config` (22 secciones, 120 claves) y
  preferencias exclusivas de la GUI en `%APPDATA%\herdr-desk\settings.json`.
- **Editor de atajos** con captura de combinaciones, ámbitos y conflictos, escribiendo sobre
  `[keys]` de `config.toml`.
- **Temas en vivo**: las 18 paletas de herdr aplicadas a la interfaz y a la paleta ANSI del
  terminal, con `auto_switch` según la apariencia de Windows.
- **Layout**: modo redimensionar con flechas, redimensionado por arrastre, intercambio de paneles,
  mover panel a otra pestaña/espacio, reordenar pestañas y espacios, y presets de layout
  validados contra el contrato.
- **Worktrees**, **comandos personalizados** de `[[keys.command]]` (shell detached, pane, popup),
  **salida del panel** (buscar, editar el scrollback, esperar un texto o un `re:`) y **estado git**
  por espacio.
- **Cristal**: nivel de opacidad 1-100, fondo de ventana Mica o Acrílico y tipografía de terminal
  resuelta por el backend (`Cascadia Code` → `Cascadia Mono` → `Consolas`).
- Menú de contexto nativo del WebView2 suprimido en toda la ventana.

### F4 — plugins, integraciones, servidor y consola API

- **Plugins**: lista, activar/desactivar, desvincular, vincular carpeta local, instalar desde
  GitHub con vista previa, acciones con contexto, logs y panes.
- **Integraciones**: estado, versión, ruta, instalación y desinstalación con confirmación.
- **Servidor**: estado por CLI y por sesión viva, manifiestos de agentes, recarga de configuración,
  detener con doble confirmación, y **update y canal** desde la lista blanca del CLI (9 → 15
  formas con argv exacto).
- **Consola API**: formulario generado desde el schema de los **90 métodos**, historial de
  respuestas y visor de **24 tipos de evento en vivo**.
- **Panel avanzado**: metadata de pane y workspace, agentes reportados, título de ventana, gráficos
  kitty, cierre de popup, traspaso en vivo, notificación de prueba y copia del skill del agente.
- **Cobertura vigilada**: los 90 métodos están clasificados (`curated:<feature>` o `console`) y
  `coverage.test.ts` falla si el schema añade uno sin clasificar o si la tabla se queda obsoleta.
  `pnpm schema:check` vigila además la deriva del schema commiteado.

### F5 — pulido, rendimiento y distribución

- **Accesibilidad medida**: los pisos de opacidad del cristal en tema claro salen del contraste
  WCAG real (contraste + mezcla sRGB) contra el peor fondo, no de criterio visual; regla global
  `prefers-reduced-motion`; estados de carga en los cinco diálogos de datos.
- **Carga diferida**: los siete diálogos pesados se importan con `import()` dinámico. El chunk
  inicial baja de 696,15 a **494,46 kB** (gzip 131,18), dentro del presupuesto de 600 kB.
- **Memoria**: al minimizar, el WebView2 pasa a `MemoryUsageTargetLevel::Low` y vuelve a `Normal`
  al restaurar; flags de navegador de bajo consumo. RAM del árbol sin paneles de 263,2 a 177,8 MB.
- **Terminal**: ocultar un panel respeta la gracia de 3 s antes de soltar el bridge (volver dentro
  de la ventana reusa el bridge y pide el repintado completo) y el cursor deja de parpadear, lo
  que baja el CPU en reposo con terminal visible de ~5,6 % a ~0,8 %.
- **Distribución**: instalador NSIS por usuario (sin UAC) de **3,51 MB**, en español e inglés, y
  un lanzador `[[keys.command]]` que abre la GUI sobre la sesión activa de herdr. Sin firma y sin
  auto-actualización (decisión pendiente).

### Verificación

`pnpm verify` en verde (format:check, lint, `svelte-check`, 408 tests unit, `schema:check`, clippy
con `-D warnings`, `cargo test --workspace`), **129 pruebas e2e** en 22 specs, y las suites de
sandbox contra sesiones reales: 116 de `herdr-desk` y 33 de `herdr-core`.

### Limitaciones conocidas de esta versión

- Sin firma digital y sin auto-actualización: actualizar es reinstalar el instalador.
- El modo navegar de atajos (F3) sigue sin implementarse.
- CPU en reposo entre 0,42 y 1,04 % con la ventana visible (la meta del plan era ≤ 0,5 %): es el
  suelo del compositor de WebView2 con ventana transparente y capas de cristal.
- RAM ≈ 200 MB con una terminal visible.
- Algunas paletas claras de herdr no alcanzan contraste AA sobre el cristal ni con la capa opaca.
- Los paneles que abre un comando `pane`/`popup` no se cierran solos: no hay canal de eventos que
  avise de `pane_exited` en la UI.

## Créditos

Las 18 paletas de temas y los recursos de marca provienen de
[herdr](https://github.com/herdrdev/herdr) (Apache-2.0). La atribución formal en
`THIRD-PARTY-NOTICES.md` sigue pendiente.
