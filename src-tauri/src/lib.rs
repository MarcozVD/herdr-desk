pub mod commands;
pub mod state;
mod window;

#[cfg(all(test, feature = "sandbox"))]
mod sandbox_guard;
#[cfg(all(test, feature = "sandbox"))]
mod terminal_cycle_tests;

use std::sync::Arc;
use std::time::{Duration, Instant};

use herdr_core::model::SessionSnapshot;
use herdr_core::{RpcClient, Store, events};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    // La sesion es explicita: HERDR_DESK_SESSION. Nunca HERDR_* heredada (D10).
    let session = match std::env::var("HERDR_DESK_SESSION") {
        Ok(s) if !s.is_empty() => s,
        _ => {
            eprintln!(
                "[herdr-desk] error: falta HERDR_DESK_SESSION. Solo se corre contra una sesion explicita (ej. herdr-desk-dev)."
            );
            std::process::exit(1);
        }
    };

    let pipe = herdr_core::paths::pipe_name(&herdr_core::paths::session_socket(&session));
    let startup = Instant::now();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(move |app| {
            let session = session.clone();
            let client = Arc::new(RpcClient::new(pipe.clone()));
            let store = Arc::new(Store::new());
            tauri::async_runtime::spawn(store.refresher_task(client.clone()));
            let state_arc = Arc::new(state::AppState::new(state::Runtime {
                session: session.clone(),
                client: client.clone(),
                store,
            }));
            app.manage(state_arc.clone());

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
            commands::api::ui_ready,
            commands::session::session_list,
            commands::session::session_current,
            commands::session::session_connect,
            commands::session::session_start,
            commands::session::session_stop,
            commands::session::session_delete,
            commands::system::gui_defaults,
            commands::terminal::terminal_open,
            commands::terminal::terminal_input,
            commands::terminal::terminal_input_bytes,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_scroll,
            commands::terminal::terminal_close,
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

fn respawn_bridges(state: &Arc<state::AppState>, rt: &Arc<state::Runtime>, panes: &[String]) {
    let exe = match herdr_core::paths::find_herdr_exe(None) {
        Some(e) => e,
        None => return,
    };
    let mut reg = state.bridges.lock().unwrap();
    // solo muertos por caida real (server_down); user_close/taken_over/etc no
    let dead: Vec<u32> = reg
        .bridges
        .iter()
        .filter(|(_, e)| e.respawnable() && panes.contains(&e.pane_id))
        .map(|(id, _)| *id)
        .collect();
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
