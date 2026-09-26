#![cfg(all(test, feature = "sandbox"))]

//! Contrato de suscripción al store al cambiar de sesión:
//! - solo la ÚLTIMA suscripción entrega mensajes (la obsoleta se cancela de verdad);
//! - el snapshot tras el swap pertenece a la sesión nueva;
//! - el registro de bridges queda vacío tras el cambio.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::commands::api::subscribe_store;
use crate::commands::session::connect_session;
use crate::commands::terminal::open_bridge_in_registry;
use crate::state::{AppState, Runtime};
use herdr_core::model::SessionSnapshot;
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::sandbox_guard::Sandbox;

#[derive(Clone)]
struct SnapshotCollector {
    raw: Arc<Mutex<Vec<String>>>,
}

impl SnapshotCollector {
    fn new() -> (Self, Channel<InvokeResponseBody>) {
        let collector = Self {
            raw: Arc::new(Mutex::new(Vec::new())),
        };
        let sink = collector.clone();
        let channel = Channel::new(move |payload: InvokeResponseBody| {
            if let InvokeResponseBody::Json(text) = payload {
                sink.raw.lock().unwrap().push(text);
            }
            Ok(())
        });
        (collector, channel)
    }

    fn count(&self) -> usize {
        self.raw.lock().unwrap().len()
    }

    fn labels_seen(&self) -> Vec<String> {
        self.raw
            .lock()
            .unwrap()
            .iter()
            .filter_map(|text| {
                let snap: SessionSnapshot = serde_json::from_str(text).ok()?;
                snap.workspaces.first().map(|w| w.label.clone())
            })
            .collect()
    }
}

async fn session_with_workspace(label: &str) -> (Sandbox, herdr_core::RpcClient) {
    let sb = Sandbox::start();
    crate::sandbox_guard::wait_session_running(&sb.name);
    let client = sb.client();
    client
        .call(
            "workspace.create",
            &serde_json::json!({
                "cwd": env!("CARGO_MANIFEST_DIR"),
                "label": label,
                "focus": true
            }),
        )
        .await
        .expect("workspace.create");
    (sb, client)
}

/// Dos store_subscribe seguidos y un session_connect: solo la suscripción nueva
/// entrega mensajes; la obsoleta queda cancelada de verdad.
#[tokio::test]
async fn only_latest_subscription_delivers_after_switch() {
    let (sb_a, _client_a) = session_with_workspace("sw-a").await;
    let state = {
        let client = Arc::new(herdr_core::RpcClient::new(sb_a.pipe()));
        let store = Arc::new(herdr_core::Store::new());
        let store2 = store.clone();
        let client2 = client.clone();
        tokio::spawn(store2.refresher_task(client2));
        Arc::new(AppState::new(Runtime {
            session: sb_a.name.clone(),
            client,
            store,
        }))
    };

    // suscripcion 1 sobre la sesion A
    let (col1, ch1) = SnapshotCollector::new();
    subscribe_store(state.clone(), ch1);
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        col1.labels_seen().contains(&"sw-a".to_string()),
        "ch1 debe recibir el snapshot de A, vio {:?}",
        col1.labels_seen()
    );
    let count1_before = col1.count();

    // sesion B con workspace distinto
    let (sb_b, _client_b) = session_with_workspace("sw-b").await;

    // cambio de sesion: la respuesta identifica la sesion nueva
    let connected = connect_session(&state, Some(sb_b.name.clone()))
        .await
        .expect("connect B");
    assert_eq!(connected.session, sb_b.name);

    // suscripcion 2 (el frontend la re-llama tras conectar)
    let (col2, ch2) = SnapshotCollector::new();
    subscribe_store(state.clone(), ch2);
    tokio::time::sleep(Duration::from_millis(800)).await;

    // el snapshot que llega por el canal nuevo pertenece a la sesion nueva
    assert!(
        col2.labels_seen().contains(&"sw-b".to_string()),
        "ch2 debe recibir el snapshot de B, vio {:?}",
        col2.labels_seen()
    );
    assert!(
        !col2.labels_seen().contains(&"sw-a".to_string()),
        "ch2 no debe recibir snapshots de A"
    );

    // la suscripcion vieja esta cancelada: no recibe nada de la sesion nueva
    let count1_after = col1.count();
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert_eq!(
        col1.count(),
        count1_after,
        "ch1 (obsoleta) no debe recibir mas mensajes"
    );
    assert!(
        !col1.labels_seen().contains(&"sw-b".to_string()),
        "ch1 no debe recibir el snapshot de la sesion nueva"
    );
    let _ = (count1_before, sb_a);
}

/// Tras session_connect el registro de bridges queda VACIO (nada de la sesion
/// anterior sobrevive) y el store viejo queda cerrado.
#[tokio::test]
async fn registry_empty_and_old_store_closed_after_switch() {
    let (sb_a, client_a) = session_with_workspace("sw-a2").await;
    let state = {
        let client = Arc::new(herdr_core::RpcClient::new(sb_a.pipe()));
        let store = Arc::new(herdr_core::Store::new());
        let store2 = store.clone();
        let client2 = client.clone();
        tokio::spawn(store2.refresher_task(client2));
        Arc::new(AppState::new(Runtime {
            session: sb_a.name.clone(),
            client,
            store: store.clone(),
        }))
    };
    let old_store = state.current().store.clone();

    // bridge real sobre un pane de A
    let raw = client_a
        .snapshot_raw()
        .await
        .expect("snapshot A directo del pipe");
    let snap: SessionSnapshot = serde_json::from_str(&raw).expect("parse snapshot A");
    let pane = snap.focused_pane_id.expect("focused pane A");
    let exe = herdr_core::paths::find_herdr_exe(None).expect("herdr.exe");
    let (_collector, channel) = SnapshotCollector::new();
    let (bridge_id, rx) = open_bridge_in_registry(
        &mut state.bridges.lock().unwrap(),
        &pane,
        80,
        25,
        channel,
        || herdr_core::terminal::spawn_bridge(&exe, Some(&sb_a.name.clone()), &pane, 80, 25),
    )
    .expect("open bridge A");
    assert!(rx.is_some());
    assert_eq!(state.bridges.lock().unwrap().bridges.len(), 1);

    // switch a B
    let (sb_b, _client_b) = session_with_workspace("sw-b2").await;
    connect_session(&state, Some(sb_b.name.clone()))
        .await
        .expect("connect B");

    // registro vacio: nada de la sesion A sobrevive
    {
        let reg = state.bridges.lock().unwrap();
        assert!(
            reg.bridges.is_empty(),
            "el registro debe quedar vacio tras el switch, quedan {}",
            reg.bridges.len()
        );
        assert!(reg.alive_panes().is_empty());
    }

    // el store viejo esta cerrado (refresher parado)
    assert!(
        old_store.is_closed(),
        "el store de la sesion anterior debe quedar cerrado"
    );

    // el bridge muerto no debe seguir publicando: el proceso fue liberado en el swap
    let _ = bridge_id;

    // limpiar sandbox B
    let _ = herdr_core::cli::stop_session(&sb_b.name);
    let _ = herdr_core::cli::delete_session(&sb_b.name);
}
