#![cfg(feature = "sandbox")]

use std::time::{Duration, Instant};

use herdr_core::model::SessionSnapshot;
use herdr_core::terminal::spawn_bridge;

mod common;

/// T1.5: el server lanzado por la GUI (detached) sobrevive al cierre del proceso
/// que lo lanzó. Este test hace de "GUI": spawnea y muere.
#[tokio::test]
async fn t15a_spawn_detached_server() {
    let name = format!("hd-test-{}-gui", std::process::id());
    let _ = herdr_core::cli::stop_session(&name);
    let _ = herdr_core::cli::delete_session(&name);

    herdr_core::cli::start_server_detached(&name).expect("spawn detached server");
    let deadline = Instant::now() + common::MAX_WAIT;
    loop {
        assert!(Instant::now() < deadline, "server no quedo running");
        let list = herdr_core::cli::session_list().expect("session list");
        if list.sessions.iter().any(|s| s.name == name && s.running) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    std::fs::write(
        std::env::temp_dir().join("herdr-desk-t15-session.txt"),
        &name,
    )
    .expect("escribir nombre de sesion");
    // el test termina aquí = la "GUI" se cierra; el server debe seguir vivo
}

/// T1.5 (continuación): el server sigue corriendo sin su padre, y un cliente herdr
/// (equivalente a adjuntar la TUI) opera contra él.
#[tokio::test]
async fn t15b_server_survives_and_client_attaches() {
    let path = std::env::temp_dir().join("herdr-desk-t15-session.txt");
    if !path.exists() {
        eprintln!("t15a no corrio; saltando");
        return;
    }
    let name = std::fs::read_to_string(&path).expect("leer nombre");
    let name = name.trim().to_string();

    // 1) sobrevive: sigue running sin haberlo lanzado este test
    let list = herdr_core::cli::session_list().expect("session list");
    assert!(
        list.sessions.iter().any(|s| s.name == name && s.running),
        "el server detached no sobrevivio al cierre de la GUI"
    );

    // 2) attach de un cliente (mismo mecanismo que la TUI): workspace + bridge
    let client = herdr_core::RpcClient::new(herdr_core::paths::pipe_name(
        &herdr_core::paths::session_socket(&name),
    ));
    client
        .call(
            "workspace.create",
            &serde_json::json!({"cwd": env!("CARGO_MANIFEST_DIR"), "label": "t15", "focus": true}),
        )
        .await
        .expect("workspace.create en el server huerfano");

    let raw = client.snapshot_raw().await.expect("snapshot");
    let snap: SessionSnapshot = serde_json::from_str(&raw).expect("parse");
    let pane = snap.focused_pane_id.expect("focused pane");

    let exe = herdr_core::paths::find_herdr_exe(None).expect("herdr.exe");
    let (bridge, mut events) =
        spawn_bridge(&exe, Some(&name), &pane, 80, 25).expect("bridge attach");
    let deadline = Instant::now() + common::MAX_WAIT;
    let mut got_frame = false;
    loop {
        assert!(Instant::now() < deadline, "sin frame tras attach");
        let ev = tokio::time::timeout(Duration::from_secs(5), events.recv())
            .await
            .expect("frame")
            .expect("canal");
        if matches!(
            ev,
            herdr_core::terminal::BridgeEvent::Frame { full: true, .. }
        ) {
            got_frame = true;
            break;
        }
    }
    assert!(got_frame, "el attach del cliente no recibio frames");
    bridge.release();

    // 3) cleanup de la sesión sandbox
    let _ = herdr_core::cli::stop_session(&name);
    let _ = herdr_core::cli::delete_session(&name);
    let _ = std::fs::remove_file(&path);
}
