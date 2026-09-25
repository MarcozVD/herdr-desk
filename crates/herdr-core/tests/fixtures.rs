//! T1.1: every recorded fixture deserializes, and every EventData variant is
//! covered by a synthetic example (so schema drift in any of the 26 payloads
//! is caught without a live server).

use herdr_core::model::{EventData, EventEnvelope};

fn parse_fixture(name: &str, raw: &str) {
    let env: EventEnvelope = serde_json::from_str(raw)
        .unwrap_or_else(|e| panic!("envelope de {name} no deserializa: {e}"));
    assert_eq!(env.event, name);
    env.typed()
        .unwrap_or_else(|| panic!("{name} no parsea a EventData tipada"));
}

fn sample<T: serde::de::DeserializeOwned>(json: &str) -> T {
    serde_json::from_str(json).expect("variante tipada")
}

#[test]
fn recorded_fixtures_deserialize() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../schema/fixtures/events");
    if !dir.exists() {
        eprintln!("sin fixtures grabados (corre RECORD_FIXTURES=1 ... record_fixtures)");
        return;
    }
    for entry in std::fs::read_dir(&dir).expect("leer fixtures dir") {
        let path = entry.expect("entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let name = path.file_stem().unwrap().to_string_lossy().to_string();
        if name == "session.snapshot" {
            continue;
        }
        let raw = std::fs::read_to_string(&path).expect("leer fixture");
        parse_fixture(&name, &raw);
    }
}

#[test]
fn all_26_event_variants_deserialize() {
    // workspace.*
    sample::<EventData>(
        r#"{"type":"workspace_created","workspace":{"workspace_id":"w1","number":1,"label":"a","focused":true,"pane_count":1,"tab_count":1}}"#,
    );
    sample::<EventData>(
        r#"{"type":"workspace_updated","workspace":{"workspace_id":"w1","number":1,"label":"a","focused":false}}"#,
    );
    sample::<EventData>(
        r#"{"type":"workspace_metadata_updated","workspace":{"workspace_id":"w1","number":1,"label":"a"}}"#,
    );
    sample::<EventData>(r#"{"type":"workspace_closed","workspace_id":"w1","workspace":null}"#);
    sample::<EventData>(r#"{"type":"workspace_renamed","workspace_id":"w1","label":"nuevo"}"#);
    sample::<EventData>(
        r#"{"type":"workspace_moved","workspace_id":"w1","insert_index":2,"workspaces":[]}"#,
    );
    sample::<EventData>(
        r#"{"type":"workspace_reordered","workspace_ids":["w1","w2"],"workspaces":[],"before_workspace_id":null}"#,
    );
    sample::<EventData>(r#"{"type":"workspace_focused","workspace_id":"w1"}"#);
    // worktree.*
    sample::<EventData>(
        r#"{"type":"worktree_created","workspace":{"workspace_id":"w1","number":1,"label":"a"},"worktree":{"path":"C:/t","label":"t","is_bare":false,"is_detached":false,"is_prunable":false,"is_linked_worktree":true}}"#,
    );
    sample::<EventData>(
        r#"{"type":"worktree_opened","workspace":{"workspace_id":"w1","number":1,"label":"a"},"worktree":{"path":"C:/t","label":"t"},"already_open":false}"#,
    );
    sample::<EventData>(
        r#"{"type":"worktree_removed","workspace_id":"w1","worktree":{"path":"C:/t","label":"t"},"forced":true}"#,
    );
    // tab.*
    sample::<EventData>(
        r#"{"type":"tab_created","tab":{"tab_id":"w1:t1","workspace_id":"w1","number":1,"label":"1","focused":true,"pane_count":1}}"#,
    );
    sample::<EventData>(r#"{"type":"tab_closed","tab_id":"w1:t1","workspace_id":"w1"}"#);
    sample::<EventData>(
        r#"{"type":"tab_renamed","tab_id":"w1:t1","workspace_id":"w1","label":"x"}"#,
    );
    sample::<EventData>(
        r#"{"type":"tab_moved","tab_id":"w1:t1","workspace_id":"w1","insert_index":0,"tabs":[]}"#,
    );
    sample::<EventData>(r#"{"type":"tab_focused","tab_id":"w1:t1","workspace_id":"w1"}"#);
    // pane.*
    sample::<EventData>(
        r#"{"type":"pane_created","pane":{"pane_id":"w1:p1","workspace_id":"w1","tab_id":"w1:t1","focused":true,"agent_status":"unknown","revision":0}}"#,
    );
    sample::<EventData>(r#"{"type":"pane_closed","pane_id":"w1:p1","workspace_id":"w1"}"#);
    sample::<EventData>(
        r#"{"type":"pane_updated","pane":{"pane_id":"w1:p1","workspace_id":"w1","tab_id":"w1:t1","agent_status":"working","revision":1}}"#,
    );
    sample::<EventData>(r#"{"type":"pane_focused","pane_id":"w1:p1","workspace_id":"w1"}"#);
    sample::<EventData>(
        r#"{"type":"pane_moved","previous_pane_id":"w1:p1","previous_workspace_id":"w1","previous_tab_id":"w1:t1","pane":{"pane_id":"w2:p1","workspace_id":"w2","tab_id":"w2:t1","agent_status":"unknown"}}"#,
    );
    sample::<EventData>(
        r#"{"type":"pane_output_changed","pane_id":"w1:p1","workspace_id":"w1","revision":5}"#,
    );
    sample::<EventData>(r#"{"type":"pane_exited","pane_id":"w1:p1","workspace_id":"w1"}"#);
    sample::<EventData>(
        r#"{"type":"pane_agent_detected","pane_id":"w1:p1","workspace_id":"w1","agent":"opencode","final_status":"working","released":false}"#,
    );
    sample::<EventData>(
        r#"{"type":"pane_agent_status_changed","pane_id":"w1:p1","workspace_id":"w1","agent_status":"blocked","agent":"opencode","display_agent":"OpenCode","title":"esperando","state_labels":{}}"#,
    );
    // layout.*
    sample::<EventData>(
        r#"{"type":"layout_updated","layout":{"workspace_id":"w1","tab_id":"w1:t1","zoomed":false,"focused_pane_id":"w1:p1","panes":[{"pane_id":"w1:p1","focused":true}],"splits":[]}}"#,
    );
}

#[test]
fn unknown_event_type_fails_typed_but_not_envelope() {
    let raw = r#"{"event":"future.thing","data":{"type":"future_thing"}}"#;
    let env: EventEnvelope = serde_json::from_str(raw).expect("envelope tolerante");
    assert!(
        env.typed().is_none(),
        "tipo desconocido no debe parsear tipado"
    );
}

#[test]
fn snapshot_fixture_deserializes() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../schema/fixtures/events/session.snapshot.json");
    if !path.exists() {
        eprintln!("sin fixture de snapshot");
        return;
    }
    let raw = std::fs::read_to_string(&path).expect("leer snapshot fixture");
    let v: serde_json::Value = serde_json::from_str(&raw).expect("json");
    let snap: herdr_core::model::SessionSnapshot =
        serde_json::from_value(v["data"].clone()).expect("session snapshot parsea");
    assert_eq!(snap.protocol, 19);
    assert!(!snap.workspaces.is_empty());
}
