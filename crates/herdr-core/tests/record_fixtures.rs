#![cfg(feature = "sandbox")]

use std::sync::Arc;
use std::time::{Duration, Instant};

use herdr_core::model::SessionSnapshot;
use herdr_core::{RpcClient, events};
use serde_json::json;

mod common;

use common::Sandbox;

/// T1.1: graba respuestas y eventos reales del sandbox en schema/fixtures/.
/// Solo graba si RECORD_FIXTURES=1; si no, valida que los eventos parseen.
#[tokio::test]
async fn record_fixtures() {
    let record = std::env::var("RECORD_FIXTURES").ok().as_deref() == Some("1");
    let sb = Sandbox::start();
    common::wait_session_running(&sb.name).await;
    let client = Arc::new(sb.client());

    let (ev_tx, mut ev_rx) = tokio::sync::mpsc::channel(256);
    let kick = Arc::new(tokio::sync::Notify::new());
    tokio::spawn(events::run(sb.pipe(), ev_tx, kick));

    let mut seen: std::collections::BTreeMap<String, serde_json::Value> =
        std::collections::BTreeMap::new();
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let fixtures_dir = manifest_dir.join("../../schema/fixtures/events");

    let mut collect = |seen: &mut std::collections::BTreeMap<String, serde_json::Value>,
                       ev: herdr_core::model::EventEnvelope| {
        seen.entry(ev.event.clone())
            .or_insert_with(|| json!({"event": ev.event, "data": ev.data}));
    };

    // workspace (create + rename + focus)
    client
        .call(
            "workspace.create",
            &json!({"cwd": env!("CARGO_MANIFEST_DIR"), "label": "fx", "focus": true}),
        )
        .await
        .expect("workspace.create");
    let raw = client.snapshot_raw().await.expect("snapshot");
    let snap: SessionSnapshot = serde_json::from_str(&raw).expect("parse");
    let ws = snap.workspaces[0].workspace_id.clone();
    let pane = snap.focused_pane_id.clone().expect("focused pane");

    client
        .call(
            "workspace.rename",
            &json!({"workspace_id": ws, "label": "fx-r"}),
        )
        .await
        .expect("rename");
    client
        .call("workspace.focus", &json!({"workspace_id": ws}))
        .await
        .expect("focus");

    // tab rename
    let tab = snap.tabs[0].tab_id.clone();
    client
        .call("tab.rename", &json!({"tab_id": tab, "label": "fx-t"}))
        .await
        .expect("tab.rename");

    // pane split + focus
    client
        .call(
            "pane.split",
            &json!({"direction": "down", "target_pane_id": pane}),
        )
        .await
        .expect("split");
    let raw = client.snapshot_raw().await.expect("snapshot 2");
    let snap2: SessionSnapshot = serde_json::from_str(&raw).expect("parse 2");
    if let Some(new_pane) = snap2.panes.iter().find(|p| p.pane_id != pane) {
        client
            .call("pane.focus", &json!({"pane_id": new_pane.pane_id}))
            .await
            .expect("pane.focus");
        client
            .call(
                "pane.rename",
                &json!({"pane_id": new_pane.pane_id, "label": "fx-p"}),
            )
            .await
            .ok();
    }

    // agente simulado
    client
        .call(
            "pane.report_agent",
            &json!({"pane_id": pane, "source": "custom:fx", "agent": "fx-bot", "state": "working"}),
        )
        .await
        .expect("report_agent");
    client
        .call(
            "pane.release_agent",
            &json!({"pane_id": pane, "agent": "fx-bot", "source": "custom:fx"}),
        )
        .await
        .expect("release_agent");

    // drenar eventos unos segundos
    let deadline = Instant::now() + Duration::from_secs(6);
    while Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_millis(250), ev_rx.recv()).await {
            Ok(Some(ev)) => collect(&mut seen, ev),
            _ => {}
        }
    }

    // snapshot fixture
    let snapshot_fix = json!({"event": "session.snapshot", "data": serde_json::from_str::<serde_json::Value>(&client.snapshot_raw().await.expect("snapshot final")).unwrap_or(json!({}))});
    seen.insert("session.snapshot".to_string(), snapshot_fix);

    let types: Vec<String> = seen.keys().cloned().collect();
    println!("fixtures capturados: {types:?}");

    if record {
        std::fs::create_dir_all(&fixtures_dir).expect("create fixtures dir");
        for (name, body) in &seen {
            let path = fixtures_dir.join(format!("{name}.json"));
            std::fs::write(&path, serde_json::to_string_pretty(body).expect("json"))
                .expect("write fixture");
        }
        println!(
            "escritos {} fixtures en {}",
            seen.len(),
            fixtures_dir.display()
        );
    }

    // los capturados deben parsear como EventData tipada
    for (name, body) in &seen {
        if name == "session.snapshot" {
            continue;
        }
        let env: herdr_core::model::EventEnvelope =
            serde_json::from_value(body.clone()).expect("envelope");
        assert!(env.typed().is_some(), "{name} no parsea a EventData tipada");
    }
}
