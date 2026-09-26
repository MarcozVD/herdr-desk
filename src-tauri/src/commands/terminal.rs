use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::State;
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::state::{AppState, BridgeRegistry};
use herdr_core::error::ApiError;
use herdr_core::terminal::{self, Bridge, BridgeEvent, ScrollDir};

use base64::Engine;

pub const CLOSE_GRACE: Duration = Duration::from_secs(3);
const CLOSE_GRACE_TOLERANCE: Duration = Duration::from_millis(100);

// Motivos de cierre ESTABLES (contrato con el frontend). SOLO server_down es
// caida real; cualquier otro motivo no debe tumbar la sesion.
pub const CLOSE_USER_CLOSE: &str = "user_close";
pub const CLOSE_TAKEN_OVER: &str = "taken_over";
pub const CLOSE_RELEASED: &str = "released";
pub const CLOSE_PANE_CLOSED: &str = "pane_closed";
pub const CLOSE_SERVER_DOWN: &str = "server_down";
pub const CLOSE_UNKNOWN_PREFIX: &str = "unknown:";

/// Normaliza el motivo crudo del server / del bridge a los motivos estables.
/// - None: el proceso bridge termino sin terminal.closed (EOF/crash) -> caida real.
/// - "detached": despegue normal de la sesion de terminal -> released.
/// - "...taken over...": otra conexion tomo el pane -> taken_over.
/// - pane closed/exited: el pane se cerro -> pane_closed.
/// - cualquier otro texto del server -> "unknown:<texto>" (NO caida).
pub fn normalize_close_reason(server_reason: Option<&str>) -> String {
    match server_reason {
        None => CLOSE_SERVER_DOWN.to_string(),
        Some(r) => {
            let low = r.to_ascii_lowercase();
            if low.contains("taken over") {
                CLOSE_TAKEN_OVER.to_string()
            } else if low.contains("pane closed") || low.contains("pane exited") {
                CLOSE_PANE_CLOSED.to_string()
            } else if low.contains("detached") {
                CLOSE_RELEASED.to_string()
            } else {
                format!("{CLOSE_UNKNOWN_PREFIX}{r}")
            }
        }
    }
}

/// Politica de apertura determinista: purga muertas del pane, reutiliza el bridge
/// vivo si existe (cancela la gracia y actualiza el canal) o crea uno nuevo.
/// Garantia: como maximo UN bridge vivo por pane.
/// Devuelve el id y, si se creo uno nuevo, el receiver para la tarea de lectura.
pub fn open_bridge_in_registry(
    reg: &mut BridgeRegistry,
    pane_id: &str,
    cols: u16,
    rows: u16,
    on_frame: Channel<InvokeResponseBody>,
    spawn: impl FnOnce() -> std::io::Result<(Bridge, tokio::sync::mpsc::UnboundedReceiver<BridgeEvent>)>,
) -> Result<
    (
        u32,
        Option<tokio::sync::mpsc::UnboundedReceiver<BridgeEvent>>,
    ),
    ApiError,
> {
    reg.purge_dead_for_pane(pane_id);
    if let Some(id) = reg.find_alive_by_pane(pane_id) {
        let entry = reg.bridges.get_mut(&id).unwrap();
        entry.closing_since = None;
        entry.on_frame = on_frame;
        return Ok((id, None));
    }
    let (bridge, rx) = spawn().map_err(|e| ApiError {
        code: "bridge_closed".to_string(),
        message: format!("no se pudo abrir la terminal: {e}"),
    })?;
    let id = reg.insert(bridge, pane_id.to_string(), on_frame, cols, rows);
    Ok((id, Some(rx)))
}

/// Aplica el cierre pendiente si ya expiro la gracia. Devuelve el canal para emitir
/// `user_close` y el bridge para release, si expiro.
pub fn finalize_close_if_expired(
    reg: &mut BridgeRegistry,
    bridge_id: u32,
) -> Option<(Channel<InvokeResponseBody>, Bridge)> {
    let expired = match reg.bridges.get(&bridge_id) {
        Some(e) if e.alive => e
            .closing_since
            .map(|s| s.elapsed() >= CLOSE_GRACE - CLOSE_GRACE_TOLERANCE)
            .unwrap_or(false),
        _ => return None,
    };
    if !expired {
        return None;
    }
    let entry = reg.bridges.get_mut(&bridge_id)?;
    entry.alive = false;
    entry.dead_reason = Some(CLOSE_USER_CLOSE.to_string());
    entry.closing_since = None;
    Some((entry.on_frame.clone(), entry.bridge.clone()))
}

/// Tarea de lectura de un bridge: normaliza motivos, marca la entrada muerta con
/// motivo estable una sola vez y suprime todo trafico posterior al cierre.
pub async fn bridge_read_task(
    state: Arc<AppState>,
    bridge_id: u32,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<BridgeEvent>,
    on_frame: Channel<InvokeResponseBody>,
) {
    while let Some(event) = rx.recv().await {
        // si la entrada ya esta muerta (cierre ya notificado), no enviar nada mas
        {
            let alive = state
                .bridges
                .lock()
                .unwrap()
                .bridges
                .get(&bridge_id)
                .map(|e| e.alive)
                .unwrap_or(false);
            if !alive {
                continue;
            }
        }
        let (payload, close_reason): (Vec<u8>, Option<String>) = match &event {
            BridgeEvent::Frame {
                seq,
                width,
                height,
                full,
                bytes,
            } => (
                herdr_core::frame::encode_frame(*seq, *width, *height, *full, bytes),
                None,
            ),
            BridgeEvent::Closed(reason) => (
                herdr_core::frame::encode_closed(&normalize_close_reason(Some(reason))),
                Some(normalize_close_reason(Some(reason))),
            ),
        };
        if let BridgeEvent::Frame { width, height, .. } = event {
            // recordamos el último tamaño para el respawn
            if let Some(e) = state.bridges.lock().unwrap().bridges.get_mut(&bridge_id) {
                e.last_cols = width;
                e.last_rows = height;
            }
        }
        if let Some(reason) = close_reason {
            let already_notified = {
                let mut reg = state.bridges.lock().unwrap();
                match reg.bridges.get_mut(&bridge_id) {
                    Some(e) if e.alive => {
                        e.alive = false;
                        e.dead_reason = Some(reason.clone());
                        false
                    }
                    _ => true,
                }
            };
            if already_notified {
                continue;
            }
        }
        if on_frame.send(InvokeResponseBody::Raw(payload)).is_err() {
            break;
        }
    }
    // EOF sin terminal.closed: caida real (server_down)
    let already_notified = {
        let mut reg = state.bridges.lock().unwrap();
        match reg.bridges.get_mut(&bridge_id) {
            Some(e) if e.alive => {
                e.alive = false;
                e.dead_reason = Some(CLOSE_SERVER_DOWN.to_string());
                e.closing_since = None;
                false
            }
            _ => true,
        }
    };
    if !already_notified {
        // el canal del frontend recibe el motivo estable aunque el stream muera
        let _ = on_frame.send(InvokeResponseBody::Raw(herdr_core::frame::encode_closed(
            CLOSE_SERVER_DOWN,
        )));
    }
}

#[tauri::command]
pub async fn terminal_open(
    state: State<'_, Arc<AppState>>,
    pane_id: String,
    cols: u16,
    rows: u16,
    on_frame: Channel<InvokeResponseBody>,
) -> Result<u32, ApiError> {
    let state = state.inner().clone();
    let session = state.current().session.clone();
    let exe = herdr_core::paths::find_herdr_exe(None).ok_or_else(|| ApiError {
        code: "cli_failed".to_string(),
        message: "no se encontro el ejecutable herdr".to_string(),
    })?;

    let (bridge_id, rx) = open_bridge_in_registry(
        &mut state.bridges.lock().unwrap(),
        &pane_id,
        cols,
        rows,
        on_frame.clone(),
        || terminal::spawn_bridge(&exe, Some(&session), &pane_id, cols, rows),
    )?;

    if let Some(rx) = rx {
        tauri::async_runtime::spawn(bridge_read_task(state.clone(), bridge_id, rx, on_frame));
    }
    Ok(bridge_id)
}

#[tauri::command]
pub async fn terminal_input(
    state: State<'_, Arc<AppState>>,
    bridge_id: u32,
    data: String,
) -> Result<(), ApiError> {
    let bridge = get_alive_bridge(&state, bridge_id)?;
    bridge.input_text(&data);
    Ok(())
}

#[tauri::command]
pub async fn terminal_input_bytes(
    state: State<'_, Arc<AppState>>,
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
    state: State<'_, Arc<AppState>>,
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
    state: State<'_, Arc<AppState>>,
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

/// Cierra con gracia de 3 s: el bridge sigue vivo y aceptando input mientras tanto
/// (closing no es error). Un terminal_open del mismo pane cancela el cierre y
/// reutiliza el bridge. Al expirar: motivo estable `user_close` al frontend,
/// entrada muerta (NO respawnable) y release real.
#[tauri::command]
pub async fn terminal_close(
    state: State<'_, Arc<AppState>>,
    bridge_id: u32,
) -> Result<(), ApiError> {
    let state = state.inner().clone();
    {
        let mut reg = state.bridges.lock().unwrap();
        match reg.bridges.get_mut(&bridge_id) {
            Some(entry) if entry.alive => entry.closing_since = Some(Instant::now()),
            _ => return Ok(()),
        }
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(CLOSE_GRACE).await;
        let (on_frame, bridge) = {
            let mut reg = state.bridges.lock().unwrap();
            match finalize_close_if_expired(&mut reg, bridge_id) {
                Some(pair) => pair,
                None => return,
            }
        };
        // motivo determinista: no dependemos del server para un cierre pedido
        let _ = on_frame.send(InvokeResponseBody::Raw(herdr_core::frame::encode_closed(
            CLOSE_USER_CLOSE,
        )));
        bridge.release();
    });
    Ok(())
}

/// Libera un bridge SIN cerrar el pane (via DISTINTA de close):
/// - marca la entrada como muerta con motivo estable `released` de forma
///   atomica (mismo lock que open_bridge_in_registry), de modo que un
///   terminal_open posterior o simultaneo NO la reutilice y spawnee un bridge
///   nuevo; ese nuevo attach (`--takeover`) es lo que hace que el server mande
///   un frame full;
/// - NO toca closing_since ni pasa por la gracia: release no es un cierre;
/// - NO emite `user_close`: close es el UNICO camino que mata el proceso del
///   pane; aca solo muere el proceso del bridge (Bridge::release envia
///   `terminal.release` y el server despega el pane del bridge).
///
/// Devuelve el bridge a liberar, o None si la entrada ya estaba muerta o no
/// existe (idempotente). Las entradas `released` no son respawnables y se
/// purgan con el mismo barrido que el resto de muertas (purge_dead_for_pane /
/// purge_non_respawnable), asi que no quedan entradas ni canales colgados.
pub fn release_bridge_in_registry(reg: &mut BridgeRegistry, bridge_id: u32) -> Option<Bridge> {
    let entry = reg.bridges.get_mut(&bridge_id)?;
    if !entry.alive {
        return None;
    }
    entry.alive = false;
    entry.dead_reason = Some(CLOSE_RELEASED.to_string());
    entry.closing_since = None;
    Some(entry.bridge.clone())
}

/// Release (soltar) frente a close (cerrar):
/// - `terminal_release`: el pane SIGUE VIVO en el server. Solo se suelta del
///   bridge actual (`terminal.release`; muere el proceso del bridge) y la
///   entrada queda marcada `released` para forzar un bridge nuevo en el
///   proximo `terminal_open`, que recibe frame full del server. Sin
///   `user_close`, sin gracia de cierre.
/// - `terminal_close`: tras la gracia de 3 s emite `user_close` al frontend y
///   mata el proceso del pane (es el camino que cierra el pane de verdad).
/// Idempotente: liberar una entrada ya muerta o inexistente es Ok.
#[tauri::command]
pub async fn terminal_release(
    state: State<'_, Arc<AppState>>,
    bridge_id: u32,
) -> Result<(), ApiError> {
    let state = state.inner().clone();
    let bridge = {
        let mut reg = state.bridges.lock().unwrap();
        match release_bridge_in_registry(&mut reg, bridge_id) {
            Some(bridge) => bridge,
            None => return Ok(()),
        }
    };
    // terminal.release + kill del proceso bridge (solo el bridge; el pane sigue)
    bridge.release();
    Ok(())
}

/// Devuelve el bridge si la entrada esta viva. El estado closing NO es un error:
/// el frontend sigue pudiendo escribir mientras dura la gracia.
fn get_alive_bridge(state: &State<'_, Arc<AppState>>, bridge_id: u32) -> Result<Bridge, ApiError> {
    let reg = state.bridges.lock().unwrap();
    match reg.bridges.get(&bridge_id) {
        Some(entry) if entry.alive => Ok(entry.bridge.clone()),
        Some(entry) => Err(ApiError {
            code: "bridge_closed".to_string(),
            message: format!(
                "la terminal se cerro ({}); re-abre el pane",
                entry.dead_reason.as_deref().unwrap_or("sin motivo")
            ),
        }),
        None => Err(ApiError {
            code: "bridge_closed".to_string(),
            message: "la terminal ya no existe".to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eof_without_closed_is_server_down() {
        assert_eq!(normalize_close_reason(None), CLOSE_SERVER_DOWN);
    }

    #[test]
    fn detached_from_server_is_released_not_crash() {
        assert_eq!(normalize_close_reason(Some("detached")), CLOSE_RELEASED);
    }

    #[test]
    fn taken_over_is_not_crash() {
        assert_eq!(
            normalize_close_reason(Some("terminal attach taken over")),
            CLOSE_TAKEN_OVER
        );
    }

    #[test]
    fn pane_closed_is_not_crash() {
        assert_eq!(
            normalize_close_reason(Some("pane closed")),
            CLOSE_PANE_CLOSED
        );
        assert_eq!(
            normalize_close_reason(Some("Pane exited")),
            CLOSE_PANE_CLOSED
        );
    }

    #[test]
    fn user_close_is_not_classified_as_crash() {
        assert_ne!(CLOSE_USER_CLOSE, CLOSE_SERVER_DOWN);
        assert_ne!(normalize_close_reason(Some("detached")), CLOSE_SERVER_DOWN);
    }

    #[test]
    fn unknown_server_reason_keeps_text_without_being_crash() {
        let reason = normalize_close_reason(Some("algo raro"));
        assert_eq!(reason, "unknown:algo raro");
        assert_ne!(reason, CLOSE_SERVER_DOWN);
    }

    #[test]
    fn release_en_registro_vacio_es_none() {
        use crate::state::BridgeRegistry;
        let mut reg = BridgeRegistry::new();
        assert!(release_bridge_in_registry(&mut reg, 999).is_none());
    }

    #[test]
    fn released_y_close_son_motivos_distintos() {
        // release nunca debe mapear a user_close ni a server_down
        assert_ne!(CLOSE_RELEASED, CLOSE_USER_CLOSE);
        assert_ne!(CLOSE_RELEASED, CLOSE_SERVER_DOWN);
        assert_eq!(normalize_close_reason(Some("detached")), CLOSE_RELEASED);
    }
}

#[cfg(all(test, feature = "sandbox"))]
mod release_registry_tests {
    //! Registro con bridge_noop (sin procesos): semantica release vs close.

    use super::*;
    use crate::state::BridgeRegistry;
    use std::time::Instant;
    use tauri::ipc::Channel;

    fn registry_with_bridge() -> (BridgeRegistry, u32) {
        let mut reg = BridgeRegistry::new();
        let id = reg.insert(
            herdr_core::terminal::bridge_noop(),
            "pane-r".to_string(),
            Channel::new(|_| Ok(())),
            80,
            25,
        );
        (reg, id)
    }

    #[test]
    fn release_marca_released_limpia_gracia_y_no_respawnea() {
        let (mut reg, id) = registry_with_bridge();
        // gracia pendiente de un close anterior: release debe limpiarla
        reg.bridges.get_mut(&id).unwrap().closing_since = Some(Instant::now());

        let bridge = release_bridge_in_registry(&mut reg, id).expect("release");
        bridge.release(); // canal descartado: no-op seguro

        let entry = reg.bridges.get(&id).unwrap();
        assert!(!entry.alive, "la entrada queda muerta");
        assert_eq!(entry.dead_reason.as_deref(), Some(CLOSE_RELEASED));
        assert!(
            entry.closing_since.is_none(),
            "release no pasa por la gracia"
        );
        assert!(!entry.respawnable(), "released no es respawnable");
        assert_ne!(entry.dead_reason.as_deref(), Some(CLOSE_USER_CLOSE));

        // idempotente: segunda vez None
        assert!(release_bridge_in_registry(&mut reg, id).is_none());
    }

    #[test]
    fn open_tras_release_no_reutiliza_y_la_muerta_se_purga() {
        let (mut reg, id) = registry_with_bridge();
        let _ = release_bridge_in_registry(&mut reg, id).expect("release");

        // el purgado del open elimina la entrada released
        reg.purge_dead_for_pane("pane-r");
        assert!(!reg.bridges.contains_key(&id), "sin entradas colgadas");

        // un open posterior spawnea bridge NUEVO (no reutiliza la liberada)
        let (id2, rx2) =
            open_bridge_in_registry(&mut reg, "pane-r", 80, 25, Channel::new(|_| Ok(())), || {
                Ok((
                    herdr_core::terminal::bridge_noop(),
                    tokio::sync::mpsc::unbounded_channel().1,
                ))
            })
            .expect("open tras release");
        assert_ne!(id, id2, "bridge nuevo, no el liberado");
        assert!(rx2.is_some(), "spawn nuevo = tarea de lectura nueva");
    }
}
