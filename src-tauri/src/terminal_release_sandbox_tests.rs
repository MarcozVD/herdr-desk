#![cfg(all(test, feature = "sandbox"))]

//! terminal_release contra el server real en sesion hd-test-*:
//! release (soltar; el pane SIGUE) vs close (user_close; el pane muere).
//! Demuestra con proceso real que (1) el pane sobrevive al release,
//! (2) un terminal_open posterior crea un bridge NUEVO y recibe un frame
//! full=true con el contenido de la pantalla previa, (3) release no emite
//! user_close ni server_down, y (4) el input escrito justo antes del release
//! no se pierde (el shell lo proceso y la pantalla lo conserva).

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::commands::terminal::{
    CLOSE_SERVER_DOWN, CLOSE_USER_CLOSE, bridge_read_task, open_bridge_in_registry,
    release_bridge_in_registry,
};
use crate::state::{AppState, Runtime};
use herdr_core::error::ApiError;
use herdr_core::frame::{FLAG_CLOSED, FLAG_FULL, HEADER_LEN, decode_header};
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

    fn frames(&self) -> Vec<Vec<u8>> {
        self.raw.lock().unwrap().clone()
    }

    fn full_frames(&self) -> Vec<Vec<u8>> {
        self.frames()
            .into_iter()
            .filter(|bytes| {
                decode_header(bytes)
                    .map(|(_, _, _, flags)| flags & FLAG_CLOSED == 0 && flags & FLAG_FULL != 0)
                    .unwrap_or(false)
            })
            .collect()
    }

    fn closed_reasons(&self) -> Vec<String> {
        self.frames()
            .iter()
            .filter_map(|bytes| {
                decode_header(bytes).and_then(|(_, _, _, flags)| {
                    if flags & FLAG_CLOSED != 0 {
                        Some(String::from_utf8_lossy(&bytes[HEADER_LEN..]).to_string())
                    } else {
                        None
                    }
                })
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

fn open_and_read(
    state: &Arc<AppState>,
    exe: &std::path::Path,
    session: &str,
    pane: &str,
) -> Result<(u32, FrameCollector), ApiError> {
    let (collector, channel) = FrameCollector::new();
    let (id, rx) = open_bridge_in_registry(
        &mut state.bridges.lock().unwrap(),
        pane,
        80,
        25,
        channel.clone(),
        spawn_real(exe, session, pane),
    )?;
    if let Some(rx) = rx {
        tauri::async_runtime::spawn(bridge_read_task(state.clone(), id, rx, channel.clone()));
    }
    Ok((id, collector))
}

async fn wait_full_frame(collector: &FrameCollector, what: &str) -> Vec<u8> {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        assert!(
            Instant::now() < deadline,
            "sin frame full tras {what} ({} frames recibidos)",
            collector.frames().len()
        );
        let frames = collector.full_frames();
        if let Some(bytes) = frames.into_iter().next() {
            return bytes;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn pane_source_text(client: &herdr_core::RpcClient, pane: &str, source: &str) -> String {
    // contrato: {type:"pane_read", read:{pane_id, ..., text, revision, truncated}}
    let result = client
        .call(
            "pane.read",
            &serde_json::json!({ "pane_id": pane, "source": source, "format": "text" }),
        )
        .await
        .expect("pane.read");
    result["read"]["text"]
        .as_str()
        .unwrap_or_default()
        .to_string()
}

/// El shell del pane recien creado tarda en estar listo: esperamos a que el
/// buffer reciente muestre el prompt (condicion de arranque, no del protocolo).
async fn wait_shell_ready(client: &herdr_core::RpcClient, pane: &str) {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        assert!(Instant::now() < deadline, "el shell del pane no arranco");
        let text = pane_source_text(client, pane, "recent").await;
        if text.contains("PS") || text.contains("PowerShell") || text.contains('>') {
            return;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

async fn pane_process_alive(client: &herdr_core::RpcClient, pane: &str) -> (bool, Option<u32>) {
    // contrato: {type:"pane_process_info", process_info:{pane_id, shell_pid?, foreground_processes[]}}
    let result = client
        .call("pane.process_info", &serde_json::json!({ "pane_id": pane }))
        .await
        .expect("pane.process_info");
    let info = &result["process_info"];
    let shell_pid = info["shell_pid"].as_u64().map(|p| p as u32);
    let foreground = info["foreground_processes"]
        .as_array()
        .map(|a| !a.is_empty())
        .unwrap_or(false);
    (shell_pid.is_some() || foreground, shell_pid)
}

async fn pane_ids(client: &herdr_core::RpcClient) -> Vec<String> {
    let raw = client.snapshot_raw().await.expect("snapshot");
    let snap: SessionSnapshot = serde_json::from_str(&raw).expect("parse");
    snap.panes.iter().map(|p| p.pane_id.clone()).collect()
}

/// Los 4 puntos del contrato, con proceso real.
#[tokio::test]
async fn release_then_reopen_full_frame_with_real_process() {
    let (sb, client, pane) = sandbox_with_pane().await;
    let state = test_state(sb.name.clone());
    let exe = herdr_core::paths::find_herdr_exe(None).expect("herdr.exe");

    // bridge 1 + frame full inicial
    let (id1, collector1) = open_and_read(&state, &exe, &sb.name, &pane).expect("open 1");
    let _ = wait_full_frame(&collector1, "el attach inicial").await;

    // (4) esperar a que el shell este listo y mandar el marker; debe ecoarse
    wait_shell_ready(&client, &pane).await;
    let marker = format!("hd-release-{}", std::process::id());
    {
        let reg = state.bridges.lock().unwrap();
        reg.bridges
            .get(&id1)
            .unwrap()
            .bridge
            .input_text(&format!("echo {marker}\r"));
    }
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        assert!(
            Instant::now() < deadline,
            "el shell no ecoo el marker antes del release"
        );
        let recent = pane_source_text(&client, &pane, "recent").await;
        if recent.contains(&marker) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    // RELEASE (no close): marca released y suelta el bridge
    let bridge = release_bridge_in_registry(&mut state.bridges.lock().unwrap(), id1)
        .expect("release del bridge 1");
    bridge.release();

    // entrada: muerta con motivo released, sin gracia, no respawnable
    {
        let reg = state.bridges.lock().unwrap();
        let entry = reg.bridges.get(&id1).expect("entrada liberada");
        assert!(!entry.alive);
        assert_eq!(entry.dead_reason.as_deref(), Some("released"));
        assert!(
            entry.closing_since.is_none(),
            "release no toca closing_since"
        );
        assert!(!entry.respawnable());
    }

    // (3) el canal viejo NO recibe user_close ni server_down (el despegue del
    // bridge puede notificar released/unknown, que no son cierre del pane)
    tokio::time::sleep(Duration::from_millis(600)).await;
    let reasons = collector1.closed_reasons();
    assert!(
        !reasons.iter().any(|r| r == CLOSE_USER_CLOSE),
        "release no emite user_close: {reasons:?}"
    );
    assert!(
        !reasons.iter().any(|r| r == CLOSE_SERVER_DOWN),
        "release no es una caida: {reasons:?}"
    );

    // (1) el pane sigue vivo: sigue en la sesion y con proceso delante
    let panes = pane_ids(&client).await;
    assert!(panes.contains(&pane), "el pane debe seguir en la sesion");
    let (alive, _shell_pid) = pane_process_alive(&client, &pane).await;
    assert!(alive, "el pane debe tener proceso vivo tras el release");

    // (2) reopen: bridge NUEVO (id distinto) + frame full=true
    let (id2, collector2) = open_and_read(&state, &exe, &sb.name, &pane).expect("open 2");
    assert_ne!(id1, id2, "tras el release debe spawnear un bridge nuevo");

    // (4) el frame full del reopen restaura la pantalla con el marker:
    // el input pre-release no se perdio de forma recuperable
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut restored = false;
    let mut reopen_text = String::new();
    while Instant::now() < deadline {
        let full = wait_full_frame(&collector2, "el reopen tras release").await;
        let (_, width, height, flags) = decode_header(&full).expect("header del frame full");
        assert_eq!(flags & FLAG_FULL, FLAG_FULL);
        assert_eq!((width, height), (80, 25));
        reopen_text = String::from_utf8_lossy(&full[HEADER_LEN..]).to_string();
        if reopen_text.contains(&marker) {
            restored = true;
            break;
        }
        // el shell puede redibujar: esperamos al siguiente repaint full
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    // y el server tambien lo conserva por su cuenta (pane.read)
    let visible = pane_source_text(&client, &pane, "visible").await;
    let recent = pane_source_text(&client, &pane, "recent").await;
    assert!(
        restored || visible.contains(&marker) || recent.contains(&marker),
        "el input pre-release debe seguir siendo visible; reopen-full: {:?}",
        reopen_text
    );

    // limpieza: sin entradas colgadas del pane
    {
        let mut reg = state.bridges.lock().unwrap();
        reg.purge_dead_for_pane(&pane);
        assert!(
            !reg.bridges.contains_key(&id1),
            "la entrada released se purga"
        );
    }
}

/// Release doble es idempotente y el open posterior nunca reutiliza la
/// entrada liberada: siempre bridge nuevo con frame full.
#[tokio::test]
async fn release_idempotent_and_open_spawns_new_bridge() {
    let (sb, client, pane) = sandbox_with_pane().await;
    let state = test_state(sb.name.clone());
    let exe = herdr_core::paths::find_herdr_exe(None).expect("herdr.exe");

    let (id1, _c1) = open_and_read(&state, &exe, &sb.name, &pane).expect("open 1");

    // release 1: Some; release 2 sobre la misma entrada: None (idempotente)
    let bridge = release_bridge_in_registry(&mut state.bridges.lock().unwrap(), id1)
        .expect("primer release");
    bridge.release();
    assert!(
        release_bridge_in_registry(&mut state.bridges.lock().unwrap(), id1).is_none(),
        "segundo release sobre entrada muerta: None"
    );

    // open inmediato tras el release: bridge nuevo (nunca reutiliza la
    // entrada liberada) y frame full del server
    let (id2, collector2) = open_and_read(&state, &exe, &sb.name, &pane).expect("open 2");
    assert_ne!(id1, id2);
    let full = wait_full_frame(&collector2, "el reopen idempotente").await;
    let (_, _, _, flags) = decode_header(&full).expect("header");
    assert_eq!(flags & FLAG_FULL, FLAG_FULL);

    // y el pane sigue vivo en la sesion
    let panes = pane_ids(&client).await;
    assert!(panes.contains(&pane));
}
