use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use herdr_core::error::ApiError;

use crate::state::AppState;

// ---------------------------------------------------------------------------
// Contrato (schema/herdr-api.schema.json, protocolo 19):
//   ping                          -> pong {type, version, protocol, capabilities?}
//   server.agent_manifests {}     -> agent_manifest_status {type, manifests,
//                                    last_check_unix?, last_result?}
//   server.reload_agent_manifests {} -> agent_manifest_reload {type, manifests}
// Mas parseo de `herdr status --json` (salida real, fixture status_json.json).
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ServerCapabilitiesReport {
    #[serde(default)]
    pub live_handoff: Option<bool>,
    #[serde(default)]
    pub detached_server_daemon: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CliServerStatus {
    pub status: Option<String>,
    pub running: Option<bool>,
    pub version: Option<String>,
    pub protocol: Option<u32>,
    pub compatible: Option<bool>,
    pub socket: Option<String>,
    pub session: Option<String>,
    pub restart_needed: Option<bool>,
    pub capabilities: Option<ServerCapabilitiesReport>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CliClientStatus {
    pub version: Option<String>,
    pub channel: Option<String>,
    pub protocol: Option<u32>,
    pub binary: Option<String>,
    pub session: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct CliStatusReport {
    pub client: Option<CliClientStatus>,
    pub server: Option<CliServerStatus>,
    pub update: Option<Value>,
}

#[derive(Serialize, Clone, Debug)]
pub struct LiveServerStatus {
    pub version: String,
    pub protocol: u32,
    pub capabilities: Option<ServerCapabilitiesReport>,
}

/// Estado combinado: lo que reporta la CLI (sesion por defecto) y el ping
/// vivo de la sesion activa de la GUI. Ninguno de los dos es fatal: se degrada
/// con el campo de error correspondiente.
#[derive(Serialize, Clone, Debug)]
pub struct ServerStatusReport {
    pub cli: Option<CliStatusReport>,
    pub cli_error: Option<String>,
    pub live: Option<LiveServerStatus>,
    pub live_error: Option<String>,
}

/// Parsea la salida real de `herdr status --json` (fixture status_json.json).
pub fn parse_status_json(stdout: &str) -> Result<CliStatusReport, ApiError> {
    #[derive(Deserialize)]
    struct D {
        #[serde(default)]
        client: Option<CliClientStatus>,
        #[serde(default)]
        server: Option<CliServerStatus>,
        #[serde(default)]
        update: Option<Value>,
    }
    let d: D = serde_json::from_str(stdout.trim()).map_err(|e| ApiError {
        code: "parse".to_string(),
        message: format!("status --json no es el JSON esperado: {e}"),
    })?;
    Ok(CliStatusReport {
        client: d.client,
        server: d.server,
        update: d.update,
    })
}

async fn ping_live(client: &herdr_core::RpcClient) -> Result<LiveServerStatus, ApiError> {
    let result = client.call("ping", &json!({})).await.map_err(|e| e.api())?;
    let version = result["version"]
        .as_str()
        .ok_or_else(|| ApiError {
            code: "parse".to_string(),
            message: "ping sin version".to_string(),
        })?
        .to_string();
    let protocol = result["protocol"].as_u64().ok_or_else(|| ApiError {
        code: "parse".to_string(),
        message: "ping sin protocolo".to_string(),
    })? as u32;
    Ok(LiveServerStatus {
        version,
        protocol,
        capabilities: result
            .get("capabilities")
            .cloned()
            .and_then(|c| serde_json::from_value(c).ok()),
    })
}

/// Núcleo reutilizable (tests): CLI status --json + ping de la sesión activa.
pub(crate) async fn server_status_report(
    client: Option<&herdr_core::RpcClient>,
) -> Result<ServerStatusReport, ApiError> {
    let argv: Vec<String> = ["herdr", "status", "--json"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let (cli, cli_error) = match super::cli_run::run_whitelisted(&argv).await {
        Ok(out) if out.exit_code == 0 => match parse_status_json(&out.stdout) {
            Ok(report) => (Some(report), None),
            Err(e) => (None, Some(e.message)),
        },
        Ok(out) => (
            None,
            Some(format!(
                "herdr status --json salió con código {}: {}",
                out.exit_code,
                out.stderr.trim()
            )),
        ),
        Err(e) => (None, Some(e.message)),
    };

    let (live, live_error) = match client {
        Some(c) => match ping_live(c).await {
            Ok(l) => (Some(l), None),
            Err(e) => (None, Some(e.message)),
        },
        None => (None, Some("sin cliente de sesión activa".to_string())),
    };

    Ok(ServerStatusReport {
        cli,
        cli_error,
        live,
        live_error,
    })
}

#[tauri::command]
pub async fn server_status(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
) -> Result<ServerStatusReport, ApiError> {
    let client = state.current().client.clone();
    server_status_report(Some(&client)).await
}

// ---------------------------------------------------------------------------
// Manifests de agentes
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AgentManifestInfo {
    pub agent: String,
    pub source: String,
    pub source_kind: String,
    pub local_override_shadowing_remote: bool,
    #[serde(default)]
    pub active_version: Option<String>,
    #[serde(default)]
    pub cached_remote_version: Option<String>,
    #[serde(default)]
    pub remote_last_checked_unix: Option<u64>,
    #[serde(default)]
    pub remote_update_error: Option<String>,
    #[serde(default)]
    pub remote_update_result: Option<String>,
    #[serde(default)]
    pub warning: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct AgentManifestStatus {
    pub manifests: Vec<AgentManifestInfo>,
    pub last_check_unix: Option<u64>,
    pub last_result: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct AgentManifestReload {
    pub manifests: Vec<AgentManifestInfo>,
}

fn parse_manifest_status(result: &Value) -> Result<AgentManifestStatus, ApiError> {
    #[derive(Deserialize)]
    struct D {
        #[serde(rename = "type")]
        result_type: String,
        manifests: Vec<AgentManifestInfo>,
        #[serde(default)]
        last_check_unix: Option<u64>,
        #[serde(default)]
        last_result: Option<String>,
    }
    let d: D = serde_json::from_value(result.clone()).map_err(|e| ApiError {
        code: "server".to_string(),
        message: format!("respuesta agent_manifest_status malformada: {e}"),
    })?;
    if d.result_type != "agent_manifest_status" {
        return Err(ApiError {
            code: "server".to_string(),
            message: format!(
                "el server respondió {} en lugar de agent_manifest_status",
                d.result_type
            ),
        });
    }
    Ok(AgentManifestStatus {
        manifests: d.manifests,
        last_check_unix: d.last_check_unix,
        last_result: d.last_result,
    })
}

fn parse_manifest_reload(result: &Value) -> Result<AgentManifestReload, ApiError> {
    #[derive(Deserialize)]
    struct D {
        #[serde(rename = "type")]
        result_type: String,
        manifests: Vec<AgentManifestInfo>,
    }
    let d: D = serde_json::from_value(result.clone()).map_err(|e| ApiError {
        code: "server".to_string(),
        message: format!("respuesta agent_manifest_reload malformada: {e}"),
    })?;
    if d.result_type != "agent_manifest_reload" {
        return Err(ApiError {
            code: "server".to_string(),
            message: format!(
                "el server respondió {} en lugar de agent_manifest_reload",
                d.result_type
            ),
        });
    }
    Ok(AgentManifestReload {
        manifests: d.manifests,
    })
}

pub(crate) async fn agent_manifests_rpc(
    client: &herdr_core::RpcClient,
) -> Result<AgentManifestStatus, ApiError> {
    let result = client
        .call("server.agent_manifests", &json!({}))
        .await
        .map_err(|e| e.api())?;
    parse_manifest_status(&result)
}

pub(crate) async fn agent_manifests_reload_rpc(
    client: &herdr_core::RpcClient,
) -> Result<AgentManifestReload, ApiError> {
    let result = client
        .call("server.reload_agent_manifests", &json!({}))
        .await
        .map_err(|e| e.api())?;
    parse_manifest_reload(&result)
}

#[tauri::command]
pub async fn agent_manifests(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
) -> Result<AgentManifestStatus, ApiError> {
    let client = state.current().client.clone();
    agent_manifests_rpc(&client).await
}

#[tauri::command]
pub async fn agent_manifests_reload(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
) -> Result<AgentManifestReload, ApiError> {
    let client = state.current().client.clone();
    agent_manifests_reload_rpc(&client).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parsea_fixture_real_de_status_json() {
        let raw = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../schema/fixtures/status_json.json"),
        )
        .expect("fixture de status --json");
        let report = parse_status_json(&raw).expect("parseo");
        let client = report.client.expect("client");
        assert!(!client.version.unwrap_or_default().is_empty());
        assert_eq!(client.protocol, Some(19));
        let server = report.server.expect("server");
        assert_eq!(server.running, Some(true));
        assert_eq!(server.protocol, Some(19));
        assert_eq!(server.compatible, Some(true));
        let caps = server.capabilities.expect("capabilities");
        assert!(caps.live_handoff.is_some());
    }

    #[test]
    fn status_json_malformado_da_error_tipado() {
        let err = parse_status_json("no es json").expect_err("debe fallar");
        assert_eq!(err.code, "parse");
    }

    #[test]
    fn ping_parsea_version_protocolo_y_capabilities() {
        let report = ServerStatusReport {
            cli: None,
            cli_error: None,
            live: Some(LiveServerStatus {
                version: "0.8.0".to_string(),
                protocol: 19,
                capabilities: Some(ServerCapabilitiesReport {
                    live_handoff: Some(false),
                    detached_server_daemon: Some(false),
                }),
            }),
            live_error: None,
        };
        let live = report.live.expect("live");
        assert_eq!(live.protocol, 19);
        assert_eq!(
            live.capabilities.as_ref().unwrap().live_handoff,
            Some(false)
        );
    }

    #[test]
    fn manifests_parsean_info_tipada() {
        let result = json!({
            "type": "agent_manifest_status",
            "manifests": [{
                "agent": "claude",
                "source": "builtin",
                "source_kind": "builtin",
                "local_override_shadowing_remote": false,
                "active_version": "v7"
            }],
            "last_check_unix": 1234u64,
            "last_result": "ok"
        });
        let status = parse_manifest_status(&result).expect("parseo");
        assert_eq!(status.manifests.len(), 1);
        assert_eq!(status.manifests[0].agent, "claude");
        assert_eq!(status.manifests[0].active_version.as_deref(), Some("v7"));
        assert_eq!(status.last_check_unix, Some(1234));

        let reload = json!({
            "type": "agent_manifest_reload",
            "manifests": []
        });
        let r = parse_manifest_reload(&reload).expect("parseo");
        assert!(r.manifests.is_empty());
    }

    #[test]
    fn tipo_inesperado_en_manifests_da_error_de_server() {
        let err = parse_manifest_status(&json!({"type": "pong", "manifests": []}))
            .expect_err("debe fallar");
        assert_eq!(err.code, "server");
    }
}
