use serde_json::Value;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, State};

use crate::state::AppState;
use herdr_core::ApiError;
use herdr_core::cli;

#[tauri::command]
pub async fn herdr_call(
    state: State<'_, AppState>,
    method: String,
    params: Value,
) -> Result<Value, ApiError> {
    let client = state.client.clone();
    client.call(&method, &params).await.map_err(|e| e.api())
}

#[tauri::command]
pub async fn store_subscribe(
    state: State<'_, AppState>,
    on_msg: Channel<InvokeResponseBody>,
) -> Result<(), ApiError> {
    let mut rx = state.store.watch();
    let _ = on_msg.send(InvokeResponseBody::Json(state.store.snapshot().to_string()));
    tauri::async_runtime::spawn(async move {
        loop {
            if rx.changed().await.is_err() {
                return;
            }
            let snap = rx.borrow().clone();
            let _ = on_msg.send(InvokeResponseBody::Json(snap.to_string()));
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn session_list() -> Result<cli::CliSessionList, ApiError> {
    cli::session_list().map_err(|e| e.api())
}

#[tauri::command]
pub async fn ui_ready(app: AppHandle, state: State<'_, AppState>) -> Result<(), ApiError> {
    let session = state.session.clone();
    if let Err(err) = crate::window::show_main(&app) {
        tracing::warn!("no se pudo mostrar la ventana: {err}");
    }
    println!("[herdr-desk] ready session={session} stage=ui");
    Ok(())
}

/// Boot log del backend, lo espera scripts/smoke.ps1.
pub fn log_backend_ready_fmt(session: &str, protocol: u64, startup_ms: u128) {
    println!("[herdr-desk] ready session={session} protocol={protocol} startup_ms={startup_ms}");
}
