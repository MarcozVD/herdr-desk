use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use tauri::ipc::{Channel, InvokeResponseBody};

use herdr_core::Store;
use herdr_core::terminal::Bridge;

/// Sesión activa: se reemplaza entera al conectar a otra sesión (session_connect).
pub struct Runtime {
    pub session: String,
    pub client: Arc<herdr_core::RpcClient>,
    pub store: Arc<Store>,
}

pub struct AppState {
    pub runtime: std::sync::RwLock<Arc<Runtime>>,
    pub bridges: Mutex<BridgeRegistry>,
    pub event_channels: Mutex<Vec<Channel<InvokeResponseBody>>>,
    /// Suscripción al store activa (solo la última vive; el re-suscribir cancela la
    /// anterior de verdad: la tarea termina y sus mensajes se descartan).
    pub store_subs: Mutex<StoreSubs>,
    /// Estado del tray (sesiones + agentes), actualizado por el frontend y los eventos.
    pub tray: Mutex<crate::tray::TrayState>,
}

/// Registro de la suscripcion al store vigente.
pub struct StoreSubs {
    pub generation: u64,
    pub cancel: Arc<tokio::sync::Notify>,
}

impl StoreSubs {
    pub fn new() -> Self {
        Self {
            generation: 0,
            cancel: Arc::new(tokio::sync::Notify::new()),
        }
    }

    /// Rota la suscripcion: cancela la anterior y devuelve el token de la nueva.
    pub fn rotate(&mut self) -> (u64, Arc<tokio::sync::Notify>) {
        self.generation += 1;
        let prev = std::mem::replace(&mut self.cancel, Arc::new(tokio::sync::Notify::new()));
        prev.notify_waiters();
        (self.generation, self.cancel.clone())
    }
}

impl Default for StoreSubs {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new(runtime: Runtime) -> Self {
        Self {
            runtime: std::sync::RwLock::new(Arc::new(runtime)),
            bridges: Mutex::new(BridgeRegistry::new()),
            event_channels: Mutex::new(Vec::new()),
            store_subs: Mutex::new(StoreSubs::new()),
            tray: Mutex::new(crate::tray::TrayState::default()),
        }
    }

    pub fn current(&self) -> Arc<Runtime> {
        self.runtime.read().unwrap().clone()
    }

    /// Cambia de sesion: cierra el store viejo (refresher y suscripciones mueren),
    /// libera y limpia TODOS los bridges de la sesion anterior.
    pub fn swap(&self, runtime: Runtime) {
        let old = self.runtime.read().unwrap().clone();
        old.store.close();
        {
            let mut reg = self.bridges.lock().unwrap();
            for entry in reg.bridges.values_mut() {
                entry.bridge.release();
                entry.alive = false;
            }
            reg.clear_all();
        }
        *self.runtime.write().unwrap() = Arc::new(runtime);
        // cancela la suscripcion al store vieja (si el frontend no re-suscribio aun)
        self.store_subs.lock().unwrap().rotate();
    }

    pub fn subscribe_events(&self, channel: Channel<InvokeResponseBody>) {
        self.event_channels.lock().unwrap().push(channel);
    }

    pub fn broadcast_event(&self, line: &str) {
        let payload = InvokeResponseBody::Json(line.to_string());
        self.event_channels
            .lock()
            .unwrap()
            .retain(|c| c.send(payload.clone()).is_ok());

        // el tray sigue los cambios de estado de agentes por la conexión S
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(line)
            && value["event"] == "pane.agent_status_changed"
        {
            let agent = crate::tray::TrayAgent {
                pane_id: value["data"]["pane_id"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                agent: value["data"]["agent"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                display: value["data"]["display_agent"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                status: value["data"]["agent_status"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
            };
            if !agent.pane_id.is_empty() {
                self.tray.lock().unwrap().upsert_agent(agent);
            }
        }
    }
}

pub struct BridgeEntry {
    pub bridge: Bridge,
    pub pane_id: String,
    pub alive: bool,
    /// Gracia de cierre activa (3 s): el bridge sigue vivo y el frontend puede
    /// reabrir el pane para cancelar el cierre.
    pub closing_since: Option<std::time::Instant>,
    /// Motivo de cierre estable (contrato con el frontend) cuando alive=false.
    pub dead_reason: Option<String>,
    pub on_frame: Channel<InvokeResponseBody>,
    pub last_cols: u16,
    pub last_rows: u16,
}

impl BridgeEntry {
    /// Solo los muertos por caida del server se respawnean automaticamente.
    pub fn respawnable(&self) -> bool {
        !self.alive
            && self.dead_reason.as_deref() == Some(crate::commands::terminal::CLOSE_SERVER_DOWN)
    }
}

pub struct BridgeRegistry {
    next_id: AtomicU32,
    pub bridges: HashMap<u32, BridgeEntry>,
}

impl BridgeRegistry {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU32::new(1),
            bridges: HashMap::new(),
        }
    }

    pub fn insert(
        &mut self,
        bridge: Bridge,
        pane_id: String,
        on_frame: Channel<InvokeResponseBody>,
        cols: u16,
        rows: u16,
    ) -> u32 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.bridges.insert(
            id,
            BridgeEntry {
                bridge,
                pane_id,
                alive: true,
                closing_since: None,
                dead_reason: None,
                on_frame,
                last_cols: cols,
                last_rows: rows,
            },
        );
        id
    }

    /// Puente vivo para un pane, si existe (maximo UNO por invariant).
    pub fn find_alive_by_pane(&self, pane_id: &str) -> Option<u32> {
        self.bridges
            .iter()
            .find(|(_, e)| e.alive && e.pane_id == pane_id)
            .map(|(id, _)| *id)
    }

    /// Barre las entradas muertas de un pane (purga al abrir/reabrir).
    pub fn purge_dead_for_pane(&mut self, pane_id: &str) {
        self.bridges.retain(|_, e| e.alive || e.pane_id != pane_id);
    }

    /// Barre entradas muertas que ya no son respawnables:
    /// panes inexistentes o cierres pedidos por el usuario.
    pub fn purge_non_respawnable(&mut self, live_panes: &[String]) {
        self.bridges
            .retain(|_, e| e.alive || (e.respawnable() && live_panes.contains(&e.pane_id)));
    }

    /// Vacía el registro (cambio de sesión: nada de la sesión anterior se conserva).
    pub fn clear_all(&mut self) {
        self.bridges.clear();
    }

    pub fn alive_panes(&self) -> Vec<String> {
        self.bridges
            .values()
            .filter(|e| e.alive)
            .map(|e| e.pane_id.clone())
            .collect()
    }
}

impl Default for BridgeRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod managed_state_tests {
    /// `lib.rs` registra el estado con `app.manage(Arc<AppState>)`: un command que
    /// pida `State<AppState>` (sin `Arc`) compila pero falla en tiempo de ejecución
    /// con «state not managed». Este test recorre los commands y lo impide.
    #[test]
    fn todos_los_commands_piden_arc_app_state() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands");
        let mut malos = Vec::new();
        for entry in std::fs::read_dir(&dir).expect("src/commands") {
            let path = entry.expect("entrada").path();
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let texto = std::fs::read_to_string(&path).expect("lectura");
            for (n, linea) in texto.lines().enumerate() {
                let l = linea.replace(' ', "");
                if l.contains("State<'_,AppState>")
                    || l.contains("State<'_,crate::state::AppState>")
                {
                    malos.push(format!("{}:{}", path.display(), n + 1));
                }
            }
        }
        assert!(malos.is_empty(), "State<AppState> sin Arc en: {malos:?}");
    }
}
