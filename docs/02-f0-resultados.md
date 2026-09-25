# F0: resultados (backend)

Fecha: 2026-09-25 · rama `f0-spike` · herdr 0.8.0-preview.2026-08-04-d78e3d3b5126, protocol 19
Alcance de este documento: la parte BACKEND (herdr-core + src-tauri + scripts). El frontend
(Svelte/xterm) se ejecuta en paralelo; sus métricas completas (arranque con sidebar viva,
chunks de JS, instalador) se consolidan cuando su parte esté lista.

## 1. Metas vs medido (backend)

| Métrica | Meta | Medido (backend) | Cómo | Estado |
|---|---|---|---|---|
| Latencia RPC por pipe | 0,3–0,5 ms (base de docs/01) | ping: min 0,54 ms (NamedPipeClientStream, .NET); en Rust el roundtrip completo con timeout se midió indirectamente vía boot | probe manual + smoke | ✓ |
| Boot backend (proceso → ping/snapshot inicial OK) | arranque en caliente ≤ 800 ms | **423–1209 ms** (debug build; 3 corridas: 423, 500, 724; en frío con compilación de iconos: 926–1440) | `scripts/smoke.ps1` + `scripts/perf.ps1` | ✓ en caliente |
| RAM en reposo (exe + árbol WebView2, sin terminal) | ≤ 200 MB | **170,7–177,8 MB** (debug build, 6 procesos WebView2, sin UI real del frontend) | `scripts/perf.ps1` | ✓ (preliminar: con UI real y 1 terminal falta medir) |
| CPU en reposo (30 s) | ≤ 0,5 % | **0,16–0,62 %** (debug, sin UI real; el rango depende de la corrida) | `scripts/perf.ps1` | ≈ límite (re-medir en F1 con frontend) |
| Eco keydown → frame (backend, 50 teclas) | p95 ≤ 40 ms (base 23–32 ms) | **p50=31 ms, p95=32 ms** (directo por herdr-core, sin WebView) | test `r0_echo_latency` | ✓ el backend no suma overhead sobre la base |
| Instalador NSIS ≤ 10 MB / JS ≤ 600 KB | — | pendiente (dependen del frontend) | — | ⏳ |

Notas de medición:

- El boot medido por `smoke.ps1` es backend-only: la línea `ready` se emite al confirmar el
  ping inicial. La línea de la meta del plan (`ready` al primer render del frontend vía
  command `ui_ready`) ya está implementada y emitirá `stage=ui`; el número consolidado se
  medirá con el frontend en ejecución.
- `perf.ps1` mide árbol completo (exe + WebView2 descendientes) con la ventana sin UI real
  (el frontend no existía al momento de esta medición). La ventana abre con Mica + glass
  config (decorations off, transparent, micaDark).

## 2. Experimentos de riesgo (R1, R5, R7, R10, R12)

Todos automatizados en `crates/herdr-core/tests/experiments.rs`
(`cargo test -p herdr-core --features sandbox -- --test-threads=1`), contra sesiones sandbox
aisladas `hd-test-<pid>-<n>` (nunca `default` ni la sesión de desarrollo).

### R1 — Semántica de resize y convivencia con la TUI

- `terminal.resize` a 90×20: el server confirma el PTY con frame `width=90 height=20` ✓.
- El shell del pane (PowerShell) lo confirma con `mode con`: `Líneas: 20, Columnas: 90` ✓.
- Conclusión: **el resize del controller redimensiona el PTY real**.
- ⚠️ Pendiente de confirmación humana (paso 3 del plan): convivencia con la TUI abierta
  sobre el sandbox. Detectado en el camino: el server preview a veces **descarta el primer
  `terminal.input` enviado justo después de abrir el bridge o tras idle largo** (mitigado en
  los tests con reintento; a considerar un ping de input en F1 antes de pintar "listo").

### R5 — Costo por bridge

| Panes visibles | Primer frame (promedio) | RAM privada incremental por bridge |
|---|---|---|
| 1 | 121–188 ms (con server recién arrancado: peor caso) | ~1,4 MB |
| 4 | 57–72 ms | ~1,4–1,5 MB |
| 8 | 77–87 ms | ~1,3–1,4 MB |

- El costo marginal por proceso bridge es ~1,4 MB (mejor que los 4 MB estimados en docs/01).
- El primer frame tras el arranque del server es lento (~190 ms, spawn de ConPTY); los
  siguientes son 57–87 ms. Con 8 bridges el costo de RAM sigue siendo trivial (<12 MB total).

### R7 — Flood

- Comando `1..200000 | % { $_ }` en un pane visible de 120×40.
- 372 frames en 8 s (~46 frames/s), 158 KB totales: el bottleneck es el propio PowerShell
  imprimiendo por ConPTY, no el pipeline.
- **Cero `events_lost` en la conexión L** durante el flood y `ping` OK al terminar.
- RAM estable (los frames llegan y se descartan; no hay acumulación).

### R10 — Takeover doble

- Segundo bridge sobre el mismo pane: el primero recibe `terminal.closed` con
  `reason="terminal attach taken over"` ✓ y el segundo opera con normalidad (eco verificado).
- Conclusión: la UI puede implementar "Controlado por otra conexión · Retomar" usando el
  `reason` del closed.

### R12 — Eventos de estado de agente

- `pane.report_agent {state:"working"}` → por L llega **`pane.agent_detected`**
  (normalizado; wire: `pane_agent_detected`).
- `pane.release_agent` → `pane.agent_detected` de nuevo.
- **No llega `pane_updated` ni un evento dedicado de cambio de estado por L** para el cambio
  working→idle. Además el snapshot refleja `agent_status` y `agents[]`.
- Decisión (como anticipaba el plan): **hace falta la conexión S** con suscripciones por
  pane a `pane.agent_status_changed` (make-before-break con debounce), o reconciliar por
  snapshot con el kick coalescido ya implementado. Se implementará en F1.
- Nota de protocolo: `events.subscribe` acepta los tipos en formato dotted
  (`workspace.created`) pero **emite en snake_case** (`workspace_created`);
  `herdr-core::events::normalize_event_type` lo normaliza a dotted para todo el código.
- `pane.release_agent` requiere campo `agent` (además de `pane_id`/`source`).

## 3. Hallazgos de protocolo (schema instalado vs server vivo)

1. El schema instalado (`herdr api schema --json`, guardado en `schema/herdr-api.schema.json`)
   declara un tipo de suscripción `pane.output_changed` que **el server rechaza**
   (`unknown variant`). La lista autoritativa es la que devuelve el propio server: 24 tipos
   globales + 3 con `pane_id` (`pane.output_matched`, `pane.agent_status_changed`,
   `pane.scroll_changed`). El core usa la lista del server.
2. `events.subscribe` params: `{"subscriptions":[...]}` (no `types` como en un primer
   intento del plan). Primera línea de respuesta: `{"id","result":{"type":"subscription_started"}}`.
3. `session.snapshot` responde `{"result":{"type":"session_snapshot","snapshot":{...}}}`;
   el core extrae `result.snapshot` como JSON crudo sin re-serializar (RawValue).
4. Bridge stdout: `{"type":"terminal.frame","seq","encoding":"ansi","width","height","full","bytes"(b64)}`.
   Bridge stdin exige `type` en cada mensaje: `terminal.input`, `terminal.resize`,
   `terminal.scroll`, `terminal.release`. Sin `type`: descartado con warning
   (`invalid json command: missing field 'type'`).
5. `error_response` en vivo usa códigos como `invalid_request` (además de los del plan:
   `not_found`, `invalid_params`, ...). El mapeo de errores del core los pasa tal cual.

## 4. Desviaciones del plan (F0 backend)

1. **T0.2**: el scaffold se generó desde template oficial `pnpm create tauri-app … svelte-ts`;
   solo se copió `src-tauri/**` (icons incluidos) al repo. El `package.json`, `src/**`, etc.
   quedan para el agente frontend (trabajo paralelo en la misma rama).
2. **T0.3**: solo la parte Rust (`rust-toolchain.toml`); el pin de dependencias pnpm es del
   frontend.
3. **T0.8**: la verificación `pnpm tauri build --debug --no-bundle` completa requiere el
   frontend; se verificó con `cargo build -p herdr-desk` + placeholder `dist/index.html`
   (no trackeado, `/dist/` ignorado). `smoke.ps1` lanza el exe real con
   `HERDR_DESK_SESSION=herdr-desk-dev` y espera `ready` (SMOKE OK, startup 423–1209 ms).
4. **T0.11**: `perf.ps1` por ahora corre el exe debug (el release requiere `pnpm build` del
   frontend). Re-mediciones de RAM/CPU/arranque consolidadas cuando el frontend esté listo.
5. Commits: un commit por tarea tal como pide el plan (`feat(core): …`, `feat(app): …`,
   `test(core): …`).

## 5. Verificación ejecutada

```text
cargo fmt --all --check                                 OK
cargo clippy --workspace --all-targets -- -D warnings   OK
cargo test -p herdr-core                                9 passed
cargo test -p herdr-core --features sandbox -- --test-threads=1
  tests/sandbox.rs      7 passed (ping, snapshot, store, split, bridge echo, release/close)
  tests/experiments.rs  5 passed (R1, R5, R7, R10, R12) + r0_echo_latency (p50 31 / p95 32 ms)
scripts/sandbox.ps1 start|stop|status                   OK (ready / deleted:true / solo default)
scripts/smoke.ps1                                       SMOKE OK startup_ms=423
scripts/perf.ps1                                        RAM 171–178 MB, CPU 0,16–0,62 %, boot 629–1440 ms
```

Sesiones sandbox de tests: se auto-limpian en `Drop` (stop + delete). Verificado que no
quedan `hd-test-*` después de las corridas.

## 6. Go/No-Go (parte backend)

**Sin bloqueos**: los 5 riesgos medidos resuelven o quedan con plan de mitigación concreto
(R12 → conexión S en F1; R1 TUI → confirmación humana pendiente). RAM y eco dentro de meta
incluso en build debug. Decisión consolidada con el frontend.
