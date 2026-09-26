#![cfg(all(test, feature = "sandbox"))]

//! plugin.* contra el server real en sesion sandbox hd-test-*. El registro de
//! plugins es GLOBAL (config dir del usuario): el test crea un plugin local
//! temporal con id unico, lo ejercita y lo desvincula al final (neto cero).
//! La instalacion desde GitHub NO se ejecuta aqui (red + home real); sus
//! guards se cubren en unitarios y la vista previa con validacion temprana.

use std::path::PathBuf;

use crate::commands::plugins::{
    PluginLinkRequest, PluginUnlinkRequest, plugin_action_list_rpc, plugin_link_rpc,
    plugin_list_rpc, plugin_logs_rpc, plugin_set_enabled_rpc, plugin_unlink_rpc,
    parse_plugin_wrapped,
};
use crate::sandbox_guard::Sandbox;

fn test_plugin_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "herdr-desk-plugin-sandbox-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("dir de plugin temporal");
    let manifest = format!(
        "id = \"hd-test-plugin-{}\"\nname = \"hd-test-plugin\"\nversion = \"0.1.0\"\nmin_herdr_version = \"0.8.0\"\ndescription = \"plugin de prueba sandbox\"\n",
        std::process::id()
    );
    std::fs::write(dir.join("herdr-plugin.toml"), manifest).expect("manifiesto");
    dir
}

/// plugin.link -> plugin.list -> disable -> enable -> action.list -> logs ->
/// plugin.unlink (guard de confirm + real). Neto cero en el registro global.
#[tokio::test]
async fn plugin_lifecycle_real() {
    let sandbox = Sandbox::start();
    let client = sandbox.client();
    let dir = test_plugin_dir();
    let plugin_id = format!("hd-test-plugin-{}", std::process::id());

    // 1) lista inicial (snapshot para verificar neto cero al final)
    let before = plugin_list_rpc(&client, None).await.expect("plugin.list");
    assert!(before.iter().all(|p| p.plugin_id != plugin_id));

    // 2) link local real (contrato verificado con la CLI: herdr-plugin.toml)
    let linked = plugin_link_rpc(
        &client,
        &PluginLinkRequest {
            path: dir.to_string_lossy().to_string(),
            enabled: None,
        },
    )
    .await
    .expect("plugin.link");
    assert_eq!(linked.plugin_id, plugin_id);
    assert!(linked.enabled);
    assert_eq!(linked.source.as_ref().map(|s| s.kind.as_str()), Some("local"));

    // 3) aparece en la lista con sus colecciones vacias (manifiesto minimo)
    let list = plugin_list_rpc(&client, None).await.expect("plugin.list");
    let entry = list
        .iter()
        .find(|p| p.plugin_id == plugin_id)
        .expect("plugin en list");
    assert_eq!(entry.name, "hd-test-plugin");
    assert_eq!(entry.version, "0.1.0");
    assert!(entry.actions.is_empty() && entry.panes.is_empty() && entry.events.is_empty());

    // 4) disable -> enabled=false; enable -> enabled=true
    let disabled = plugin_set_enabled_rpc(&client, &plugin_id, false)
        .await
        .expect("plugin.disable");
    assert!(!disabled.enabled);
    let enabled = plugin_set_enabled_rpc(&client, &plugin_id, true)
        .await
        .expect("plugin.enable");
    assert!(enabled.enabled);

    // 5) acciones y logs del plugin (manifiesto minimo: vacios pero tipados)
    let actions = plugin_action_list_rpc(&client, Some(&plugin_id))
        .await
        .expect("plugin.action.list");
    assert!(actions.is_empty());
    let logs = plugin_logs_rpc(&client, Some(&plugin_id), Some(10))
        .await
        .expect("plugin.log.list");
    assert!(logs.is_empty());

    // 6) unlink sin confirm: guard del contrato
    let err = plugin_unlink_rpc(
        &client,
        &PluginUnlinkRequest {
            plugin_id: plugin_id.clone(),
            confirm: None,
        },
    )
    .await
    .expect_err("sin confirm no desvincula");
    assert_eq!(err.code, "invalid_params");

    // 7) unlink real con confirm
    let removed = plugin_unlink_rpc(
        &client,
        &PluginUnlinkRequest {
            plugin_id: plugin_id.clone(),
            confirm: Some(true),
        },
    )
    .await
    .expect("plugin.unlink");
    assert!(removed.removed);
    assert_eq!(removed.plugin_id, plugin_id);

    // 8) neto cero
    let after = plugin_list_rpc(&client, None)
        .await
        .expect("plugin.list final");
    assert_eq!(after.len(), before.len(), "neto cero: {:?} vs {:?}", after, before);

    let _ = std::fs::remove_dir_all(&dir);
}

/// Errores tipados del server para plugins desconocidos (enable/unlink).
#[tokio::test]
async fn plugin_desconocido_da_error_de_server() {
    let sandbox = Sandbox::start();
    let client = sandbox.client();

    let err = plugin_set_enabled_rpc(&client, "hd-no-existe-xyz", true)
        .await
        .expect_err("enable de plugin inexistente");
    assert!(
        matches!(err.code.as_str(), "server" | "plugin_not_found" | "not_found"),
        "{}",
        err.code
    );

    let err = plugin_unlink_rpc(
        &client,
        &PluginUnlinkRequest {
            plugin_id: "hd-no-existe-xyz".to_string(),
            confirm: Some(true),
        },
    )
    .await
    .expect_err("unlink de plugin inexistente");
    assert!(
        matches!(err.code.as_str(), "server" | "plugin_not_found" | "not_found"),
        "{}",
        err.code
    );
}

/// Vista previa con spec invalido muere antes de tocar la red ni el CLI.
#[tokio::test]
async fn preview_con_spec_invalido_falla_temprano() {
    let err = crate::commands::plugins::plugin_install_preview_rpc("no-es-un-spec", None)
        .await
        .expect_err("spec invalido");
    assert_eq!(err.code, "invalid_params");
}

/// Parseo del resultado plugin_enabled con la fixture real (envoltorio vivo).
#[test]
fn parsea_envoltorio_plugin_enabled() {
    let mut v = serde_json::from_str::<serde_json::Value>(
        std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../schema/fixtures/plugin_link.json"),
        )
        .expect("fixture")
        .as_str(),
    )
    .expect("json");
    v["result"]["type"] = serde_json::json!("plugin_enabled");
    let plugin = parse_plugin_wrapped(&v["result"], "plugin_enabled").expect("parseo");
    assert_eq!(plugin.plugin_id, "hd-probe");
}
