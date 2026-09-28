use serde::{Deserialize, Serialize};
use serde_json::json;

use herdr_core::error::ApiError;

use crate::state::AppState;

// ---------------------------------------------------------------------------
// Contrato (schema/herdr-api.schema.json, protocolo 19):
//   integration.install   {target: IntegrationTarget} -> integration_install
//                         {type, target, details: {messages: string[]}}
//   integration.uninstall {target: IntegrationTarget} -> integration_uninstall
// IntegrationTarget (enum del schema): pi, omp, claude, codex, copilot, devin,
// droid, kimi, opencode, kilo, hermes, qodercli, cursor, mastracode,
// antigravity_cli, grok.
// El estado se lee de `herdr integration status` (CLI, texto; la CLI no trae
// --json: verificado). Formato real por línea:
//   claude: current (v7) (C:\Users\dev\.claude\hooks\herdr-agent-state.ps1)
//   pi: not installed (C:\Users\dev\.pi\agent\extensions\herdr-agent-state.ts)
// ---------------------------------------------------------------------------

pub const INTEGRATION_TARGETS: [&str; 16] = [
    "pi",
    "omp",
    "claude",
    "codex",
    "copilot",
    "devin",
    "droid",
    "kimi",
    "opencode",
    "kilo",
    "hermes",
    "qodercli",
    "cursor",
    "mastracode",
    "antigravity_cli",
    "grok",
];

/// Normaliza el nombre (la CLI usa `antigravity-cli`, el enum del server
/// `antigravity_cli`): minúsculas y `-`→`_`. Rechaza lo que no esté en el enum.
pub fn normalize_target(raw: &str) -> Result<String, ApiError> {
    let target = raw.trim().replace('-', "_").to_ascii_lowercase();
    if INTEGRATION_TARGETS.contains(&target.as_str()) {
        return Ok(target);
    }
    Err(ApiError {
        code: "invalid_params".to_string(),
        message: format!(
            "integración desconocida «{raw}»; válidas: {}",
            INTEGRATION_TARGETS.join(", ")
        ),
    })
}

#[derive(Serialize, Clone, Debug)]
pub struct IntegrationStatusEntry {
    /// Nombre tal cual lo reporta la CLI (p.ej. `antigravity-cli`).
    pub name: String,
    /// not_installed | current | other (cualquier estado nuevo no conocido).
    pub state: String,
    /// Versión entre paréntesis del estado (`current (v7)` → `v7`).
    pub version: Option<String>,
    /// Ruta del archivo de integración reportada por la CLI.
    pub path: String,
    /// Texto de estado crudo, para estados futuros que la UI quiera mostrar.
    pub raw: String,
}

/// Parsea la salida real de `herdr integration status` (fixture
/// integration_status.txt). Líneas sin el formato `nombre: estado (ruta)` se
/// ignoran (la CLI no las emite hoy; defensa contra cambios de formato).
pub fn parse_integration_status(stdout: &str) -> Vec<IntegrationStatusEntry> {
    let mut entries = Vec::new();
    for line in stdout.lines() {
        let line = line.trim_end();
        if line.trim().is_empty() {
            continue;
        }
        let Some((name, rest)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim().to_string();
        let rest = rest.trim();
        // ruta: último paréntesis de la línea
        let (state_text, path) = match rest.rfind('(') {
            Some(open) if rest.ends_with(')') => (
                rest[..open].trim_end().to_string(),
                rest[open + 1..rest.len() - 1].to_string(),
            ),
            _ => (rest.to_string(), String::new()),
        };
        let (state, version) = if state_text.eq_ignore_ascii_case("not installed") {
            ("not_installed".to_string(), None)
        } else if state_text.starts_with("current") {
            // `current (v7)` → versión dentro del paréntesis del estado
            let version = state_text.find('(').and_then(|open| {
                state_text[open + 1..]
                    .find(')')
                    .map(|end| state_text[open + 1..open + 1 + end].to_string())
            });
            ("current".to_string(), version)
        } else {
            ("other".to_string(), None)
        };
        entries.push(IntegrationStatusEntry {
            name,
            state,
            version,
            path,
            raw: state_text,
        });
    }
    entries
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct IntegrationOpDetails {
    pub messages: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct IntegrationOpResult {
    /// Nombre normalizado (enum del server, p.ej. `antigravity_cli`).
    pub target: String,
    pub messages: Vec<String>,
}

fn parse_op_result(
    result: &serde_json::Value,
    expected_type: &str,
) -> Result<IntegrationOpResult, ApiError> {
    #[derive(Deserialize)]
    struct D {
        #[serde(rename = "type")]
        result_type: String,
        target: String,
        details: IntegrationOpDetails,
    }
    let d: D = serde_json::from_value(result.clone()).map_err(|e| ApiError {
        code: "server".to_string(),
        message: format!("respuesta {expected_type} malformada: {e}"),
    })?;
    if d.result_type != expected_type {
        return Err(ApiError {
            code: "server".to_string(),
            message: format!(
                "el server respondió {} en lugar de {expected_type}",
                d.result_type
            ),
        });
    }
    Ok(IntegrationOpResult {
        target: d.target,
        messages: d.details.messages,
    })
}

async fn integration_op(
    client: &herdr_core::RpcClient,
    method: &str,
    expected_type: &str,
    target: &str,
) -> Result<IntegrationOpResult, ApiError> {
    let normalized = normalize_target(target)?;
    let result = client
        .call(method, &json!({ "target": normalized }))
        .await
        .map_err(|e| e.api())?;
    let mut parsed = parse_op_result(&result, expected_type)?;
    parsed.target = normalized;
    Ok(parsed)
}

/// Estado de las integraciones, parseado de la CLI real (lista blanca).
#[tauri::command]
pub async fn integration_status() -> Result<Vec<IntegrationStatusEntry>, ApiError> {
    let argv: Vec<String> = ["herdr", "integration", "status"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let out = super::cli_run::run_whitelisted(&argv).await?;
    if out.exit_code != 0 {
        return Err(ApiError {
            code: "cli_failed".to_string(),
            message: format!(
                "herdr integration status salió con código {}: {}",
                out.exit_code,
                out.stderr.trim()
            ),
        });
    }
    Ok(parse_integration_status(&out.stdout))
}

/// Instala la integración para un agente (target normalizado al enum del server).
#[tauri::command]
pub async fn integration_install(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    target: String,
) -> Result<IntegrationOpResult, ApiError> {
    let client = state.current().client.clone();
    integration_op(
        &client,
        "integration.install",
        "integration_install",
        &target,
    )
    .await
}

/// Desinstala la integración para un agente (target normalizado).
#[tauri::command]
pub async fn integration_uninstall(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    target: String,
) -> Result<IntegrationOpResult, ApiError> {
    let client = state.current().client.clone();
    integration_op(
        &client,
        "integration.uninstall",
        "integration_uninstall",
        &target,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> String {
        std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../schema/fixtures/integration_status.txt"),
        )
        .expect("fixture de integration status")
    }

    #[test]
    fn parsea_fixture_real_de_integration_status() {
        let entries = parse_integration_status(&fixture());
        assert!(entries.len() >= 11, "la CLI reporta 11 integraciones");
        let claude = entries.iter().find(|e| e.name == "claude").expect("claude");
        assert_eq!(claude.state, "current");
        assert_eq!(claude.version.as_deref(), Some("v7"));
        assert!(claude.path.ends_with("herdr-agent-state.ps1"));

        let pi = entries.iter().find(|e| e.name == "pi").expect("pi");
        assert_eq!(pi.state, "not_installed");
        assert_eq!(pi.version, None);
        assert!(pi.path.ends_with("herdr-agent-state.ts"));

        let anti = entries
            .iter()
            .find(|e| e.name == "antigravity-cli")
            .expect("antigravity-cli");
        assert_eq!(anti.state, "not_installed");
        assert!(anti.path.contains(".gemini"));
    }

    #[test]
    fn normaliza_guiones_y_mayusculas() {
        assert_eq!(
            normalize_target("antigravity-cli").unwrap(),
            "antigravity_cli"
        );
        assert_eq!(normalize_target("OpenCode").unwrap(), "opencode");
        assert_eq!(normalize_target("  claude  ").unwrap(), "claude");
        for known in INTEGRATION_TARGETS {
            assert!(normalize_target(known).is_ok());
        }
    }

    #[test]
    fn rechaza_target_desconocido() {
        for bad in ["", "no-existe", "claude; rm", "agent_pro"] {
            let err = normalize_target(bad).expect_err("debe rechazar");
            assert_eq!(err.code, "invalid_params", "target: {bad}");
            assert!(err.message.contains("válidas"), "{}", err.message);
        }
    }

    #[test]
    fn lineas_sin_formato_se_ignoran() {
        let entries = parse_integration_status("texto suelto\n\nfoo sin dos puntos\n");
        assert!(entries.is_empty());
    }

    #[test]
    fn estado_desconocido_cae_en_other_con_raw() {
        let entries = parse_integration_status("x: outdated (v1 → v2) (C\\ruta\\a.ts)\n");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].state, "other");
        assert_eq!(entries[0].raw, "outdated (v1 → v2)");
        assert!(entries[0].path.ends_with("a.ts"));
    }
}
