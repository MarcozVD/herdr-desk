pub mod commands;
pub mod overlay;
pub mod power;
pub mod state;
pub mod toast_identity;
pub mod tray;
mod window;

#[cfg(all(test, feature = "sandbox"))]
mod api_catalog_sandbox_tests;
#[cfg(all(test, feature = "sandbox"))]
mod cli_run_sandbox_tests;
#[cfg(all(test, feature = "sandbox"))]
mod config_sandbox_tests;
#[cfg(all(test, feature = "sandbox"))]
mod notification_sandbox_tests;
#[cfg(all(test, feature = "sandbox"))]
mod sandbox_guard;
#[cfg(all(test, feature = "sandbox"))]
mod server_sandbox_tests;
#[cfg(all(test, feature = "sandbox"))]
mod session_switch_tests;
#[cfg(all(test, feature = "sandbox"))]
mod terminal_cycle_tests;
#[cfg(all(test, feature = "sandbox"))]
mod terminal_release_sandbox_tests;
#[cfg(all(test, feature = "sandbox"))]
mod worktree_sandbox_tests;

use std::sync::Arc;
use std::time::{Duration, Instant};

use herdr_core::cli::CliSessionList;
use herdr_core::model::SessionSnapshot;
use herdr_core::{RpcClient, Store, events};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// Icono de la ventana principal (BLANCO), embebido en tiempo de compilacion
/// y coherente con el recurso del ejecutable: la barra de tareas saca el
/// icono del exe, que sale de assets/icons/herdr-white.svg via `tauri icon`.
const WINDOW_ICON_PNG: &[u8] = include_bytes!("../icons/128x128.png");

/// Espera maxima a que una sesion recien arrancada quede `running`.
const SESSION_START_WAIT: Duration = Duration::from_secs(15);
const SESSION_POLL_INTERVAL: Duration = Duration::from_millis(300);

/// Sesion elegida: `HERDR_DESK_SESSION` si viene del entorno (dev/scripts); si no,
/// `default` (aunque herdr no tenga ninguna sesion todavia: se crea al arrancar).
fn selected_session_name(env: Option<String>) -> String {
    env.filter(|n| !n.is_empty())
        .unwrap_or_else(|| "default".to_string())
}

fn session_is_running(list: &CliSessionList, name: &str) -> bool {
    list.sessions.iter().any(|s| s.name == name && s.running)
}

/// B1 — sondea `session_list` hasta que la sesion quede `running` o venza el
/// tiempo. Los errores del CLI (server aun arrancando, pipe ausente) se toleran
/// mientras quede tiempo: al final lo que decide es `running=true`.
fn wait_until_running<L, S>(
    name: &str,
    timeout: Duration,
    mut list: L,
    mut sleep: S,
) -> Result<(), String>
where
    L: FnMut() -> Result<CliSessionList, herdr_core::error::HerdrError>,
    S: FnMut(Duration),
{
    let deadline = Instant::now() + timeout;
    loop {
        if let Ok(sessions) = list()
            && session_is_running(&sessions, name)
        {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "la sesion {name} no quedo corriendo en {} s",
                timeout.as_secs()
            ));
        }
        sleep(SESSION_POLL_INTERVAL);
    }
}

/// B1 — "si antes no se ejecuta herdr no sirve": si la sesion elegida no esta
/// `running`, se arranca su server detached (permitido tambien para `default`
/// porque es el arranque de la app) y se espera hasta 15 s. Solo se falla si el
/// exe no existe, el CLI no responde o vence el timeout; el caller muestra el
/// error en un dialogo nativo y sale.
fn resolve_session() -> Result<String, String> {
    let name = selected_session_name(std::env::var("HERDR_DESK_SESSION").ok());
    let list = herdr_core::cli::session_list()
        .map_err(|err| format!("no se pudo listar las sesiones de herdr: {}", err.message()))?;
    if session_is_running(&list, &name) {
        tracing::info!("sesion {name} ya esta corriendo");
        return Ok(name);
    }

    tracing::info!("sesion {name} no esta corriendo: arrancando server detached");
    herdr_core::cli::start_server_detached(&name)
        .map_err(|err| format!("no se pudo arrancar la sesion {name}: {}", err.message()))?;
    wait_until_running(
        &name,
        SESSION_START_WAIT,
        herdr_core::cli::session_list,
        |wait| {
            std::thread::sleep(wait);
        },
    )?;
    tracing::info!("sesion {name} corriendo");
    Ok(name)
}

/// Error fatal de arranque: log claro, dialogo nativo (si el plugin ya esta
/// inicializado) y salida con codigo 1.
fn fatal_session_error(app: &tauri::AppHandle, message: &str) -> ! {
    eprintln!("[herdr-desk] error: {message}");
    tracing::error!("{message}");
    let _ = app
        .dialog()
        .message(message)
        .title("herdr-desk: no se pudo iniciar")
        .blocking_show();
    std::process::exit(1);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        // B2: SIEMPRE el primero. Segundo lanzamiento -> foco en la instancia viva.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            crate::window::focus_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(move |app| {
            // B1 — La sesion es explicita: HERDR_DESK_SESSION (dev, tests y
            // scripts). Nunca se hereda HERDR_* del entorno (D10). Instalada y
            // lanzada desde el menu o la TUI no hay variable: se usa la sesion
            // `default` de herdr (T5.3/T5.4) y, si no esta corriendo, se arranca
            // aqui mismo (arranque de la app). Error solo si no hay exe o vence
            // el plazo, con dialogo nativo.
            let session = match resolve_session() {
                Ok(name) => name,
                Err(message) => fatal_session_error(app.handle(), &message),
            };
            let pipe = herdr_core::paths::pipe_name(&herdr_core::paths::session_socket(&session));
            let startup = Instant::now();
            let client = Arc::new(RpcClient::new(pipe.clone()));
            let store = Arc::new(Store::new());
            tauri::async_runtime::spawn(store.refresher_task(client.clone()));
            let state_arc = Arc::new(state::AppState::new(state::Runtime {
                session: session.clone(),
                client: client.clone(),
                store,
            }));
            app.manage(state_arc.clone());

            // C1 — Compatibilidad cliente/servidor: si el server de la sesion es
            // viejo (protocolo privado incompatible), la app sigue usable pero
            // los bridges no se spawnean; la UI muestra el banner con Reiniciar.
            match herdr_core::cli::server_status(&session) {
                Ok(compat) => {
                    if compat.incompatible() {
                        let message = compat.incompatible_message(&session);
                        tracing::warn!("{message}");
                        eprintln!("[herdr-desk] aviso: {message}");
                    }
                    state_arc.set_compat(&session, compat);
                }
                Err(err) => {
                    tracing::warn!("no se pudo leer la compatibilidad de {session}: {err}");
                }
            }

            // L: eventos globales → kick del store (coalescing)
            let (ev_tx, mut ev_rx) = tokio::sync::mpsc::channel(1024);
            let pipe_events = pipe.clone();
            let store_kick = state_arc.current().store.kick_handle();
            tauri::async_runtime::spawn(async move {
                events::run(pipe_events, ev_tx, store_kick).await;
            });
            tauri::async_runtime::spawn(async move {
                while let Some(ev) = ev_rx.recv().await {
                    tracing::debug!("evento L: {}", ev.event);
                }
            });

            // identidad de toasts (AUMID) y bandeja del sistema
            toast_identity::setup_toast_identity();
            if let Err(err) = tray::setup_tray(app.handle()) {
                tracing::warn!("no se pudo iniciar el tray: {err}");
            }

            // icono explicito de la ventana principal: BLANCO, coherente con el
            // recurso del ejecutable (bundle.icon regenerado desde
            // assets/icons/herdr-white.svg). La bandeja usa su negro propio.
            // No interfiere con el overlay de la barra de tareas (overlay.rs
            // pinta el overlay sobre el handle, no sobre el icono base).
            if let Some(main) = app.get_webview_window("main") {
                match tauri::image::Image::from_bytes(WINDOW_ICON_PNG) {
                    Ok(icon) => {
                        if let Err(err) = main.set_icon(icon) {
                            tracing::warn!("no se pudo poner el icono de la ventana: {err}");
                        }
                    }
                    Err(err) => tracing::warn!("icono de ventana no decodificable: {err}"),
                }
                // T5.2 — al minimizar, WebView2 a memoria baja; al volver, normal.
                power::install(&main);
            }

            // watcher: respawn de bridges + conexión S (make-before-break, debounce 100 ms)
            let watcher_state = state_arc.clone();
            tauri::async_runtime::spawn(async move {
                runtime_watcher(watcher_state).await;
            });

            // ping inicial: verifica protocolo y loguea backend ready
            let client_ping = client.clone();
            let session_log = session.clone();
            tauri::async_runtime::spawn(async move {
                let startup_ms = startup.elapsed().as_millis();
                match client_ping.call("ping", &serde_json::json!({})).await {
                    Ok(result) => {
                        let protocol = result["protocol"].as_u64().unwrap_or(0);
                        commands::api::log_backend_ready_fmt(&session_log, protocol, startup_ms);
                    }
                    Err(err) => {
                        tracing::warn!("ping inicial fallo: {err}");
                        eprintln!(
                            "[herdr-desk] backend connect error session={session_log} code={} (startup_ms={startup_ms})",
                            err.code()
                        );
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::api::herdr_call,
            commands::api::store_subscribe,
            commands::api::events_forward,
            commands::api::events_watch,
            commands::api::ui_ready,
            commands::session::session_list,
            commands::session::session_current,
            commands::session::session_connect,
            commands::session::session_start,
            commands::session::session_stop,
            commands::session::session_delete,
            commands::session::session_compat,
            commands::session::session_restart,
            commands::system::gui_defaults,
            commands::system::set_mica,
            commands::system::run_shell_command,
            commands::system::write_scratch_file,
            commands::system::git_status,
            commands::cli_run::cli_run,
            commands::cli_run::agent_kinds,
            commands::config::config_default,
            commands::config::config_read,
            commands::config::config_write,
            commands::config::config_reset_keys,
            commands::gui_settings::gui_settings_read,
            commands::gui_settings::gui_settings_write,
            commands::worktrees::worktree_list,
            commands::worktrees::worktree_create,
            commands::worktrees::worktree_open,
            commands::worktrees::worktree_remove,
            commands::server::server_status,
            commands::server::agent_manifests,
            commands::server::agent_manifests_reload,
            commands::integrations::integration_status,
            commands::integrations::integration_install,
            commands::integrations::integration_uninstall,
            commands::notifications::notification_show,
            commands::plugins::plugin_list,
            commands::plugins::plugin_enable,
            commands::plugins::plugin_disable,
            commands::plugins::plugin_unlink,
            commands::plugins::plugin_link,
            commands::plugins::plugin_action_list,
            commands::plugins::plugin_action_invoke,
            commands::plugins::plugin_logs,
            commands::plugins::plugin_pane_open,
            commands::plugins::plugin_pane_focus,
            commands::plugins::plugin_pane_close,
            commands::plugins::plugin_install_preview,
            commands::plugins::plugin_install,
            commands::api_catalog::api_catalog,
            tray::tray_update,
            overlay::taskbar_overlay,
            toast_identity::toast_identity,
            commands::terminal::terminal_open,
            commands::terminal::terminal_input,
            commands::terminal::terminal_input_bytes,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_scroll,
            commands::terminal::terminal_close,
            commands::terminal::terminal_release,
        ])
        .run(tauri::generate_context!())
        .expect("error while running herdr-desk");
}

/// Tarea de vigilancia del runtime activo (polling LOCAL, sin IO de red):
/// - detecta swaps de sesión (session_connect) y rearma la conexión S;
/// - cuando el snapshot cambia (server volvió tras caída), respawnea los bridges
///   que murieron por caída real (server_down) y actualiza S (make-before-break).
async fn runtime_watcher(state: Arc<state::AppState>) {
    let mut last_session = String::new();
    let mut last_panes: Vec<String> = Vec::new();
    let mut s_conn: Option<(
        Vec<String>,
        tokio::sync::oneshot::Sender<()>,
        tauri::async_runtime::JoinHandle<()>,
    )> = None;
    let mut pending_panes: Option<Vec<String>> = None;

    'outer: loop {
        let (rt, mut rx) = {
            let rt = state.current();
            let rx = rt.store.watch();
            (rt, rx)
        };

        if rt.session != last_session {
            if let Some((_, old, task)) = s_conn.take() {
                let _ = old.send(());
                drop(task);
            }
            last_panes.clear();
            pending_panes = None;
            last_session = rt.session.clone();
        }

        loop {
            tokio::time::sleep(Duration::from_millis(150)).await;

            // ¿cambió la sesión activa? (session_connect)
            if !Arc::ptr_eq(&state.current(), &rt) {
                if let Some((_, old, task)) = s_conn.take() {
                    let _ = old.send(());
                    drop(task);
                }
                continue 'outer;
            }

            if !rx.has_changed().unwrap_or(false) {
                continue;
            }
            let _ = rx.borrow_and_update();

            let raw = rt.store.snapshot();
            let snap: SessionSnapshot = match serde_json::from_str(&raw) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let panes: Vec<String> = snap.panes.iter().map(|p| p.pane_id.clone()).collect();

            // purga: panes inexistentes o cierres pedidos no se respawnean
            state.bridges.lock().unwrap().purge_non_respawnable(&panes);

            // respawn de bridges muertos por caida cuyo pane sigue vivo
            respawn_bridges(&state, &rt, &panes);

            // conexión S: solo si el conjunto de panes cambió (debounce: el tick
            // del watcher de 150 ms ya introduce la espera de 100 ms del plan)
            if panes != last_panes {
                pending_panes = Some(panes.clone());
            }
            if let Some(want) = pending_panes.take() {
                apply_s(&state, &rt, &want, &mut s_conn).await;
                last_panes = want;
            }
        }
    }
}

async fn apply_s(
    state: &Arc<state::AppState>,
    rt: &Arc<state::Runtime>,
    want: &[String],
    s_conn: &mut Option<(
        Vec<String>,
        tokio::sync::oneshot::Sender<()>,
        tauri::async_runtime::JoinHandle<()>,
    )>,
) {
    // make-before-break: abre la nueva; si falla, conserva la vieja
    match events::open_pane_subscription(rt.client.pipe().to_string(), want.to_vec()).await {
        Ok(sub) => {
            let herdr_core::events::PaneSubscription { rx, close } = sub;
            if let Some((_, old, task)) = s_conn.take() {
                let _ = old.send(());
                drop(task);
            }
            let state2 = state.clone();
            let task = tauri::async_runtime::spawn(async move {
                let mut rx = rx;
                while let Some(ev) = rx.recv().await {
                    state2.broadcast_event(&serde_json::to_string(&ev).unwrap_or_default());
                }
            });
            *s_conn = Some((want.to_vec(), close, task));
        }
        Err(err) => {
            tracing::warn!("no se pudo abrir conexion S: {err}");
        }
    }
}

pub(crate) fn respawn_bridges(
    state: &Arc<state::AppState>,
    rt: &Arc<state::Runtime>,
    panes: &[String],
) {
    let mut reg = state.bridges.lock().unwrap();
    // solo muertos por caida real (server_down); user_close/taken_over/etc no
    let dead: Vec<u32> = reg
        .bridges
        .iter()
        .filter(|(_, e)| e.respawnable() && panes.contains(&e.pane_id))
        .map(|(id, _)| *id)
        .collect();
    if dead.is_empty() {
        return;
    }
    // C1: con el server incompatible no se respawnea en bucle; los bridges
    // muertos quedan marcados server_incompatible (no respawnables) y la UI
    // muestra el error del panel y el banner.
    if state
        .cached_compat(&rt.session)
        .is_some_and(|compat| compat.incompatible())
    {
        for id in &dead {
            if let Some(entry) = reg.bridges.get_mut(id) {
                entry.dead_reason = Some(commands::terminal::CLOSE_SERVER_INCOMPATIBLE.to_string());
                entry.closing_since = None;
            }
        }
        tracing::warn!(
            "sesion {} incompatible: no se respawnean {} bridges",
            rt.session,
            dead.len()
        );
        return;
    }
    let exe = match herdr_core::paths::find_herdr_exe(None) {
        Some(e) => e,
        None => return,
    };
    for id in dead {
        let (pane_id, cols, rows, on_frame) = {
            let e = reg.bridges.get(&id).unwrap();
            (
                e.pane_id.clone(),
                e.last_cols,
                e.last_rows,
                e.on_frame.clone(),
            )
        };
        let spawn =
            herdr_core::terminal::spawn_bridge(&exe, Some(&rt.session), &pane_id, cols, rows);
        match spawn {
            Ok((bridge, rx)) => {
                tracing::info!(
                    "respawn de bridge {id} para {pane_id}; vivos: {:?}",
                    reg.alive_panes()
                );
                {
                    let entry = reg.bridges.get_mut(&id).unwrap();
                    entry.bridge = bridge;
                    entry.alive = true;
                    entry.closing_since = None;
                    entry.dead_reason = None;
                }
                let state2 = state.clone();
                tauri::async_runtime::spawn(async move {
                    commands::terminal::bridge_read_task(state2, id, rx, on_frame).await;
                });
            }
            Err(err) => {
                tracing::warn!("respawn de bridge {id} fallo: {err}");
            }
        }
    }
}

#[cfg(test)]
mod session_resolve_tests {
    use super::*;
    use herdr_core::cli::CliSessionInfo;

    fn info(name: &str, running: bool) -> CliSessionInfo {
        CliSessionInfo {
            name: name.to_string(),
            running,
            ..Default::default()
        }
    }

    #[test]
    fn selected_session_name_prefers_env_and_falls_back_to_default() {
        assert_eq!(selected_session_name(Some("dev".into())), "dev");
        assert_eq!(selected_session_name(Some(String::new())), "default");
        assert_eq!(selected_session_name(None), "default");
    }

    #[test]
    fn session_is_running_matches_name_and_flag() {
        let list = CliSessionList {
            sessions: vec![info("default", false), info("dev", true)],
        };
        assert!(!session_is_running(&list, "default"));
        assert!(session_is_running(&list, "dev"));
        assert!(!session_is_running(&list, "otra"));
    }

    #[test]
    fn wait_until_running_reintenta_hasta_running() {
        let mut calls = 0;
        let mut sleeps = 0;
        let result = wait_until_running(
            "dev",
            Duration::from_secs(5),
            || {
                calls += 1;
                Ok(CliSessionList {
                    sessions: vec![info("dev", calls >= 3)],
                })
            },
            |_| sleeps += 1,
        );
        assert!(result.is_ok());
        assert_eq!(calls, 3);
        assert_eq!(sleeps, 2, "duerme entre sondeos, no tras el acierto");
    }

    #[test]
    fn wait_until_running_tolera_errores_del_cli() {
        let mut calls = 0;
        let result = wait_until_running(
            "dev",
            Duration::from_secs(5),
            || {
                calls += 1;
                if calls == 1 {
                    Err(herdr_core::error::HerdrError::Api {
                        code: "cli_failed".into(),
                        message: "aun arrancando".into(),
                    })
                } else {
                    Ok(CliSessionList {
                        sessions: vec![info("dev", true)],
                    })
                }
            },
            |_| {},
        );
        assert!(result.is_ok());
        assert_eq!(calls, 2);
    }

    #[test]
    fn wait_until_running_falla_al_vencer_el_plazo() {
        let result = wait_until_running(
            "dev",
            Duration::ZERO,
            || Ok(CliSessionList::default()),
            |_| {},
        );
        let err = result.expect_err("debe vencer sin running");
        assert!(err.contains("dev"), "mensaje con la sesion: {err}");
    }
}
