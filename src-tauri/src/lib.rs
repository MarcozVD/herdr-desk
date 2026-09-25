mod commands;
mod state;
mod window;

use std::sync::Arc;
use std::time::Instant;

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

    // F0: la sesion sandbox es obligatoria (D10); la elegimos explicita, nunca HERDR_* heredada.
    let session = match std::env::var("HERDR_DESK_SESSION") {
        Ok(s) if !s.is_empty() => s,
        _ => {
            eprintln!(
                "[herdr-desk] error: falta HERDR_DESK_SESSION. En F0 solo se corre contra la sesion sandbox (herdr-desk-dev)."
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
        .setup(move |app| {
            let session = session.clone();
            let client = Arc::new(RpcClient::new(pipe.clone()));
            let store = Store::new();
            tauri::async_runtime::spawn(store.refresher_task(client.clone()));
            app.manage(state::AppState::new(session.clone(), client.clone(), store));

            // L: eventos globales → coalescing del snapshot
            let (ev_tx, mut ev_rx) = tokio::sync::mpsc::channel(1024);
            let pipe_events = pipe.clone();
            let kick = app.state::<state::AppState>().store.kick_handle();
            tauri::async_runtime::spawn(async move {
                events::run(pipe_events, ev_tx, kick).await;
            });
            tauri::async_runtime::spawn(async move {
                while let Some(ev) = ev_rx.recv().await {
                    tracing::debug!("evento: {}", ev.event);
                }
            });

            // ping inicial: verifica protocolo y loguea backend ready
            let client_ping = client.clone();
            let session_log = session.clone();
            let handle = app.handle().clone();
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
                let _ = handle;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::api::herdr_call,
            commands::api::store_subscribe,
            commands::api::session_list,
            commands::api::ui_ready,
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
