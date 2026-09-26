#![cfg(all(test, feature = "sandbox"))]

//! Catalogo de la consola API (T4.5) en sesion sandbox hd-test-*: el schema
//! real se normaliza una vez y queda cacheado; ademas sirve de guardarrail:
//! todo metodo RPC que herdr-desk invoca debe existir en el catalogo.

use std::sync::Arc;

use crate::commands::api_catalog::{ApiCatalog, build_catalog_cached};
use crate::sandbox_guard::Sandbox;

/// En sesion sandbox: el catalogo se construye del schema real y se cachea.
#[tokio::test]
async fn catalogo_en_sesion_sandbox() {
    let _sandbox = Sandbox::start();

    let first = build_catalog_cached(false).await.expect("catalogo");
    assert_eq!(first.protocol, 19);
    assert!(first.total >= 80, "total: {}", first.total);
    assert_eq!(first.methods.len(), first.total);

    let second = build_catalog_cached(false)
        .await
        .expect("catalogo cacheado");
    assert!(Arc::ptr_eq(&first, &second), "debe venir de cache");
}

/// Guardarrail: los metodos que herdr-desk invoca hoy existen en el schema.
#[tokio::test]
async fn metodos_usados_por_herdr_desk_estan_en_el_catalogo() {
    let catalog: Arc<ApiCatalog> = build_catalog_cached(false).await.expect("catalogo");
    let usados = [
        "ping",
        "session.snapshot",
        "workspace.create",
        "workspace.close",
        "events.subscribe",
        "server.reload_config",
        "server.agent_manifests",
        "server.reload_agent_manifests",
        "notification.show",
        "worktree.list",
        "worktree.create",
        "worktree.open",
        "worktree.remove",
        "plugin.list",
        "plugin.enable",
        "plugin.disable",
        "plugin.link",
        "plugin.unlink",
        "plugin.action.list",
        "plugin.action.invoke",
        "plugin.log.list",
        "plugin.pane.open",
        "plugin.pane.focus",
        "plugin.pane.close",
        "integration.install",
        "integration.uninstall",
    ];
    for method in usados {
        assert!(
            catalog.methods.iter().any(|m| m.method == method),
            "{method} no esta en el schema protocolo {}",
            catalog.protocol
        );
    }
}

/// El schema de params es pintable: cada param tiene kind conocido y los
/// object anidan propiedades (o quedan como object vacio).
#[tokio::test]
async fn params_normalizados_son_pintables() {
    let catalog = build_catalog_cached(false).await.expect("catalogo");
    const KINDS: [&str; 9] = [
        "string", "bool", "int", "float", "enum", "array", "object", "map", "unknown",
    ];
    for method in &catalog.methods {
        for param in &method.params {
            assert!(
                KINDS.contains(&param.kind.as_str()),
                "{}.{}: kind {}",
                method.method,
                param.name,
                param.kind
            );
            if param.kind == "object" {
                assert!(
                    param.properties.is_some(),
                    "{}.{}",
                    method.method,
                    param.name
                );
            }
            if param.kind == "enum" {
                assert!(param.enum_values.is_some());
            }
        }
    }
}
