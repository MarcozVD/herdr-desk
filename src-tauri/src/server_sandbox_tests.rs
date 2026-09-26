#![cfg(all(test, feature = "sandbox"))]

//! Estado de server/manifests/integraciones contra la CLI y el server reales
//! en sesion sandbox hd-test-*. Nada que escriba en la config del usuario:
//! install/uninstall de integraciones toca el home real y NO se ejecuta aqui.

use crate::commands::cli_run::run_whitelisted;
use crate::commands::integrations::{normalize_target, parse_integration_status};
use crate::commands::server::{
    agent_manifests_reload_rpc, agent_manifests_rpc, parse_status_json, server_status_report,
};
use crate::sandbox_guard::Sandbox;

fn argv(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

/// status --json de verdad parsea (la CLI corre contra la sesion por defecto
/// de la maquina; si no hay server, se acepta el error tipado).
#[tokio::test]
async fn server_status_cli_y_ping_real() {
    let sandbox = Sandbox::start();
    let report = server_status_report(Some(&sandbox.client()))
        .await
        .expect("reporte");

    // parte CLI: o reporte parseado o error tipado, nunca pánico
    if let Some(cli) = &report.cli {
        assert!(cli.client.is_some(), "{cli:?}");
        if let Some(server) = &cli.server {
            assert_ne!(server.protocol, Some(0));
        }
    } else {
        assert!(report.cli_error.is_some(), "sin cli ni error: {report:?}");
    }

    // ping vivo contra el server de la sesion sandbox (protocolo 19)
    let live = report.live.expect("server sandbox vivo");
    assert_eq!(live.protocol, 19);
    assert!(!live.version.is_empty());
}

/// server.agent_manifests y server.reload_agent_manifests reales: contrato de
/// tipos (agent_manifest_status / agent_manifest_reload) y listas coherentes.
#[tokio::test]
async fn agent_manifests_y_reload_reales() {
    let sandbox = Sandbox::start();
    let client = sandbox.client();

    let status = agent_manifests_rpc(&client).await.expect("agent_manifests");
    for manifest in &status.manifests {
        assert!(!manifest.agent.is_empty());
        assert!(!manifest.source.is_empty());
        assert!(!manifest.source_kind.is_empty());
    }

    let reloaded = agent_manifests_reload_rpc(&client)
        .await
        .expect("reload_agent_manifests");
    // tras el reload, el status refleja la misma poblacion de agentes
    let status2 = agent_manifests_rpc(&client)
        .await
        .expect("agent_manifests 2");
    let mut a: Vec<&str> = reloaded
        .manifests
        .iter()
        .map(|m| m.agent.as_str())
        .collect();
    let mut b: Vec<&str> = status2.manifests.iter().map(|m| m.agent.as_str()).collect();
    a.sort();
    b.sort();
    assert_eq!(a, b);
}

/// `herdr integration status` real (lista blanca) parsea con el formato vivo.
#[tokio::test]
async fn integration_status_real() {
    let out = run_whitelisted(&argv(&["herdr", "integration", "status"]))
        .await
        .expect("integration status whitelisted");
    assert_eq!(out.exit_code, 0, "stderr: {}", out.stderr);
    let entries = parse_integration_status(&out.stdout);
    assert!(entries.len() >= 10, "{entries:?}");
    assert!(entries.iter().any(|e| e.name == "claude"));
    assert!(entries.iter().any(|e| e.name == "antigravity-cli"));
    assert!(
        entries
            .iter()
            .all(|e| matches!(e.state.as_str(), "not_installed" | "current" | "other"))
    );
    // normalizacion de nombres al enum del server
    assert_eq!(
        normalize_target("antigravity-cli").unwrap(),
        "antigravity_cli"
    );
}

/// El parseo del status --json de la CLI acepta la salida viva (no solo fixture).
#[tokio::test]
async fn parse_status_json_con_salida_viva() {
    let out = run_whitelisted(&argv(&["herdr", "status", "--json"]))
        .await
        .expect("status --json whitelisted");
    if out.exit_code == 0 {
        let report = parse_status_json(&out.stdout).expect("JSON vivo valido");
        assert!(report.client.is_some());
    }
    // sin server en la sesion por defecto la CLI puede salir mal: no es fatal
}
