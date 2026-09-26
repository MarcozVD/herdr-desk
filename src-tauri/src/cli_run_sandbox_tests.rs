#![cfg(all(test, feature = "sandbox"))]

//! cli_run y agent_kinds contra el CLI real (sesion sandbox del entorno de test;
//! comandos de SOLO LECTURA de la lista blanca).

use crate::commands::cli_run::{agent_kinds, run_whitelisted};

fn argv(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

/// `herdr agent start --help` de verdad: exit 0 y possible values en stdout.
#[tokio::test]
async fn cli_run_agent_start_help_real() {
    let out = run_whitelisted(&argv(&["herdr", "agent", "start", "--help"]))
        .await
        .expect("ejecucion whitelisted");
    assert_eq!(
        out.exit_code, 0,
        "stderr: {} / stdout: {}",
        out.stderr, out.stdout
    );
    assert!(
        out.stdout.contains("[possible values:"),
        "la ayuda real no trae possible values: {}",
        out.stdout
    );
    assert!(out.stderr.trim().is_empty());
}

/// `herdr status --json` de verdad (solo lectura): exit 0 y JSON objeto.
#[tokio::test]
async fn cli_run_status_json_real() {
    let out = run_whitelisted(&argv(&["herdr", "status", "--json"]))
        .await
        .expect("ejecucion whitelisted");
    assert_eq!(out.exit_code, 0, "stderr: {}", out.stderr);
    let value: serde_json::Value =
        serde_json::from_str(out.stdout.trim()).expect("status --json devuelve JSON");
    assert!(value.is_object());
}

/// agent_kinds con refresh manual: lista real de kinds desde la ayuda viva.
#[tokio::test]
async fn agent_kinds_from_real_help() {
    let kinds = agent_kinds(Some(true)).await.expect("agent_kinds");
    assert!(kinds.reason.is_none(), "motivo: {:?}", kinds.reason);
    assert!(!kinds.cached);
    assert!(kinds.kinds.len() >= 10, "kinds: {:?}", kinds.kinds);
    assert!(kinds.kinds.contains(&"opencode".to_string()));

    // segunda llamada: cache
    let cached = agent_kinds(None).await.expect("agent_kinds cache");
    assert!(cached.cached);
    assert_eq!(cached.kinds, kinds.kinds);
}
