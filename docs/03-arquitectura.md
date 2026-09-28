# herdr-desk: arquitectura backend

Estado: F0-F2 cerradas. F3 y F4 con el **backend** hecho (config, worktrees, plugins,
integraciones, estado del server y catálogo de la consola API por RPC) y sin superficies de UI
todavía. Última actualización: contrato de `plugin.*` (13 commands) y `api_catalog`
documentados, `terminal_release` añadido a la lista de commands y aclarado el gating de los
tests de sandbox.

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
 ├─ commands/terminal.rs  terminal_open/input/input_bytes/resize/scroll/close/release
 │                        (gracia 3 s en close; release suelta el bridge —mata su proceso— y
 │                        deja el pane vivo, que es lo que se usa al ocultar un panel)
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

## Suscripción al store (contrato)

- `store_subscribe(on_msg)`: entrega el snapshot crudo de la sesión activa (primer mensaje
  inmediato, bootstrap sin esperar eventos) y luego cada cambio coalescido.
- **Regla de exclusividad**: solo la ÚLTIMA suscripción está activa. Cada
  `store_subscribe` rota la generación: la tarea anterior recibe un token de cancelación
  (`StoreSubs::rotate`), **termina de verdad** y sus mensajes se descartan — esto funciona
  aunque el command ya haya devuelto Ok (el token vive en `AppState`).
- **Cambio de sesión** (`session_connect`, extensión documentada de §5: la respuesta es
  `SessionConnected { session }` para que el frontend descarte residuos de la anterior;
  los params no cambian):
  1. ping contra la sesión nueva;
  2. `Store::close()` del store viejo → su refresher termina y deja de publicar/IO;
  3. release + purga de **TODOS** los bridges de la sesión anterior (registro vacío);
  4. swap del runtime + cancelación de la suscripción store vieja;
  5. el store nuevo publica su snapshot inicial propio por el canal nuevo (el frontend
     re-llama `store_subscribe` y `events_forward`).
- Un canal obsoleto (suscripción cancelada) no entrega nada más: la tarea muere y el
  frontend nunca debe mezclar snapshots de dos sesiones por el mismo canal.
- Tests: `session_switch_tests.rs` (solo la última suscripción entrega y el snapshot es de
  la sesión nueva; registro vacío y store viejo cerrado tras el switch).

### Kick por evento (fix del congelamiento de la UI)

- `events::subscribe_once` hace `kick.notify_one()` **por cada evento** reenviado, no solo
  al final de la conexión. Sin eso el store solo refrescaba en el bootstrap y al
  resuscribir: mientras la conexión L vivía, la UI se quedaba congelada (el agente
  escribía, el panel no cambiaba) aunque los eventos llegaran.
- El bucle `run_with` sigue pateando también después de cada intento de conexión y tras
  cada resuscripción.
- Coste medido: la coalescencia del store (30 ms + `drain`) absorbe la ráfaga, así que
  50 eventos seguidos producen **2 refrescos**, no 50.
- El `kick` que se pasa a `run` es el mismo `Notify` que consume el refresher
  (`Store::kick_handle()`): si se pasan distintos, el store nunca se refresca.
- Tests de regresión en `events.rs`: `cada_evento_refresca_el_snapshot` (3 eventos →
  el snapshot refleja el último, con refrescos más allá del bootstrap) y
  `rafaga_de_50_eventos_coalesce_en_pocos_refrescos` (50 eventos → ≤ 5 refrescos y
  snapshot final alcanzado), ambos con transporte falso y store real.
- Consecuencia en el frontend: el parche de latido que pedía `session.snapshot` para
  forzar refrescos se elimina; el store vuelve a ser la única fuente de verdad.

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

## Integración con la CLI (`cli_run`, lista blanca)

- `cli_run { argv: string[] } -> CliRunOutput { exit_code, stdout, stderr }`.
  El argv se compara **elemento a elemento** (sin shell, sin `cmd /c`, sin redirecciones)
  contra `commands::cli_run::WHITELIST`; cualquier diferencia se rechaza con `ApiError`
  antes de crear el proceso. Los spawns llevan `CREATE_NO_WINDOW` (guardarraíl R8).
- Lista blanca actual (8 entradas, pensada para F2–F4):
  `herdr agent start --help`, `herdr status --json`, `herdr --default-config`,
  `herdr config check`, `herdr integration status`, `herdr plugin config-dir`,
  `git branch --format=%(refname:short)`, `git status --porcelain=v2 --branch`.
  Añadir una entrada es añadir una fila: es la vía **única** por la que la GUI lee la
  CLI, para no repetir el `cmd /c` con strings de usuario que prohíbe el §7 del plan.
- `agent_kinds { refresh?: bool } -> AgentKinds { kinds, reason, cached }`:
  parsea los `possible values` de `herdr agent start --help`, con cache en memoria y TTL
  corto. Si la ayuda no trae la lista, devuelve `kinds: []` **con `reason`**, nunca un
  error fatal: el diálogo de "iniciar agente" degrada a entrada libre.

## Bandeja del sistema, overlay e identidad de toasts (T2.4, T2.5)

- `tray_update { sessions: TraySession[], agents: TrayAgent[] }`:
  - `TraySession { name, running, active, default }`
  - `TrayAgent { pane_id, agent, display, status }`
  El menú se reconstruye desde ese estado: lista de sesiones (conectar, detener con
  confirmación fuerte, salir) y agentes con su estado. `blocked_count()` calcula el
  conteo de bloqueados que alimenta el overlay de la barra de tareas. `setup_tray` se
  llama en el arranque y el proceso no debe sobrevivir a la salida de la app.
- `taskbar_overlay { count?: number | null } -> OverlayApplied { count, applied }`:
  dibuja el número de bloqueados como imagen RGBA (`overlay_rgba`, 32×32) sobre el
  icono de la ventana. `null` quita el overlay. Solo Windows: en el resto de plataformas
  es no-op y devuelve `applied: false` en vez de fallar.
- `toast_identity() -> { aumid, display_name, registered }`: el AUMID se registra en el
  `HKCU\...\AppUserModelId` de la app para que los toasts muestren el nombre de la
  aplicación y no "Windows PowerShell" (patrón `windows-toast-identity.md`).

## Base de configuración (F3, T3.x backend)

Contrato verificado contra la CLI y el server reales (no deducido). Commands en
`src-tauri/src/commands/config.rs`, registrados en `lib.rs`:

- `config_default(refresh: Option<bool>) -> ConfigDefault { sections }`
  - `ConfigDefaultSection { path, table_array, description, keys }`
  - `ConfigDefaultKey { key, value: Option<String>, active, description }`
  - Fuente: `herdr --default-config` (TOML anotado; todo comentado salvo
    `experimental.pane_history = false`), cacheado y con refresco opcional.
  - Incluye las tablas `[[keys.command]]` (`key`/`type`/`command`/`width`/`height`)
    y las subsecciones punteadas (`ui.toast.herdr`, `keys.indexed`).
- `config_read() -> ConfigRead { path, exists, diagnostics, entries }`
  - `ConfigEntry { path, value, origin: "file" | "default", description, in_defaults }`
- `config_write(state, changes: Vec<ConfigChange>) -> ConfigWriteResult`
  - `ConfigChange { path, value: Option<String> }` (`None` quita la clave);
    `value` es TOML, así que `keys.command` admite fragmento `[[keys.command]]…` o
    array inline `[{...}]`.
  - `ConfigWriteResult { applied, rejected, backup, reload, rolled_back, diagnostics }`
- `config_reset_keys(state) -> ConfigResetResult { output, reload }`
  (envuelve `herdr config reset-keys`, que ya hace backup y limpia atajos).
- `ConfigReloadOutcome { status: "applied" | "partial" | "failed", diagnostics, skipped, error }`

### Contrato de la CLI (medido)

- `herdr config check` **no** acepta `--json` (exit 2 si se pasa). Salida de texto:
  - `config: ok` → exit 0.
  - `config: issues found` → exit 1, con líneas `config parse error: …`,
    `unknown config key …; ignoring key`, `unknown config section …; ignoring section`.
  - Mapeo a diagnósticos: `parse_error` → **error** (bloquea la escritura);
    `unknown_key`/`unknown_section` → **warning** (la CLI las ignora).
  - Archivo ausente = `config: ok`. La ruta se puede pisar con `HERDR_CONFIG_PATH`.
- Recarga: RPC `server.reload_config` con `params {}` (EmptyParams, protocolo 19)
  → `{"type":"config_reload","status":"applied"|"partial"|"failed","diagnostics":[…]}`
  (verificado en vivo contra el server sandbox).

### Orden de escritura y seguridad

1. Se valida **sin tocar `config.toml`**: se escribe el texto propuesto a un temporal y
   se corre `herdr config check` con `HERDR_CONFIG_PATH` apuntando ahí (env inyectada
   tras limpiar las `HERDR_*` heredadas; el argv sigue en la lista blanca).
2. Backup `config.toml.bak-<unix-ms>`, **solo en la primera escritura por proceso**.
3. Escritura atómica (tmp + rename) con `toml_edit`: las claves existentes conservan
   decor y comentario de línea; las nuevas no reinyectan comentarios (evita duplicados,
   porque los bloques comentados son trivia del item siguiente).
4. `server.reload_config` sobre el pipe de la sesión activa (nunca el `default`).
5. Si `status == "failed"` → **rollback** (restaura el backup y recarga). Si el RPC
   cae o expira, `reload.skipped = true` sin rollback: la configuración se cargará al
   arrancar.
- Lista blanca: 8 → 9 entradas, solo añade `herdr config reset-keys` (el reset correcto
  es semántica de la CLI). `reload-config` no entra: la recarga va por RPC.
- Dependencia: `toml_edit.workspace = true`.
- Tests: 36 unitarios (roundtrip byte a byte con la fixture real
  `schema/fixtures/default_config.toml`, reemplazo in situ conservando comentario,
  `remove`, fragmento vs inline, rutas inválidas, parser de diagnósticos) y 7 sandbox
  contra server real `hd-test-cfg-*` (check con TOML roto, clave desconocida, fixture
  por defecto, roundtrip con reload `applied` + backup real + segunda escritura sin
  backup, rechazo sin tocar el archivo, y `failed` → rollback).

## Worktrees, estado del server, integraciones y notificaciones

### Worktrees (`src-tauri/src/commands/worktrees.rs`, T3.4)

- `worktree_list(workspace_id/cwd) -> WorktreeListResult { source, worktrees }`
  - `WorktreeSourceInfo` describe el origen (workspace/cwd) y `WorktreeInfo` trae
    `path, is_bare, is_detached, is_prunable, is_linked_worktree, label, branch,
    open_workspace_id` (fiel a `worktree.list` del server).
- `worktree_create(...) -> WorktreeCreated { workspace, tab, root_pane, worktree }`
  (`workspace`/`tab`/`root_pane` son `Value` passthrough: fidelidad de protocolo sin
  duplicar los tipos enormes del server). Ruta por defecto desde `[worktrees] directory`
  de `config.toml` vía `toml_edit`, con expansión de `~` y respetando `HERDR_CONFIG_PATH`.
- `worktree_open(...)` y `worktree_remove(force, confirm)`: la doble confirmación se
  expone en el contrato —`confirm` debe ser `Some(true)` (guard local **antes** del RPC)
  además del `force` del server; sin `confirm`, `invalid_params` con mensaje explícito.
- Las ramas salen de `git branch --format=%(refname:short)` por la lista blanca.
- Sandbox: ciclo completo contra un repo `git init` temporal en `%TEMP%`
  (`commit --allow-empty` con `-c user.name/email`); nunca toca el repo del usuario.

### Estado del server (`server.rs`, T4.3)

- `server_status() -> ServerStatusReport { cli, cli_error, live, live_error }`: parsea
  `herdr status --json` (versión, protocolo, capabilities) y contrasta con un `ping` al
  server vivo. **Nunca devuelve `Err`**: si la CLI o el ping fallan, el reporte lo dice
  en `cli_error`/`live_error` (degradación tipada, la UI decide qué mostrar).
- Manifiestos con `server.agent_manifests` y recarga con
  `server.reload_agent_manifests`; la recarga de config ya vive en `config.rs`.

### Integraciones (`integrations.rs`, T4.2)

- `integration_status() -> Vec<IntegrationStatusEntry>` con
  `{ name, state, version, path, raw }`, parseando la salida real de
  `herdr integration status`:
  `not_installed` | `current` | `other` (cualquier estado nuevo se conserva en `raw`).
- `integration_install` / `integration_uninstall` sobre `integration.install` /
  `integration.uninstall`, normalizando nombres (`antigravity-cli` ↔ `antigravity_cli`).
- Install/uninstall **no** se prueban en tests: escriben en el home real; solo se
  validan la normalización y el rechazo de targets desconocidos.

### Notificaciones nativas (`notifications.rs`, T2.5)

- `notification_show(title?, body?, icon?, test?) -> NotificationShowOutcome`
  con el AUMID de `toast_identity.rs`; `test: true` genera un toast de prueba con
  contenido fijo. Si el registro del AUMID no está, reintenta una vez y responde
  `delivered: false` con `reason` (degrada en silencio y avisa, sin error fatal).

- Tests: 58 unitarios con fixtures reales (`worktree_list.json`, `status_json.json`,
  `integration_status.txt`, lógica de AUMID, expansión de `~`, guards) más sandbox en
  `hd-test-*` (ciclo de worktree, ping vivo con protocolo 19 + manifests + reload +
  integration status vivo, y roundtrip de registro de AUMID).

## Plugins (T4.1, `src-tauri/src/commands/plugins.rs`)

13 commands registrados en `lib.rs` (líneas 173-185) sobre el grupo `plugin.*` del protocolo 19.
La capa es fina y tipada: RPC + parseo del `type` de cada respuesta. La UI nunca ve JSON crudo.

- **Ciclo de vida**: `plugin_list { plugin_id? } -> Vec<PluginInfo>` (`plugin.list`),
  `plugin_enable`/`plugin_disable { plugin_id } -> PluginInfo` (se espera `plugin_enabled` o
  `plugin_disabled`), `plugin_link { path, enabled? } -> PluginInfo` (`plugin.linked`) y
  `plugin_unlink { plugin_id, confirm } -> PluginUnlinked { plugin_id, removed }`
  (`plugin.unlinked`). Los identificadores vacíos (`plugin_id`, `action_id`, `entrypoint`,
  `pane_id`) se rechazan con `invalid_params` antes de tocar el server.
- **Confirmaciones en el contrato** (misma política que `worktree_remove`):
  `plugin_unlink` exige `confirm: Some(true)`; sin ella responde `invalid_params` con el motivo
  explícito y no desvincula nada. La UI pregunta y reenvía.
- `PluginInfo` reproduce el `InstalledPluginInfo` del schema (`plugin_id`, `name`, `version`,
  `manifest_path`, `plugin_root`, `enabled`, `warnings`, `min_herdr_version`, `source`, `actions`,
  `panes`, `events`). `build`, `startup` y `link_handlers` viajan como `Value` a propósito: no
  forman parte de la vista principal de T4.1 y duplicar esos tipos no aporta fidelidad.
- **Acciones y logs**: `plugin_action_list { plugin_id? }` (`plugin.action.list`),
  `plugin_action_invoke { action_id, plugin_id?, context? }` (`plugin.action.invoke`, que
  devuelve la acción, el contexto aplicado y la entrada de log) y
  `plugin_logs { plugin_id?, limit? }` (`plugin.log.list` →
  `PluginCommandLogInfo { log_id, plugin_id, command, status, started_unix_ms, finished_unix_ms,
  exit_code, error, event, action_id, stdout, stderr }`).
  `PluginInvocationContext` cubre workspace/tab/pane/selección/URL e incluye
  `PluginWorktreeContext`; el contexto se reenvía al server tal cual.
- **Panes de plugin**: `plugin_pane_open { plugin_id, entrypoint, workspace_id?,
  target_pane_id?, cwd?, direction?, env?, focus?, width?, height?, placement? }`
  (`plugin.pane.open`) y `plugin_pane_focus`/`plugin_pane_close { pane_id }`; los tres devuelven
  el pane como `Value` (mismo criterio de fidelidad que `worktree_create`). `width`/`height`
  admiten celdas o porcentaje (`"80%"`) y `placement` es `overlay | popup | split | tab | zoomed`.
- **Instalación desde GitHub en dos pasos, con la prueba en el contrato**:
  1. `plugin_install_preview { spec, git_ref? } -> PluginInstallPreview`. Valida el spec
     `owner/repo[/subdir]` y la ref (rechaza `..`, espacios, metacarácteres, refs que empiezan
     por `-` o `/`), clona **shallow** en un temporal (`git clone --depth 1`, spawn directo sin
     shell, `HERDR_*` limpiadas, timeout 60 s), lee `herdr-plugin.toml` o `manifest.toml`
     (exige `id`, `name`, `version` y `min_herdr_version`), borra el temporal y devuelve
     `spec, owner, repo, subdir, requested_ref, resolved_commit, manifest, manifest_raw,
     preview_token`. No instala nada.
  2. `plugin_install { spec, git_ref?, preview_token?, confirm? } -> PluginInstallOutcome
     { spec, requested_ref, exit_code, output }`. Solo continúa con `confirm = true` **y** un
     token de vista previa vigente. El token es one-shot (se consume al usarlo) y además liga
     `spec + ref`, así que la vista previa de otro repo u otra ref no vale. Ejecuta
     `herdr plugin install <spec> --ref X -y` (argv directo, timeout 180 s).
- **Parseo estricto**: cada respuesta se valida contra su `type`; un `type` inesperado devuelve
  `ApiError { code: "server" }` nombrando el tipo recibido, en vez de forzar la estructura.
- **Tests**: 10 unitarios (parseo de las fixtures reales `schema/fixtures/plugin_link.json` y
  `plugin_list.json`, `type` inesperado, confirmación de `unlink`, specs y refs válidas e
  inválidas, manifiesto mínimo y sus campos obligatorios, unicidad del token, memoria one-shot y
  rechazo de `install` sin `confirm` o sin vista previa vigente). Además existe
  `src-tauri/src/plugins_sandbox_tests.rs` con 4 tests contra un server `hd-test-*` real, **pero
  ese archivo no está declarado como módulo en `lib.rs`**, así que hoy no se compila ni se
  ejecuta (ver «Tests: la puerta por defecto y los tests de sandbox»).

## Catálogo de la consola API (T4.5, `src-tauri/src/commands/api_catalog.rs`)

`api_catalog(refresh?) -> ApiCatalog { protocol, schema_version, total, methods }`. Lee
`schema/herdr-api.schema.json` —el contrato real, protocolo 19, 90 métodos— y lo normaliza para
que la UI de consola pueda generar formularios y visores **sin conocer JSON Schema**. Es el único
command que no habla con el server: no usa `RpcClient`.

- **Localización del schema**, en orden: `HERDR_DESK_SCHEMA_PATH`, la ruta de compilación
  (`$CARGO_MANIFEST_DIR/../schema/herdr-api.schema.json`, válida en dev) y hasta 4 ancestros del
  directorio del ejecutable (instalado junto al binario). Si no aparece, `ApiError { code:
  "schema_not_found" }` con la lista de rutas probadas.
- **Normalización** (`normalize_param`): resuelve `$ref` guardando el nombre de la definición en
  `ref_name` (para las badges de la UI) con tope de profundidad 6, resuelve `anyOf` quedándose con
  la primera rama no nula (`null` solo marca `nullable`) y traduce cada tipo a un `kind` estable:
  `string | bool | int | float | enum | array | object | map | unknown`. `array` y `map` traen su
  `item`; `object` trae sus `properties` con su `required`. `ApiParamSpec` expone `name, kind,
  required, nullable, default, enum_values, item, properties, ref_name`.
- `group` es el segmento anterior al primer punto (`plugin`, `worktree`, …); los métodos raíz
  como `ping` caen en `core`. Los métodos salen **ordenados por nombre** y `total` coincide con
  el `oneOf` del schema.
- `description` solo existe para los 27 métodos con texto escrito a mano (`method_description`:
  `ping`, `server.*`, `session.snapshot`, `workspace.*`, `worktree.*`, `plugin.*`,
  `integration.*`, `notification.show`, `events.subscribe`). El resto llega con `None` y la UI
  muestra el nombre: no se inventa documentación.
- **Cacheado** en memoria (un `Arc<ApiCatalog>` estático): el schema se parsea una vez por
  proceso y la segunda llamada devuelve el mismo `Arc`; `refresh: true` fuerza el reread.
- **Tests**: 8, todos contra el **schema real** del repo y no contra un schema sintético
  (protocolo 19, `total == oneOf.len()`, orden estricto sin duplicados, `notification.show` con
  `required`/`nullable`/`enum`, `worktree.remove` con `force` por defecto `false` y
  `worktree.create` con sus 7 params, `ping` sin params, resolución de
  `PluginInvocationContext` y de `PopupSize` (`anyOf` int | `"80%"`), `env` como `map<string>`,
  los 14 grupos con métodos, caché devolviendo el mismo `Arc` y error tipado de schema
  inexistente).

## Tests: la puerta por defecto y los tests de sandbox

`cargo test --workspace` (lo único que hace `pnpm verify` en Rust) da **94 tests, 0 fallos**:

| Target | Tests |
|---|---|
| unit de la lib de `herdr-core` | 12 |
| `crates/herdr-core/tests/fixtures.rs` (T1.1, no gated) | 4 |
| unit de la lib de `src-tauri` | 78 |

En la misma corrida aparecen **7 targets con 0 tests**. No están ignorados con `#[ignore]`: están
compilados a vacío por *feature gating*.

- `crates/herdr-core/tests/{sandbox,survive,experiments,record_fixtures}.rs` empiezan con
  `#![cfg(feature = "sandbox")]` a nivel de crate (línea 1 de cada archivo). Sin la feature, el
  binario existe y no contiene ni un test.
- Los módulos de `src-tauri` no son binarios propios: se declaran en `lib.rs:8-27` como
  `#[cfg(all(test, feature = "sandbox"))] mod …` (`api_catalog`, `cli_run`, `config`,
  `notification`, `sandbox_guard`, `server`, `session_switch`, `terminal_cycle`,
  `terminal_release`, `worktree`). Los que llevan `_tests.rs` repiten además ese mismo
  `#![cfg(all(test, feature = "sandbox"))]` en su línea 1. Un archivo de test que no aparezca en
  esa lista **no se compila**: es el caso de `plugins_sandbox_tests.rs`.
- `sandbox` **no** es feature por defecto en ninguno de los dos `Cargo.toml`
  (`crates/herdr-core`: `sandbox = []`; `src-tauri`: `sandbox = ["herdr-core/sandbox"]`), así que
  la corrida del workspace no la activa.

El gating es deliberado (guardarraíl D10): esos tests arrancan servidores y sesiones reales de
herdr (`hd-test-<pid>-<seq>`, con guard `Sandbox` que hace `stop` + `delete` en `Drop`) y se
pisan entre sí. Se corren a mano **y en serie**:

```powershell
cargo test -p herdr-core --features sandbox -- --test-threads=1
```

`--test-threads=1` no es cosmético. Consecuencia: nada de esa cobertura entra en la puerta
automática (`pnpm verify` solo hace `cargo test --workspace`); quien la quiera tiene que acordarse
del comando anterior.

### Guard de deriva del schema

`pnpm schema:check` (`scripts/schema-check.mjs`) es el guard de R6: compara
`herdr api schema --json` con `schema/herdr-api.schema.json` sobre **JSON estable** (claves
ordenadas, para que el resultado no dependa del formato) y exige además que `schema/VERSION` sea
exactamente `<version de la CLI> protocol=<protocol>`. Si algo difiere sale con código 1 diciendo
qué campo falla, cuántos métodos tiene cada lado y cómo regenerar
(`herdr api schema --json --output schema/herdr-api.schema.json`). No arranca ningún server:
`api schema` solo imprime el schema empaquetado. Estado verificado: protocolo 19,
`schema_version` 1, 90 métodos, `herdr 0.8.0-preview.2026-08-04-d78e3d3b5126`.

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
