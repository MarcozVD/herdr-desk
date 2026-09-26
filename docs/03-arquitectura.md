# herdr-desk: arquitectura backend

Estado: F1 en curso. Última actualización: T1.5 + conexión S + T1.8 (backend).

## Capas

```
herdr server (por sesión, 1 pipe JSON + bridge CLI)
 ├─ <socket>/herdr.sock  JSON API (NDJSON, 1 request por conexión)  ◄── herdr-core::rpc
 │                        events.subscribe (conexión L persistente)   ◄── herdr-core::events
 │                        pane.agent_status_changed (conexión S, F1)    ◄── (ver Conexión S)
 └─ herdr-client.sock     ◄── `herdr terminal session control` (bridge CLI por pane VISIBLE)

crates/herdr-core (Rust puro, sin Tauri)
 ├─ paths.rs     pipe_name/socket resolution, find_herdr_exe. Ignora HERDR_SOCKET_PATH
 ├─ transport.rs open con retry ERROR_PIPE_BUSY (8 reintentos, backoff exponencial 2→256 ms)
 ├─ rpc.rs       RpcClient: id hd-<n>, timeout 5 s (métodos wait: timeout_ms + 2 s)
 ├─ error.rs     HerdrError (transport/timeout/api/parse) → ApiError {code, message}
 ├─ frame.rs     frame binario 16 B LE: seq u64, w u16, h u16, flags u8 (bit0 full, bit1 closed)
 ├─ model.rs     SessionSnapshot/WorkspaceInfo/TabInfo/PaneInfo + EventData tipada (26 variantes)
 ├─ events.rs    conexión L: suscripción a 24 tipos globales, resubscripción backoff 250 ms→5 s,
 │               normalize_event_type (wire snake_case → dotted)
 │               + open_pane_subscription: conexión S por pane (make-before-break)
 ├─ store.rs     snapshot crudo (RawValue, sin re-serializar) con refresco coalescido (30 ms,
 │               Notify kick; 1 refresco en vuelo máx.)
 ├─ terminal.rs  bridge CLI por pane: spawn con CREATE_NO_WINDOW, stdin JSON (type: terminal.*),
 │               stdout NDJSON → BridgeEvent::Frame/Closed; kill_on_drop
 ├─ cli.rs       session list/stop/delete + start_server_detached
 │               (DETACHED_PROCESS|CREATE_NEW_PROCESS_GROUP, env HERDR_* limpiado)
 └─ config.rs    rutas de config de herdr y settings de la GUI

src-tauri (capa fina)
 ├─ state.rs              AppState {runtime: RwLock<Arc<Runtime>>, bridges, event_channels}
 │                        Runtime {session, client, store} — se reemplaza entero en session_connect
 │                        BridgeRegistry: id → {bridge, pane_id, alive, closing_since, on_frame,
 │                        last_cols/rows (para respawn con el tamaño correcto)}
 ├─ window.rs             show_main() desde ui_ready
 ├─ commands/api.rs       herdr_call, store_subscribe, events_forward, ui_ready
 ├─ commands/session.rs   session_list/connect/start/stop/delete (F1, T1.11)
 ├─ commands/terminal.rs  terminal_open/input/input_bytes/resize/scroll/close (gracia 3 s)
 └─ lib.rs                wiring: L → store kick; runtime_watcher (polling local 150 ms):
                          respawn de bridges + conexión S
```

## Sesiones (T1.5 / T1.11)

- `session_connect(name)`: verifica running, construye Runtime nuevo (client + store + refresher),
  swap atómico + release de todos los bridges de la sesión anterior. El frontend debe volver a
  llamar `store_subscribe` y `events_forward` tras conectar.
- `session_start(name)`: spawn detached del server (sobrevive al cierre de la GUI; verificado
  en `tests/survive.rs`), espera running 15 s. Prohibido para `default`.
- `session_stop/delete`: CLI con confirmación del frontend; `stop` prohibido para `default`
  y `delete` prohibido para la sesión activa.
- Reconexión (server caído): la conexión L resuscribe con backoff 250 ms→5 s y el kick
  del store pide snapshot. El watcher detecta el snapshot nuevo y:
  1. **respawnea** los bridges muertos cuyo pane sigue vivo (mismo bridge_id, mismo canal
     `on_frame`, tamaño recordado cols/rows);
  2. rearma la conexión S (make-before-break).

## Defaults de GUI para el terminal (`gui_defaults`)

Command de solo lectura `gui_defaults() -> GuiDefaults` (§5: estilo `session_current`,
`Result<_, ApiError>`, valores centralizados en consts sin strings mágicos). Es la fuente
de verdad del backend para que el frontend no adivine la fuente de la terminal:

```json
{ "terminal_font_family": "Cascadia Code", "terminal_font_size_px": 13, "terminal_line_height": 1.0 }
```

Cascada de detección (registros Fonts de HKLM y HKCU; matching case-insensitive por nombre
de valor, ej. `"Cascadia Code Regular (TrueType)"`):

| Orden | Familia | Origen |
|---|---|---|
| 1 | `Cascadia Code` | Windows 11 la trae de serie |
| 2 | `Cascadia Mono` | Windows 11 la trae de serie (default de Windows Terminal) |
| 3 | `Consolas` | incluida desde XP; siempre presente en la práctica |
| fallback | `monospace` | genérico CSS; resuelve siempre aunque nada esté instalado |

La resolución es inyectable (`resolve_terminal_font_family(is_installed)` +
`build_gui_defaults(is_installed)`): los tests unitarios no dependen de las fuentes reales
de la máquina. Detectado en esta máquina: `Cascadia Code`.

**Menú contextual del WebView2**: la supresión del menú del navegador es cosa del
FRONTEND (`preventDefault` en el evento `contextmenu` del DOM), no del backend ni de la
configuración de la ventana. No reintentarlo por el lado de Tauri/ventana.

## Conexión y bootstrap (fix bug en vivo, F1)

- **Refresh inicial del store**: el refresher hace un fetch inmediato al arrancar, ANTES de
  esperar kicks. Sin esto, un store arrancado en una sesión sin tráfico quedaba con
  `"{}"` para siempre y el frontend nunca pasaba a online (bug detectado en vivo).
  `store_subscribe` entrega entonces el snapshot real en el primer mensaje.
- **`session_current() -> String`** (§5, registrado en invoke_handler): devuelve la sesión
  activa del runtime. El frontend la usa en bootstrap para el selector y para
  "Iniciar servidor" sin nombre vacío.
- **session_connect**: tras el swap de runtime, el store nuevo arranca con su refresh
  inicial propio (no depende de eventos) y se le manda un kick temprano como refuerzo;
  el watcher detecta el swap (comparación de `Arc` por `ptr_eq`) y rearma la conexión S.
- Test de regresión: `t16_store_bootstrap_snapshot` (sandbox hd-test-*: store sin kicks
  publica snapshot con workspaces/panes) y unitario `store_publishes_initial_snapshot_without_kicks`.

## Conexión S (decisión R12 de F0)

- `open_pane_subscription(pipe, panes)`: suscripción `pane.agent_status_changed` por cada
  pane del conjunto, en una conexión aparte. Devuelve receiver de eventos + sender de cierre.
- `apply_s` (watcher): **make-before-break** — abre la nueva; si la apertura falla conserva
  la vieja; si es exitosa cierra la vieja (el drop del stream cierra el pipe).
- Debounce: el watcher hace tick de 150 ms y solo rearma S cuando el **conjunto** de panes
  cambió entre snapshots (cumple la espera de 100 ms del plan).
- Reenvío al frontend: los eventos de S salen por `events_forward(on_evt)` (§5 ya lo
  definía; no se cambió el contrato). El payload es la línea JSON
  `{"event":"pane.agent_status_changed","data":{...}}` (evento normalizado a dotted).

## Terminales (T1.8 backend)

- Pool: `BridgeRegistry` con ids numéricos estables; **invariante: máximo UN bridge vivo
  por pane** (`find_alive_by_pane` + `purge_dead_for_pane`).
- **Ciclo de apertura** (`open_bridge_in_registry`): purga muertas del pane → si hay un
  bridge vivo para ese pane lo **reutiliza** (cancela la gracia y actualiza el canal
  `on_frame`, mismo id) → si no, crea uno nuevo. Nunca dos bridges vivos para el mismo
  pane (el bug original creaba un segundo y el server respondía `taken over`).

### Contrato de la gracia de cierre (3 s)

- `terminal_close(id)`: marca `closing_since` y **no mata nada**. El bridge sigue vivo y
  acepta input/resize/scroll durante la gracia (el estado closing NO es error).
- Si el frontend reabre el mismo pane dentro de la gracia: `terminal_open` cancela el
  cierre y devuelve el MISMO bridge_id; no hay proceso nuevo ni re-attach.
- Si nadie reabre: a los 3 s se emite un frame `closed` con motivo estable `user_close`
  por el canal del frontend, la entrada pasa a muerta (`dead_reason = user_close`,
  NO respawnable) y se hace release del bridge.

### Contrato de motivos de cierre (estable; parte del IPC)

| Motivo | Causa | ¿Caída real? |
|---|---|---|
| `user_close` | cierre pedido desde la GUI (gracia expirada) | no |
| `released` | server dijo `detached` (despegue normal de la sesión de terminal) | no |
| `taken_over` | server dijo `terminal attach taken over` (otra conexión tomó el pane) | no |
| `pane_closed` | server dijo `pane closed`/`pane exited` | no |
| `server_down` | proceso bridge terminó sin `terminal.closed` (EOF/crash) o server caído | **sí** |
| `unknown:<texto>` | cualquier otro motivo del server | no |

El backend normaliza SIEMPRE el motivo crudo del server (`normalize_close_reason`) antes
de enviarlo: el frontend NO debe clasificar por regex. **Solo `server_down` es caída real.**
La tarea de lectura (`bridge_read_task`) marca la entrada muerta una sola vez y suprime
todo tráfico posterior al cierre (frames duplicados o closed del server tras user_close).
Respawn automático: SOLO entradas con `dead_reason = server_down` cuyo pane siga vivo en
el snapshot (`purge_non_respawnable` limpia panes inexistentes y cierres pedidos).

- Clipboard: plugin `tauri-plugin-clipboard-manager` (Rust + capabilities
  `clipboard-manager:allow-write-text/read-text`). El frontend usa el paquete npm.

## Modelo de eventos (T1.1)

- `EventEnvelope {event: String, data: Value}` tolerante a tipos desconocidos (R6):
  el core nunca se rompe por schema drift; `typed()` devuelve `Option<EventData>`.
- `EventData`: enum tagged con `type`, las 26 variantes del schema
  (`event.EventData`). Validado por dos vías:
  - fixtures reales grabados del sandbox en `schema/fixtures/events/*.json`
    (test `record_fixtures` con `RECORD_FIXTURES=1`);
  - ejemplo sintético por variante en `tests/fixtures.rs` (cobertura de las 26 aunque
    el fixture no se pueda generar en el sandbox).
- Normalización: el server **acepta suscripciones dotted** (`workspace.created`) pero
  **emite snake_case** (`workspace_created`). `events::normalize_event_type` lo lleva a
  dotted para todo el código (frontend incluido).

## Protocolo (hallazgos vigentes)

1. 1 request por conexión; respuesta `{"id","result"}` o `{"id","error":{code,message}}`.
   En vivo aparecen códigos `invalid_request` además de los del plan.
2. `events.subscribe` params: `{"subscriptions":[{type:...}]}` (24 tipos globales; los
   3 con `pane_id` van por conexión aparte). Primera línea:
   `{"id","result":{"type":"subscription_started"}}`.
3. `session.snapshot` → `{"result":{"type":"session_snapshot","snapshot":{...}}}`; el
   store reenvía el JSON crudo de `result.snapshot`.
4. Bridge stdout: `{"type":"terminal.frame","seq","encoding":"ansi","width","height","full","bytes"(b64)}`
   y `{"type":"terminal.closed","reason"}`. Bridge stdin exige `type` en cada mensaje.
5. El schema instalado (`schema/herdr-api.schema.json`, protocol 19) declara
   `pane.output_changed` como suscripción pero **el server la rechaza**. La lista
   autoritativa de suscripciones es la del server en vivo.
6. El server preview a veces descarta el primer `terminal.input` inmediatamente después
   de abrir un bridge o tras idle largo (mitigado con reintento en tests; considerar
   "warm-up" de input en F1 antes de marcar la terminal lista).
7. `pane.release_agent` exige campo `agent` además de `pane_id`/`source` (schema).
   `pane.report_agent` dispara `pane.agent_detected` (por L), no un evento dedicado de
   cambio de estado — por eso existe la conexión S.

## Guardarraíles aplicados

- Nunca se corre `herdr` sin argumentos; spawns explícitos: `--session <name> server`,
  `terminal session control`, o CLI de sesión.
- Solo sesiones sandbox (`herdr-desk-dev`, `hd-test-*`); jamás `default`.
- No se heredan `HERDR_*` (los spawns del core y de la GUI las limpian; el pipe se resuelve
  por nombre de sesión explícito).
