#![cfg(feature = "sandbox")]

use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use herdr_core::model::SessionSnapshot;
use herdr_core::{RpcClient, Store, events};
use serde_json::json;

use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DETACHED_PROCESS: u32 = 0x0000_0008;
const MAX_WAIT: Duration = Duration::from_secs(10);

static TEST_SEQ: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

struct Sandbox {
    name: String,
}

impl Sandbox {
    fn start() -> Self {
        let name = format!(
            "hd-test-{}-{}",
            std::process::id(),
            TEST_SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        );
        let _ = Command::new("herdr")
            .args(["session", "stop", &name, "--json"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let _ = Command::new("herdr")
            .args(["session", "delete", &name, "--json"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        let mut cmd = Command::new("herdr");
        cmd.args(["--session", &name, "server"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(DETACHED_PROCESS)
            .spawn()
            .expect("spawn herdr server");

        let deadline = Instant::now() + MAX_WAIT;
        loop {
            if Instant::now() > deadline {
                panic!("sandbox {name} no arranco en {MAX_WAIT:?}");
            }
            let list = herdr_core::cli::session_list().expect("session list");
            if list.sessions.iter().any(|s| s.name == name && s.running) {
                break;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        Self { name }
    }

    fn pipe(&self) -> String {
        let socket = herdr_core::paths::session_socket(&self.name);
        herdr_core::paths::pipe_name(&socket)
    }

    fn client(&self) -> RpcClient {
        RpcClient::new(self.pipe())
    }

    /// Fresh servers start with no workspaces; create one so there is a focused pane.
    async fn ensure_pane(&self) -> RpcClient {
        let client = self.client();
        let _ = client
            .call(
                "workspace.create",
                &json!({"cwd": env!("CARGO_MANIFEST_DIR"), "label": "hd-test", "focus": true}),
            )
            .await
            .expect("workspace.create");
        client
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = Command::new("herdr")
            .args(["session", "stop", &self.name, "--json"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let _ = Command::new("herdr")
            .args(["session", "delete", &self.name, "--json"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
}

async fn wait_session_running(name: &str) {
    let deadline = Instant::now() + MAX_WAIT;
    loop {
        assert!(Instant::now() < deadline, "server de {name} no quedo listo");
        match herdr_core::cli::session_list() {
            Ok(list) if list.sessions.iter().any(|s| s.name == name && s.running) => return,
            _ => tokio::time::sleep(Duration::from_millis(200)).await,
        }
    }
}

#[tokio::test]
async fn ping_returns_protocol_19() {
    let sb = Sandbox::start();
    wait_session_running(&sb.name).await;
    let client = sb.client();
    let result = client.call("ping", &json!({})).await.expect("ping");
    assert_eq!(result["type"], "pong");
    assert_eq!(result["protocol"], 19);
    assert_eq!(result["version"], "0.8.0-preview.2026-08-04-d78e3d3b5126");
}

#[tokio::test]
async fn snapshot_parses() {
    let sb = Sandbox::start();
    wait_session_running(&sb.name).await;
    let client = sb.ensure_pane().await;
    let raw = client.snapshot_raw().await.expect("snapshot_raw");
    let snap: SessionSnapshot = serde_json::from_str(&raw).expect("parse snapshot");
    assert_eq!(snap.protocol, 19);
    assert!(!snap.workspaces.is_empty());
    assert!(!snap.panes.is_empty());
    assert!(snap.focused_pane_id.is_some());
}

#[tokio::test]
async fn store_receives_snapshot_and_events() {
    let sb = Sandbox::start();
    wait_session_running(&sb.name).await;
    let client = Arc::new(sb.client());

    let store = Store::spawn(client.clone());

    // L de eventos + kick al store
    let (ev_tx, mut ev_rx) = tokio::sync::mpsc::channel(256);
    let kick = store.kick_handle();
    tokio::spawn(events::run(sb.pipe(), ev_tx, kick));

    // trigger: workspace con pane y suscripción L viva
    client
        .call(
            "workspace.create",
            &json!({"cwd": env!("CARGO_MANIFEST_DIR"), "label": "hd-test", "focus": true}),
        )
        .await
        .expect("workspace.create");
    let deadline = Instant::now() + MAX_WAIT;
    loop {
        assert!(Instant::now() < deadline, "suscripcion L nunca quedo viva");
        let ev = tokio::time::timeout(Duration::from_secs(3), ev_rx.recv())
            .await
            .expect("evento esperado")
            .expect("canal vivo");
        if ev.event == "pane.created" {
            break;
        }
    }

    let raw = client.snapshot_raw().await.expect("snapshot");
    let snap: SessionSnapshot = serde_json::from_str(&raw).expect("parse");
    let pane_a = snap.focused_pane_id.clone().expect("focused pane");

    // split en el tab enfocado → pane.created + layout.updated → kick → snapshot fresco
    client
        .call(
            "pane.split",
            &json!({"direction": "down", "target_pane_id": pane_a}),
        )
        .await
        .expect("pane.split");

    // store coalescido con snapshot fresco (2 panes tras el split)
    store.kick();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        assert!(Instant::now() < deadline, "store no refresco");
        let snap: SessionSnapshot = serde_json::from_str(&store.snapshot()).expect("parse");
        if snap.panes.len() >= 2 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[tokio::test]
async fn raw_subscribe_debug() {
    let sb = Sandbox::start();
    wait_session_running(&sb.name).await;
    let pipe = sb.pipe();
    let mut client = herdr_core::transport::open(&pipe).await.expect("open");
    let subs: Vec<serde_json::Value> = events::GLOBAL_EVENT_TYPES
        .iter()
        .map(|t| json!({"type": t}))
        .collect();
    let req =
        json!({"id": "hd-raw", "method": "events.subscribe", "params": {"subscriptions": subs}});
    let mut line = serde_json::to_string(&req).unwrap();
    line.push('\n');
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    client.write_all(line.as_bytes()).await.unwrap();
    client.flush().await.unwrap();
    eprintln!("[raw] req enviado");
    let mut buf = String::new();
    let mut reader = tokio::io::BufReader::new(client);
    use tokio::io::AsyncBufReadExt;
    match tokio::time::timeout(Duration::from_secs(3), reader.read_line(&mut buf)).await {
        Ok(Ok(n)) => eprintln!("[raw] first ({n}): {}", buf.trim_end()),
        Ok(Err(e)) => eprintln!("[raw] io error: {e}"),
        Err(_) => eprintln!("[raw] TIMEOUT: el server nunca respondio"),
    }
}

#[tokio::test]
async fn split_emits_pane_created_and_layout_updated() {
    let sb = Sandbox::start();
    wait_session_running(&sb.name).await;
    let client = Arc::new(sb.client());

    let (ev_tx, mut ev_rx) = tokio::sync::mpsc::channel(64);
    let kick = Arc::new(tokio::sync::Notify::new());
    tokio::spawn(events::run(sb.pipe(), ev_tx, kick));

    // trigger: crea workspace con pane; el primer evento confirma la suscripción viva
    client
        .call(
            "workspace.create",
            &json!({"cwd": env!("CARGO_MANIFEST_DIR"), "label": "hd-test", "focus": true}),
        )
        .await
        .expect("workspace.create");

    let deadline = Instant::now() + MAX_WAIT;
    loop {
        assert!(Instant::now() < deadline, "suscripcion L nunca quedo viva");
        let ev = tokio::time::timeout(Duration::from_secs(3), ev_rx.recv())
            .await
            .expect("evento esperado")
            .expect("canal vivo");
        if ev.event == "pane.created" {
            break;
        }
    }

    let raw = client.snapshot_raw().await.expect("snapshot");
    let snap: SessionSnapshot = serde_json::from_str(&raw).expect("parse");
    let pane_a = snap.focused_pane_id.clone().expect("focused pane");

    client
        .call(
            "pane.split",
            &json!({"direction": "down", "target_pane_id": pane_a}),
        )
        .await
        .expect("pane.split");

    let mut saw_new_pane = false;
    let mut saw_layout_after_split = false;
    let deadline = Instant::now() + MAX_WAIT;
    while (!saw_new_pane || !saw_layout_after_split) && Instant::now() < deadline {
        let ev = tokio::time::timeout(Duration::from_secs(3), ev_rx.recv())
            .await
            .expect("evento esperado")
            .expect("canal vivo");
        match ev.event.as_str() {
            "pane.created" => {
                if ev.data["pane_id"] != json!(pane_a) {
                    saw_new_pane = true;
                }
            }
            "layout.updated" => {
                if saw_new_pane {
                    saw_layout_after_split = true;
                }
            }
            _ => {}
        }
    }
    assert!(saw_new_pane, "debio llegar pane.created del split");
    assert!(
        saw_layout_after_split,
        "debio llegar layout.updated del split"
    );
}

#[tokio::test]
async fn bridge_echo_roundtrip() {
    let sb = Sandbox::start();
    wait_session_running(&sb.name).await;
    let client = sb.ensure_pane().await;
    let raw = client.snapshot_raw().await.expect("snapshot");
    let snap: SessionSnapshot = serde_json::from_str(&raw).expect("parse");
    let pane = snap.focused_pane_id.expect("focused pane");

    let exe = herdr_core::paths::find_herdr_exe(None).expect("herdr.exe");
    let (bridge, mut events) =
        herdr_core::terminal::spawn_bridge(&exe, Some(&sb.name), &pane, 80, 25).expect("bridge");

    let mut first_frame_ms: Option<u128> = None;
    let start = Instant::now();
    let deadline = Instant::now() + MAX_WAIT;

    // esperamos primer frame full
    loop {
        assert!(Instant::now() < deadline, "sin frame inicial");
        let ev = tokio::time::timeout(Duration::from_secs(3), events.recv())
            .await
            .expect("esperando frame")
            .expect("canal vivo");
        if let herdr_core::terminal::BridgeEvent::Frame { full: true, .. } = &ev {
            first_frame_ms = Some(start.elapsed().as_millis());
            break;
        }
    }

    // eco: escribimos zqxj y esperamos un frame que lo contenga
    bridge.input_text("zqxj");
    let echo_start = Instant::now();
    let mut echo_ms: Option<u128> = None;
    loop {
        assert!(Instant::now() < deadline, "sin eco");
        let ev = tokio::time::timeout(Duration::from_secs(3), events.recv())
            .await
            .expect("esperando eco")
            .expect("canal vivo");
        match ev {
            herdr_core::terminal::BridgeEvent::Frame { bytes, .. } => {
                if bytes.windows(4).any(|w| w == b"zqxj") {
                    echo_ms = Some(echo_start.elapsed().as_millis());
                    break;
                }
            }
            herdr_core::terminal::BridgeEvent::Closed(reason) => {
                panic!("bridge cerro antes del eco: {reason}");
            }
        }
    }

    // resize del PTY
    bridge.resize(90, 20);
    let mut resized = false;
    loop {
        assert!(Instant::now() < deadline, "sin frame post-resize");
        let ev = tokio::time::timeout(Duration::from_secs(3), events.recv())
            .await
            .expect("esperando resize")
            .expect("canal vivo");
        match ev {
            herdr_core::terminal::BridgeEvent::Frame { width, height, .. }
                if width == 90 && height == 20 =>
            {
                resized = true;
                break;
            }
            herdr_core::terminal::BridgeEvent::Closed(_) => break,
            _ => {}
        }
    }

    bridge.release();
    println!(
        "bridge_echo: primer_frame={first_frame_ms:?}ms eco={echo_ms:?}ms resize_ok={resized}"
    );
    assert!(echo_ms.is_some(), "debio llegar eco");
    assert!(resized, "el resize debio reflejarse en el frame");
}

#[tokio::test]
async fn release_then_eof_emits_closed() {
    let sb = Sandbox::start();
    wait_session_running(&sb.name).await;
    let client = sb.ensure_pane().await;
    let raw = client.snapshot_raw().await.expect("snapshot");
    let snap: SessionSnapshot = serde_json::from_str(&raw).expect("parse");
    let pane = snap.focused_pane_id.expect("focused pane");

    let exe = herdr_core::paths::find_herdr_exe(None).expect("herdr.exe");
    let (bridge, mut events) =
        herdr_core::terminal::spawn_bridge(&exe, Some(&sb.name), &pane, 80, 25).expect("bridge");

    // 1) primer frame
    let deadline = Instant::now() + MAX_WAIT;
    loop {
        assert!(Instant::now() < deadline, "sin frame inicial");
        let ev = tokio::time::timeout(Duration::from_secs(3), events.recv())
            .await
            .expect("esperando frame")
            .expect("canal vivo");
        if matches!(ev, herdr_core::terminal::BridgeEvent::Frame { .. }) {
            break;
        }
    }

    // 2) release → terminal.closed o EOF del bridge
    bridge.release();
    let deadline = Instant::now() + MAX_WAIT;
    loop {
        assert!(Instant::now() < deadline, "sin closed tras release");
        let ev = tokio::time::timeout(Duration::from_secs(3), events.recv())
            .await
            .expect("esperando closed")
            .expect("canal vivo");
        if let herdr_core::terminal::BridgeEvent::Closed(reason) = ev {
            assert!(!reason.is_empty());
            break;
        }
    }
}
