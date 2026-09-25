use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::State;

use crate::state::{AppState, Runtime};
use herdr_core::cli::{self, CliSessionList};
use herdr_core::{ApiError, RpcClient, Store};

#[tauri::command]
pub async fn session_list() -> Result<CliSessionList, ApiError> {
    cli::session_list().map_err(|e| e.api())
}

#[tauri::command]
pub async fn session_start(name: String) -> Result<(), ApiError> {
    // sandbox guard: solo sesiones de desarrollo (D10); default se prohibe para start/stop
    if name == "default" {
        return Err(ApiError {
            code: "invalid_params".to_string(),
            message: "no se permite iniciar la sesion default desde la GUI".to_string(),
        });
    }
    cli::start_server_detached(&name).map_err(|e| e.api())?;

    // esperar a que quede running (15 s)
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if Instant::now() > deadline {
            return Err(ApiError {
                code: "timeout".to_string(),
                message: format!("la sesion {name} no quedo corriendo en 15 s"),
            });
        }
        match cli::session_list() {
            Ok(list)
                if list
                    .sessions
                    .iter()
                    .any(|s| s.name == name && s.running) =>
            {
                return Ok(())
            }
            _ => tokio::time::sleep(Duration::from_millis(300)).await,
        }
    }
}

#[tauri::command]
pub async fn session_connect(
    state: State<'_, AppState>,
    name: Option<String>,
) -> Result<(), ApiError> {
    let name = match name {
        Some(n) if !n.is_empty() => n,
        // sin nombre: ultima guardada (settings GUI, F3); por ahora default
        None => "default".to_string(),
        _ => "default".to_string(),
    };

    // la sesion debe existir y estar running
    let list = cli::session_list().map_err(|e| e.api())?;
    let info = list
        .sessions
        .iter()
        .find(|s| s.name == name)
        .ok_or_else(|| ApiError {
            code: "not_found".to_string(),
            message: format!("la sesion {name} no existe"),
        })?;
    if !info.running {
        return Err(ApiError {
            code: "not_connected".to_string(),
            message: format!("la sesion {name} no esta corriendo"),
        });
    }

    let pipe = herdr_core::paths::pipe_name(&herdr_core::paths::session_socket(&name));
    let client = Arc::new(RpcClient::new(pipe));
    // verifica vivo antes de swap
    client
        .call("ping", &Value::Object(Default::default()))
        .await
        .map_err(|e| e.api())?;

    let store = Arc::new(Store::new());
    let client2 = client.clone();
    tauri::async_runtime::spawn(store.refresher_task(client2));

    state.swap(Runtime {
        session: name,
        client,
        store,
    });
    Ok(())
}

#[tauri::command]
pub async fn session_stop(state: State<'_, AppState>, name: String) -> Result<(), ApiError> {
    if name == "default" {
        return Err(ApiError {
            code: "invalid_params".to_string(),
            message: "detener la sesion default desde la GUI esta deshabilitado".to_string(),
        });
    }
    let active = state.current().session.clone();
    if active == name {
        // si es la sesión activa: la GUI decide qué hacer luego; aquí solo detenemos
    }
    let out = cli::stop_session(&name).map_err(|e| e.api())?;
    if !out.ok() {
        return Err(ApiError {
            code: "cli_failed".to_string(),
            message: format!("herdr session stop fallo: {}", out.stderr.trim()),
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn session_delete(state: State<'_, AppState>, name: String) -> Result<(), ApiError> {
    let active = state.current().session.clone();
    if active == name {
        return Err(ApiError {
            code: "invalid_params".to_string(),
            message: "no se puede borrar la sesion activa; conecta a otra antes".to_string(),
        });
    }
    let out = cli::delete_session(&name).map_err(|e| e.api())?;
    if !out.ok() {
        return Err(ApiError {
            code: "cli_failed".to_string(),
            message: format!("herdr session delete fallo: {}", out.stderr.trim()),
        });
    }
    Ok(())
}
