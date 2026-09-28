# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

La interfaz es una SPA (Svelte 5 + CSS) que se empaqueta como app de escritorio de Windows 11
con Tauri 2 sobre WebView2, con Mica del sistema detrás. Se registra como `web` porque la
lengua visual y el layout son web; **no** debe tratarse como un sitio responsive ni como una
experiencia móvil: el shell, la densidad y las superficies son de escritorio Windows.

## Users

Desarrolladores que ya usan el CLI herdr y dirigen varios agentes de código a la vez
(integraciones confirmadas con Claude Code, Codex, opencode, Gemini, Kimi, Copilot, Droid, pi,
omp, Qoder y Antigravity CLI). La sesión de trabajo típica son muchas terminales y muchos agentes
simultáneos, en sesiones largas, durante horas.

Caso de uso principal confirmado: **uso diario intenso y de alta densidad**. La densidad de
información es una característica deseada, no un defecto a corregir.

## Product Purpose

Dar al herdr una superficie de escritorio nativa, rápida y legible para ver el trabajo de un
vistazo:
espacios, tabs, panes, terminales en vivo, el estado de cada agente y acciones sobre ellos.

El éxito significa que la app se puede usar como cliente principal durante el día, sin volver al
CLI para lo Cotidiano, y queoda acción que el CLI soporta también se puede hacer desde aquí.

## Positioning

La app y el CLI son dos clientes del mismo servidor de herdr (protocol 19, named pipe). No hay un
segundo motor de sesiones: lo que haces en la app es visible en el CLI y al revés. Esa es la
posición que un producto vecino no puede copiar sin reimplementar el servidor.

## Operating Context

- Windows 11 como sistema de escritorio, con Mica como material de fondo del shell.
- herdr 0.8.0-preview (protocolo 19) como servidor; la app nunca inventa estado de sesiones.
- Sesión explícita siempre vía `HERDR_DESK_SESSION`; nunca `default`, nunca heredar `HERDR_*`.
- Terminales: xterm.js con WebGL, scrollback en el servidor (no en el cliente).
  -IDIOMA: la interfaz, los mensajes y los comentarios del código están en español. Los nombres de
  identificadores, métodos del protocolo y tipos generados se mantienen en inglés porque vienen del
  schema del servidor.

## Capabilities and Constraints

Confirmado:

- Tauri 2 + Svelte 5 + xterm.js; Rust 1.97, Node 22, pnpm 10 (`rust-toolchain.toml`).
- Sin dependencias nuevas: las que hay, se usan.
- Puente de terminal: `herdr terminal session control --takeover`. **Release** (soltar) y **close**
  (cerrar) son caminos distintos; close emite `user_close` y mata el proceso del pane. Ocultar un
  panel nunca debe matarlo.
- Protocolo: `schema/herdr-api.schema.json` es la autoridad de métodos y parámetros.
- Superficies de terminal: casi opacas, **sin** `backdrop-filter`. Es una decisión deliberada
  (§3 capa 3 del plan): el cristal no se aplica sobre el texto de la terminal.
- Accesibilidad ya respetada y a preservar: `prefers-reduced-transparency` desactiva el cristal,
  `prefers-reduced-motion` desactiva las animaciones, y existe un ajuste para forzar o apagar el
  cristal.
- Rendimiento: animar `box-shadow` está prohibido; el glow de estado solo anima `opacity`.
- Verificación obligatoria antes de dar algo por terminado: `format:check`, `lint`, `check`,
  tests unitarios, e2e, gates de Rust (fmt, clippy con `-D warnings`, workspace, sandbox).

Decisiones de producto sin cerrar:

- Si la app se seguirá considerando como herramienta personal o se abrirá a terceros. Hoy el uso
  declarado es personal e intensivo; no hay trabajo de onboarding ni de contenido de bienvenida
  confirmado.

## Brand Commitments

- Nombre: `herdr-desk`. Identificador de Tauri y AUMID de notificaciones: `com.mvale.herdrdesk`
  (identificador de producto en Windows; no es un dato personal y no debe cambiarse sin rehacer el
  registro de notificaciones).
- Iconos propios: **blanco** en la barra de tareas y en la ventana, **negro** en la bandeja. La
  bandeja usa un icono embebido en compilación, no el del ejecutable.
- Material: cristal sobre Mica. Es un compromiso de identidad, no una decoración opcional.
- Tipografías: Geist Variable para interfaz, JetBrains Mono Variable para monoespaciado.
- Paleta por defecto de tema tipo dracula, sustituible por `[theme]` de `config.toml`.
- Idioma: español.

## Evidence on Hand

- `schema/herdr-api.schema.json` y `schema/fixtures/` (eventos y respuestas reales grabadas del
  servidor).
- Suite de pruebas viva: 349 tests de frontend y las suites de Rust (unit y sandbox contra
  sesiones `hd-test-*` reales).
- Assets de marca: `assets/icons/` (SVG blanco y `currentColor`, PNG y WebP negros).
- Documentación pública: `docs/03-arquitectura.md`, `docs/04-ui-arquitectura.md`.
- **Ausencias que no se deben inventar:** no hay testimonios, clientes, métricas de adopción,
  precios ni benchmarks públicos. El plan de desarrollo y los resultados de F0 existen pero están
  deliberadamente fuera del repositorio publicado (`docs/_privado/`).

## Product Principles

1. **El servidor es la verdad.** La app es un cliente más; nada de estado paralelo que pueda
   discrepar.
2. **La densidad es una feature.** El trabajo real ocurre en muchos paneles a la vez; la
   información cabe o se pierde.
3. **La terminal manda.** Legibilidad y rendimiento de la terminal nunca se sacrifican por un
   efecto visual.
4. **El estado de los agentes se lee de un vistazo.** Es la razón por la que existe el panel de
   agentes.
5. **Cerrar es destructivo y ha de ser explícito.** Soltar un puente no es cerrar un panel.

## Accessibility & Inclusion

- `prefers-reduced-transparency` y `prefers-reduced-motion` se respetan; el cristal se puede
  apagar o forzar desde ajustes.
- El cristal no es el único portador de significado: los estados de agente tienen además color,
  texto y posición.
