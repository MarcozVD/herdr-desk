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

/// T4.5 — Visor de eventos de la consola: suscripción temporal a los tipos
/// globales elegidos, reenviada por el canal mientras el frontend la mantenga.
///
/// T4e — Devuelve un id para cerrarla explícitamente con `events_unwatch`; antes
/// el backend solo cortaba cuando fallaba `on_evt.send()`.
#[tauri::command]
pub async fn events_watch(
    state: State<'_, std::sync::Arc<AppState>>,
    types: Vec<String>,
    on_evt: Channel<InvokeResponseBody>,
) -> Result<u64, ApiError> {
    if types.is_empty() {
        return Err(ApiError {
            code: "invalid_params".to_string(),
            message: "sin tipos de evento que escuchar".to_string(),
        });
    }
    let pipe = state.current().client.pipe().to_string();
    let herdr_core::events::PaneSubscription { rx, close } =
        herdr_core::events::open_event_subscription(pipe, types)
            .await
            .map_err(|e| e.api())?;
    let (watch_id, cancel) = state.event_watches.lock().unwrap().open();
    let state = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        let _close = close;
        let mut rx = rx;
        let mut cancel = std::pin::pin!(cancel);
        loop {
            tokio::select! {
                maybe = rx.recv() => {
                    let Some(event) = maybe else { break };
                    let line = serde_json::to_string(&event).unwrap_or_default();
                    if on_evt.send(InvokeResponseBody::Json(line)).is_err() {
                        break;
                    }
                }
                _ = &mut cancel => break,
            }
        }
        state.event_watches.lock().unwrap().finish(watch_id);
    });
    Ok(watch_id)
}

/// T4e — Cierra una suscripción de `events_watch` por id. Es idempotente: un id
/// ya cerrado no es error.
#[tauri::command]
pub async fn events_unwatch(
    state: State<'_, std::sync::Arc<AppState>>,
    watch_id: u64,
) -> Result<(), ApiError> {
    state.event_watches.lock().unwrap().close(watch_id);
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
