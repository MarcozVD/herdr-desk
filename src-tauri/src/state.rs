use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use herdr_core::terminal::Bridge;
use herdr_core::{RpcClient, Store};

pub struct AppState {
    pub session: String,
    pub client: Arc<RpcClient>,
    pub store: Store,
    pub bridges: Mutex<BridgeRegistry>,
}

pub struct BridgeRegistry {
    next_id: AtomicU32,
    pub bridges: HashMap<u32, Bridge>,
}

impl BridgeRegistry {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU32::new(1),
            bridges: HashMap::new(),
        }
    }

    pub fn insert(&mut self, bridge: Bridge) -> u32 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.bridges.insert(id, bridge);
        id
    }
}

impl AppState {
    pub fn new(session: String, client: Arc<RpcClient>, store: Store) -> Self {
        Self {
            session,
            client,
            store,
            bridges: Mutex::new(BridgeRegistry::new()),
        }
    }
}
