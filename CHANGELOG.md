# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versión semántica.

## [0.1.0] - sin publicar

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
