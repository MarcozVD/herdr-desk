use std::time::{Duration, Instant};

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

use crate::state::AppState;
use herdr_core::error::ApiError;
use herdr_core::terminal::{self, BridgeEvent, ScrollDir};

use base64::Engine;

const CLOSE_GRACE: Duration = Duration::from_secs(3);

#[tauri::command]
pub async fn terminal_open(
    app: AppHandle,
    pane_id: String,
    cols: u16,
    rows: u16,
    on_frame: Channel<InvokeResponseBody>,
) -> Result<u32, ApiError> {
    let state = app.state::<crate::state::AppState>();
    let session = state.current().session.clone();
    let exe = herdr_core::paths::find_herdr_exe(None).ok_or_else(|| ApiError {
        code: "cli_failed".to_string(),
        message: "no se encontro el ejecutable herdr".to_string(),
    })?;
    let (bridge, mut rx) = terminal::spawn_bridge(&exe, Some(&session), &pane_id, cols, rows)
        .map_err(|e| ApiError {
            code: "bridge_closed".to_string(),
            message: format!("no se pudo abrir la terminal: {e}"),
        })?;

    let bridge_id = {
        let mut reg = state.bridges.lock().unwrap();
        // si ya habia un bridge muerto para el mismo pane, se limpia
        reg.bridges.retain(|_, e| e.alive || e.pane_id != pane_id);
        reg.insert(bridge, pane_id, on_frame.clone(), cols, rows)
    };

    let app2 = app.clone();
    let pane_for_task = state
        .bridges
        .lock()
        .unwrap()
        .bridges
        .get(&bridge_id)
        .map(|e| e.pane_id.clone())
        .unwrap_or_default();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            let payload = match &event {
                BridgeEvent::Frame {
                    seq,
                    width,
                    height,
                    full,
                    bytes,
                } => herdr_core::frame::encode_frame(*seq, *width, *height, *full, bytes),
                BridgeEvent::Closed(reason) => herdr_core::frame::encode_closed(reason),
            };
            if let BridgeEvent::Frame { width, height, .. } = event {
                // recordamos el último tamaño para el respawn
                let st = app2.state::<crate::state::AppState>();
                if let Some(e) = st.bridges.lock().unwrap().bridges.get_mut(&bridge_id) {
                    e.last_cols = width;
                    e.last_rows = height;
                }
            }
            if on_frame.send(InvokeResponseBody::Raw(payload)).is_err() {
                break;
            }
        }
        // bridge muerto: la entrada queda con pane_id para respawn automático
        let st = app2.state::<crate::state::AppState>();
        if let Some(entry) = st.bridges.lock().unwrap().bridges.get_mut(&bridge_id) {
            entry.alive = false;
            entry.closing_since = None;
        }
        let _ = pane_for_task;
    });

    Ok(bridge_id)
}

#[tauri::command]
pub async fn terminal_input(
    state: State<'_, AppState>,
    bridge_id: u32,
    data: String,
) -> Result<(), ApiError> {
    let bridge = get_alive_bridge(&state, bridge_id)?;
    bridge.input_text(&data);
    Ok(())
}

#[tauri::command]
pub async fn terminal_input_bytes(
    state: State<'_, AppState>,
    bridge_id: u32,
    b64: String,
) -> Result<(), ApiError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.as_bytes())
        .map_err(|e| ApiError {
            code: "invalid_params".to_string(),
            message: format!("base64 invalido: {e}"),
        })?;
    let bridge = get_alive_bridge(&state, bridge_id)?;
    bridge.input_bytes(&bytes);
    Ok(())
}

#[tauri::command]
pub async fn terminal_resize(
    state: State<'_, AppState>,
    bridge_id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), ApiError> {
    let bridge = get_alive_bridge(&state, bridge_id)?;
    bridge.resize(cols, rows);
    Ok(())
}

#[tauri::command]
pub async fn terminal_scroll(
    state: State<'_, AppState>,
    bridge_id: u32,
    direction: String,
    lines: u16,
) -> Result<(), ApiError> {
    let dir = match direction.as_str() {
        "up" => ScrollDir::Up,
        "down" => ScrollDir::Down,
        other => {
            return Err(ApiError {
                code: "invalid_params".to_string(),
                message: format!("direccion invalida: {other}"),
            });
        }
    };
    let bridge = get_alive_bridge(&state, bridge_id)?;
    bridge.scroll(dir, lines);
    Ok(())
}

/// Cierra con gracia de 3 s: el bridge sigue aceptando input mientras tanto;
/// a los 3 s se hace release real y la entrada queda muerta (respawnable).
#[tauri::command]
pub async fn terminal_close(app: AppHandle, bridge_id: u32) -> Result<(), ApiError> {
    {
        let state = app.state::<crate::state::AppState>();
        let mut reg = state.bridges.lock().unwrap();
        match reg.bridges.get_mut(&bridge_id) {
            Some(entry) if entry.alive => entry.closing_since = Some(Instant::now()),
            _ => return Ok(()),
        }
    }
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(CLOSE_GRACE).await;
        let state = app2.state::<crate::state::AppState>();
        let mut reg = state.bridges.lock().unwrap();
        if let Some(entry) = reg.bridges.get_mut(&bridge_id)
            && let Some(since) = entry.closing_since
            && since.elapsed() >= CLOSE_GRACE - Duration::from_millis(100)
        {
            entry.bridge.release();
            entry.alive = false;
        }
    });
    Ok(())
}

fn get_alive_bridge(
    state: &State<'_, AppState>,
    bridge_id: u32,
) -> Result<herdr_core::terminal::Bridge, ApiError> {
    let reg = state.bridges.lock().unwrap();
    match reg.bridges.get(&bridge_id) {
        Some(entry) if entry.alive && entry.closing_since.is_none() => Ok(entry.bridge.clone()),
        Some(_) => Err(ApiError {
            code: "bridge_closed".to_string(),
            message: "la terminal esta cerrandose; re-abre el pane".to_string(),
        }),
        None => Err(ApiError {
            code: "bridge_closed".to_string(),
            message: "la terminal ya no existe".to_string(),
        }),
    }
}
