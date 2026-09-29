use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::State;

use crate::state::{AppState, Runtime};
use herdr_core::cli::{self, CliSessionList, ServerCompat};
use herdr_core::{ApiError, RpcClient, Store};

#[tauri::command]
pub async fn session_list() -> Result<CliSessionList, ApiError> {
    cli::session_list().map_err(|e| e.api())
}

/// Sesión activa del backend (la del runtime actual). El frontend la usa en
/// bootstrap para el selector y para "Iniciar servidor" sin nombre vacío.
#[tauri::command]
pub async fn session_current(
    state: State<'_, std::sync::Arc<AppState>>,
) -> Result<String, ApiError> {
    Ok(state.current().session.clone())
}

/// Espera (15 s) a que la sesión quede `running`; comparten `session_start` y
/// `session_restart`.
async fn wait_running(name: &str) -> Result<(), ApiError> {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if Instant::now() > deadline {
            return Err(ApiError {
                code: "timeout".to_string(),
                message: format!("la sesion {name} no quedo corriendo en 15 s"),
            });
        }
        match cli::session_list() {
            Ok(list) if list.sessions.iter().any(|s| s.name == name && s.running) => return Ok(()),
            _ => tokio::time::sleep(Duration::from_millis(300)).await,
        }
    }
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
    wait_running(&name).await
}

/// C1 — Compatibilidad cliente/servidor de una sesión (la activa si no se pasa
/// nombre). La cachea para `terminal_open` y el respawn.
#[tauri::command]
pub async fn session_compat(
    state: State<'_, Arc<AppState>>,
    name: Option<String>,
) -> Result<ServerCompat, ApiError> {
    let name = match name {
        Some(n) if !n.trim().is_empty() => n,
        _ => state.current().session.clone(),
    };
    let compat = cli::server_status(&name).map_err(|e| e.api())?;
    state.set_compat(&name, compat.clone());
    Ok(compat)
}

/// C1 — Reinicia una sesión: stop (si corre) + arranque detached + espera
/// `running`. MATA los procesos de todos sus paneles, por eso `default` exige
/// `confirm: true` (el frontend lo pide en su diálogo de confirmación).
#[tauri::command]
pub async fn session_restart(
    state: State<'_, Arc<AppState>>,
    name: String,
    confirm: bool,
) -> Result<ServerCompat, ApiError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError {
            code: "invalid_params".to_string(),
            message: "sesion vacia para reiniciar".to_string(),
        });
    }
    if name == "default" && !confirm {
        return Err(ApiError {
            code: "invalid_params".to_string(),
            message: "reiniciar la sesion default requiere confirmacion explicita (confirm: true)"
                .to_string(),
        });
    }
    let running = cli::session_list()
        .map_err(|e| e.api())?
        .sessions
        .iter()
        .any(|s| s.name == name && s.running);
    if running {
        let out = cli::stop_session(&name).map_err(|e| e.api())?;
        if !out.ok() {
            return Err(ApiError {
                code: "cli_failed".to_string(),
                message: format!("herdr session stop fallo: {}", out.stderr.trim()),
            });
        }
    }
    cli::start_server_detached(&name).map_err(|e| e.api())?;
    wait_running(&name).await?;
    let compat = cli::server_status(&name).map_err(|e| e.api())?;
    state.set_compat(&name, compat.clone());
    Ok(compat)
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct SessionConnected {
    pub session: String,
    /// C1 — Compatibilidad del server recién conectado (`None` si el CLI falló:
    /// la conexión no se tumba por no poder leer el status).
    pub compat: Option<ServerCompat>,
}

#[tauri::command]
pub async fn session_connect(
    state: State<'_, std::sync::Arc<AppState>>,
    name: Option<String>,
) -> Result<SessionConnected, ApiError> {
    connect_session(state.inner(), name).await
}

/// Lógica testeable del cambio de sesión. Extensión documentada del §5: la
/// respuesta incluye la sesión activa para que el frontend descarte snapshots
/// de sesiones anteriores (los params no cambian).
pub async fn connect_session(
    state: &std::sync::Arc<AppState>,
    name: Option<String>,
) -> Result<SessionConnected, ApiError> {
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
    // verifica vivo antes de swap (ping contra la sesion nueva)
    client
        .call("ping", &Value::Object(Default::default()))
        .await
        .map_err(|e| e.api())?;

    let store = Arc::new(Store::new());
    // kick temprano: aunque el refresher ya hace fetch inicial, garantiza un refresh
    // en cuanto arranca sin depender de eventos
    store.kick();
    let client2 = client.clone();
    let store2 = store.clone();
    tauri::async_runtime::spawn(store2.refresher_task(client2));

    // C1: compatibilidad del server destino (la conexion no falla si el CLI no
    // puede responder; la UI pedira `session_compat`). Debe leerse antes del
    // swap, que limpia la cache, y guardarse despues.
    let compat = cli::server_status(&name).ok();

    // swap coherente: cierra el store viejo (refresher + suscripciones mueren),
    // libera y purga TODOS los bridges de la sesion anterior
    state.swap(Runtime {
        session: name.clone(),
        client,
        store,
    });
    if let Some(value) = &compat {
        state.set_compat(&name, value.clone());
    }
    Ok(SessionConnected {
        session: name,
        compat,
    })
}

#[tauri::command]
pub async fn session_stop(
    state: State<'_, std::sync::Arc<AppState>>,
    name: String,
) -> Result<(), ApiError> {
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
pub async fn session_delete(
    state: State<'_, std::sync::Arc<AppState>>,
    name: String,
) -> Result<(), ApiError> {
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
