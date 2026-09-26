use serde_json::Value;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, State};

use crate::state::AppState;
use herdr_core::ApiError;

#[tauri::command]
pub async fn herdr_call(
    state: State<'_, std::sync::Arc<AppState>>,
    method: String,
    params: Value,
) -> Result<Value, ApiError> {
    let client = state.current().client.clone();
    client.call(&method, &params).await.map_err(|e| e.api())
}

/// Reenvía el snapshot crudo del store de la sesión ACTIVA. Si el frontend
/// reconecta (session_connect), debe volver a suscribirse: la suscripción
/// anterior se cancela de verdad (su tarea termina y sus mensajes se descartan).
#[tauri::command]
pub async fn store_subscribe(
    state: State<'_, std::sync::Arc<AppState>>,
    on_msg: Channel<InvokeResponseBody>,
) -> Result<(), ApiError> {
    subscribe_store(state.inner().clone(), on_msg);
    Ok(())
}

/// Lógica testeable de la suscripción al store. Registra la suscripción nueva
/// (rotando la anterior: su tarea muere por el token de cancelación aunque este
/// command ya haya devuelto Ok) y lanza la tarea de reenvío.
pub fn subscribe_store(state: std::sync::Arc<AppState>, on_msg: Channel<InvokeResponseBody>) {
    let (generation, cancel) = state.store_subs.lock().unwrap().rotate();
    let runtime = state.current();
    let mut rx = runtime.store.watch();
    let _ = on_msg.send(InvokeResponseBody::Json(
        runtime.store.snapshot().to_string(),
    ));
    tauri::async_runtime::spawn(async move {
        let mut cancel = std::pin::pin!(cancel.notified());
        loop {
            tokio::select! {
                changed = rx.changed() => {
                    if changed.is_err() {
                        return;
                    }
                    let snap = rx.borrow().clone();
                    if on_msg
                        .send(InvokeResponseBody::Json(snap.to_string()))
                        .is_err()
                    {
                        return;
                    }
                }
                _ = &mut cancel => {
                    // suscripcion obsoleta: se cierra de verdad y nada mas sale
                    tracing::debug!("store subscription gen {generation} cancelada");
                    return;
                }
            }
        }
    });
}

/// Canal de eventos (conexión S + eventos de sesión) para el frontend.
#[tauri::command]
pub async fn events_forward(
    state: State<'_, std::sync::Arc<AppState>>,
    on_evt: Channel<InvokeResponseBody>,
) -> Result<(), ApiError> {
    state.subscribe_events(on_evt);
    Ok(())
}

#[tauri::command]
pub async fn ui_ready(
    app: AppHandle,
    state: State<'_, std::sync::Arc<AppState>>,
) -> Result<(), ApiError> {
    let session = state.current().session.clone();
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
