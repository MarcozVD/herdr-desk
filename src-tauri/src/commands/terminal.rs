use tauri::State;
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::state::AppState;
use herdr_core::error::ApiError;
use herdr_core::terminal::{self, BridgeEvent, ScrollDir};

use base64::Engine;

#[tauri::command]
pub async fn terminal_open(
    state: State<'_, AppState>,
    pane_id: String,
    cols: u16,
    rows: u16,
    on_frame: Channel<InvokeResponseBody>,
) -> Result<u32, ApiError> {
    let exe = herdr_core::paths::find_herdr_exe(None).ok_or_else(|| ApiError {
        code: "cli_failed".to_string(),
        message: "no se encontro el ejecutable herdr".to_string(),
    })?;
    let session = state.session.clone();
    let (bridge, mut rx) = terminal::spawn_bridge(&exe, Some(&session), &pane_id, cols, rows)
        .map_err(|e| ApiError {
            code: "bridge_closed".to_string(),
            message: format!("no se pudo abrir la terminal: {e}"),
        })?;

    let bridge_id = state.bridges.lock().unwrap().insert(bridge);

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            let payload = match event {
                BridgeEvent::Frame {
                    seq,
                    width,
                    height,
                    full,
                    bytes,
                } => herdr_core::frame::encode_frame(seq, width, height, full, &bytes),
                BridgeEvent::Closed(reason) => herdr_core::frame::encode_closed(&reason),
            };
            if on_frame.send(InvokeResponseBody::Raw(payload)).is_err() {
                break;
            }
        }
    });

    Ok(bridge_id)
}

#[tauri::command]
pub async fn terminal_input(
    state: State<'_, AppState>,
    bridge_id: u32,
    data: String,
) -> Result<(), ApiError> {
    let bridge = state
        .bridges
        .lock()
        .unwrap()
        .bridges
        .get(&bridge_id)
        .cloned()
        .ok_or_else(|| ApiError {
            code: "bridge_closed".to_string(),
            message: "la terminal ya no existe".to_string(),
        })?;
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
    let bridge = state
        .bridges
        .lock()
        .unwrap()
        .bridges
        .get(&bridge_id)
        .cloned()
        .ok_or_else(|| ApiError {
            code: "bridge_closed".to_string(),
            message: "la terminal ya no existe".to_string(),
        })?;
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
    let bridge = take_bridge(&state, bridge_id)?;
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
    let bridge = take_bridge(&state, bridge_id)?;
    bridge.scroll(dir, lines);
    Ok(())
}

#[tauri::command]
pub async fn terminal_close(state: State<'_, AppState>, bridge_id: u32) -> Result<(), ApiError> {
    let bridge = state.bridges.lock().unwrap().bridges.remove(&bridge_id);
    if let Some(bridge) = bridge {
        bridge.release();
    }
    Ok(())
}

fn take_bridge(
    state: &State<'_, AppState>,
    bridge_id: u32,
) -> Result<herdr_core::terminal::Bridge, ApiError> {
    state
        .bridges
        .lock()
        .unwrap()
        .bridges
        .get(&bridge_id)
        .cloned()
        .ok_or_else(|| ApiError {
            code: "bridge_closed".to_string(),
            message: "la terminal ya no existe".to_string(),
        })
}
