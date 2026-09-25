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
}

impl AppState {
    pub fn new(runtime: Runtime) -> Self {
        Self {
            runtime: std::sync::RwLock::new(Arc::new(runtime)),
            bridges: Mutex::new(BridgeRegistry::new()),
            event_channels: Mutex::new(Vec::new()),
        }
    }

    pub fn current(&self) -> Arc<Runtime> {
        self.runtime.read().unwrap().clone()
    }

    pub fn swap(&self, runtime: Runtime) {
        *self.runtime.write().unwrap() = Arc::new(runtime);
        // los bridges de la sesión anterior quedan sin sentido
        let mut reg = self.bridges.lock().unwrap();
        for entry in reg.bridges.values_mut() {
            entry.bridge.release();
            entry.alive = false;
        }
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
    }
}

pub struct BridgeEntry {
    pub bridge: Bridge,
    pub pane_id: String,
    pub alive: bool,
    pub closing_since: Option<std::time::Instant>,
    pub on_frame: Channel<InvokeResponseBody>,
    pub last_cols: u16,
    pub last_rows: u16,
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
                on_frame,
                last_cols: cols,
                last_rows: rows,
            },
        );
        id
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
