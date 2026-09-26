#![cfg(all(test, feature = "sandbox"))]

//! T1.8: ciclo de cerrar/reabrir bridges dentro de la gracia, apertura doble del
//! mismo pane y motivos de cierre estables (contrato con el frontend).

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::commands::terminal::{
    CLOSE_GRACE, CLOSE_SERVER_DOWN, CLOSE_USER_CLOSE, finalize_close_if_expired,
    open_bridge_in_registry,
};
use crate::state::{AppState, Runtime};
use herdr_core::model::SessionSnapshot;
use herdr_core::terminal::BridgeEvent;
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::sandbox_guard::Sandbox;

fn test_state(session: String) -> Arc<AppState> {
    Arc::new(AppState::new(Runtime {
        session,
        client: Arc::new(herdr_core::RpcClient::new("unused".to_string())),
        store: Arc::new(herdr_core::Store::new()),
    }))
}

#[derive(Clone)]
struct FrameCollector {
    raw: Arc<Mutex<Vec<Vec<u8>>>>,
}

impl FrameCollector {
    fn new() -> (Self, Channel<InvokeResponseBody>) {
        let collector = Self {
            raw: Arc::new(Mutex::new(Vec::new())),
        };
        let sink = collector.clone();
        let channel = Channel::new(move |payload: InvokeResponseBody| {
            if let InvokeResponseBody::Raw(bytes) = payload {
                sink.raw.lock().unwrap().push(bytes);
            }
            Ok(())
        });
        (collector, channel)
    }

    fn closed_reasons(&self) -> Vec<String> {
        self.raw
            .lock()
            .unwrap()
            .iter()
            .filter_map(|bytes| {
                if bytes.len() >= 16 {
                    let flags = bytes[12];
                    if flags & herdr_core::frame::FLAG_CLOSED != 0 {
                        return Some(String::from_utf8_lossy(&bytes[16..]).to_string());
                    }
                }
                None
            })
            .collect()
    }
}

async fn sandbox_with_pane() -> (Sandbox, herdr_core::RpcClient, String) {
    let sb = Sandbox::start();
    crate::sandbox_guard::wait_session_running(&sb.name);
    let client = sb.ensure_pane().await;
    let pane = {
        let raw = client.snapshot_raw().await.expect("snapshot");
        let snap: SessionSnapshot = serde_json::from_str(&raw).expect("parse");
        snap.focused_pane_id.expect("focused pane")
    };
    (sb, client, pane)
}

fn spawn_real<'a>(
    exe: &'a std::path::Path,
    session: &'a str,
    pane: &'a str,
) -> impl FnOnce() -> std::io::Result<(
    herdr_core::terminal::Bridge,
    tokio::sync::mpsc::UnboundedReceiver<BridgeEvent>,
)> + 'a {
    move || herdr_core::terminal::spawn_bridge(exe, Some(session), pane, 80, 25)
}

/// Ciclo cerrar -> reabrir el MISMO pane dentro de la ventana de gracia:
/// reabrir cancela el cierre y reutiliza el bridge (mismo id, sin errores).
#[tokio::test]
async fn cycle_close_reopen_within_grace_reuses_bridge() {
    let (sb, _client, pane) = sandbox_with_pane().await;
    let state = test_state(sb.name.clone());
    let exe = herdr_core::paths::find_herdr_exe(None).expect("herdr.exe");

    let (_collector1, channel1) = FrameCollector::new();
    let (id1, rx1) = open_bridge_in_registry(
        &mut state.bridges.lock().unwrap(),
        &pane,
        80,
        25,
        channel1,
        spawn_real(&exe, &sb.name, &pane),
    )
    .expect("open 1");
    assert!(rx1.is_some(), "el primer open crea bridge");

    // cierra: gracia activa
    {
        let mut reg = state.bridges.lock().unwrap();
        reg.bridges.get_mut(&id1).unwrap().closing_since = Some(Instant::now());
    }

    // reabre ANTES de la gracia: mismo id, sin nuevo rx (reuso), closing cancelado
    let (collector2, channel2) = FrameCollector::new();
    let (id2, rx2) = open_bridge_in_registry(
        &mut state.bridges.lock().unwrap(),
        &pane,
        80,
        25,
        channel2,
        spawn_real(&exe, &sb.name, &pane),
    )
    .expect("open 2");
    assert_eq!(id1, id2, "el re-open debe reutilizar el bridge vivo");
    assert!(rx2.is_none(), "no debe crearse otro proceso bridge");
    {
        let reg = state.bridges.lock().unwrap();
        let entry = reg.bridges.get(&id1).unwrap();
        assert!(entry.alive);
        assert!(entry.closing_since.is_none(), "el cierre debe cancelarse");
        assert_eq!(reg.alive_panes(), vec![pane.clone()], "un solo bridge vivo");
    }

    // input durante la gracia cancelada: sin errores
    let bridge = {
        let reg = state.bridges.lock().unwrap();
        reg.bridges.get(&id1).unwrap().bridge.clone()
    };
    bridge.input_text("echo t15\r");
    drop(collector2);
}

/// Dos terminal_open del mismo pane: nunca dos bridges vivos.
#[tokio::test]
async fn double_open_same_pane_never_duplicates() {
    let (sb, _client, pane) = sandbox_with_pane().await;
    let state = test_state(sb.name.clone());
    let exe = herdr_core::paths::find_herdr_exe(None).expect("herdr.exe");

    let (_c1, ch1) = FrameCollector::new();
    let (id1, _) = open_bridge_in_registry(
        &mut state.bridges.lock().unwrap(),
        &pane,
        80,
        25,
        ch1,
        spawn_real(&exe, &sb.name, &pane),
    )
    .expect("open 1");

    let (_c2, ch2) = FrameCollector::new();
    let (id2, rx2) = open_bridge_in_registry(
        &mut state.bridges.lock().unwrap(),
        &pane,
        80,
        25,
        ch2,
        spawn_real(&exe, &sb.name, &pane),
    )
    .expect("open 2");

    assert_eq!(id1, id2, "el segundo open reutiliza el mismo bridge");
    assert!(rx2.is_none());
    let reg = state.bridges.lock().unwrap();
    let alive_for_pane = reg
        .bridges
        .values()
        .filter(|e| e.alive && e.pane_id == pane)
        .count();
    assert_eq!(
        alive_for_pane, 1,
        "nunca dos bridges vivos para el mismo pane"
    );
}

/// El cierre pedido emite motivo `user_close`, que NO clasifica como caida
/// (server_down), y la entrada no es respawnable y se purga.
#[tokio::test]
async fn user_close_reason_is_not_a_crash() {
    let (sb, _client, pane) = sandbox_with_pane().await;
    let state = test_state(sb.name.clone());
    let exe = herdr_core::paths::find_herdr_exe(None).expect("herdr.exe");

    let (collector, channel) = FrameCollector::new();
    let (id, _) = open_bridge_in_registry(
        &mut state.bridges.lock().unwrap(),
        &pane,
        80,
        25,
        channel,
        spawn_real(&exe, &sb.name, &pane),
    )
    .expect("open");

    // simulamos que la gracia ya expiro
    {
        let mut reg = state.bridges.lock().unwrap();
        reg.bridges.get_mut(&id).unwrap().closing_since =
            Some(Instant::now() - CLOSE_GRACE - Duration::from_secs(1));
    }
    let (on_frame, bridge) = finalize_close_if_expired(&mut state.bridges.lock().unwrap(), id)
        .expect("la gracia expiro y debe aplicarse");
    let _ = on_frame.send(InvokeResponseBody::Raw(herdr_core::frame::encode_closed(
        CLOSE_USER_CLOSE,
    )));
    bridge.release();

    // la entrada: muerta, motivo user_close, NO respawnable
    {
        let reg = state.bridges.lock().unwrap();
        let entry = reg.bridges.get(&id).unwrap();
        assert!(!entry.alive);
        assert_eq!(entry.dead_reason.as_deref(), Some(CLOSE_USER_CLOSE));
        assert!(!entry.respawnable(), "un cierre pedido no se respawnea");
    }

    // el frontend recibio user_close, que no clasifica como caida
    tokio::time::sleep(Duration::from_millis(300)).await;
    let reasons = collector.closed_reasons();
    assert!(
        reasons.contains(&CLOSE_USER_CLOSE.to_string()),
        "el frontend debe recibir user_close, recibio {reasons:?}"
    );
    assert!(
        !reasons.iter().any(|r| r == CLOSE_SERVER_DOWN),
        "un cierre pedido no debe reportarse como caida real"
    );

    // purga: la entrada user_close se borra (no queda basura)
    {
        let mut reg = state.bridges.lock().unwrap();
        reg.purge_non_respawnable(&[pane.clone()]);
        assert!(!reg.bridges.contains_key(&id), "las user_close se purgan");
    }
}

/// La gracia NO expira antes de tiempo: finalize_close no aplica si falta.
#[tokio::test]
async fn grace_does_not_expire_early() {
    let (sb, _client, pane) = sandbox_with_pane().await;
    let state = test_state(sb.name.clone());
    let exe = herdr_core::paths::find_herdr_exe(None).expect("herdr.exe");

    let (_c, ch) = FrameCollector::new();
    let (id, _) = open_bridge_in_registry(
        &mut state.bridges.lock().unwrap(),
        &pane,
        80,
        25,
        ch,
        spawn_real(&exe, &sb.name, &pane),
    )
    .expect("open");
    {
        let mut reg = state.bridges.lock().unwrap();
        reg.bridges.get_mut(&id).unwrap().closing_since = Some(Instant::now());
    }
    let result = finalize_close_if_expired(&mut state.bridges.lock().unwrap(), id);
    assert!(
        result.is_none(),
        "la gracia de 3 s no debe expirar al instante"
    );
    {
        let reg = state.bridges.lock().unwrap();
        let entry = reg.bridges.get(&id).unwrap();
        assert!(entry.alive, "el bridge sigue vivo durante la gracia");
        assert!(entry.dead_reason.is_none());
    }
    assert_ne!(CLOSE_USER_CLOSE, CLOSE_SERVER_DOWN);
}
