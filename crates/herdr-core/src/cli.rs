use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use crate::paths;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone)]
pub struct CliOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl CliOutput {
    pub fn ok(&self) -> bool {
        self.exit_code == 0
    }
}

pub fn herdr_exe() -> Result<PathBuf, crate::error::HerdrError> {
    paths::find_herdr_exe(None).ok_or(crate::error::HerdrError::Api {
        code: "cli_failed".to_string(),
        message: "no se encontro el ejecutable herdr".to_string(),
    })
}

/// Runs `herdr <args>` against an explicit session. Never inherits HERDR_* env vars.
pub fn run_session_cli(
    args: &[&str],
    session: Option<&str>,
) -> Result<CliOutput, crate::error::HerdrError> {
    let exe = herdr_exe()?;
    let mut cmd = Command::new(exe);
    if let Some(name) = session {
        cmd.args(["--session", name]);
    }
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW);
    for (key, _) in std::env::vars() {
        if key.starts_with("HERDR_") {
            cmd.env_remove(key);
        }
    }
    let out = cmd.output()?;
    Ok(CliOutput {
        exit_code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).to_string(),
        stderr: String::from_utf8_lossy(&out.stderr).to_string(),
    })
}

#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize)]
#[serde(default)]
pub struct CliSessionInfo {
    pub name: String,
    pub running: bool,
    pub default: bool,
    pub socket_path: String,
    pub session_dir: String,
}

#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize)]
#[serde(default)]
pub struct CliSessionList {
    pub sessions: Vec<CliSessionInfo>,
}

pub fn session_list() -> Result<CliSessionList, crate::error::HerdrError> {
    let out = run_session_cli(&["session", "list", "--json"], None)?;
    if !out.ok() {
        return Err(crate::error::HerdrError::Api {
            code: "cli_failed".to_string(),
            message: format!("herdr session list fallo: {}", out.stderr.trim()),
        });
    }
    serde_json::from_str(&out.stdout)
        .map_err(|e| crate::error::HerdrError::Parse(format!("session list: {e}")))
}

const DETACHED_PROCESS: u32 = 0x0000_0008;
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

/// Spawns `herdr --session <name> server` detached: sobrevive al cierre de la GUI
/// y permite que la TUI se adjunte después.
pub fn start_server_detached(name: &str) -> Result<(), crate::error::HerdrError> {
    let exe = herdr_exe()?;
    let mut cmd = Command::new(exe);
    cmd.args(["--session", name, "server"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    for (key, _) in std::env::vars() {
        if key.starts_with("HERDR_") {
            cmd.env_remove(key);
        }
    }
    cmd.spawn().map_err(|e| crate::error::HerdrError::Api {
        code: "cli_failed".to_string(),
        message: format!("no se pudo iniciar el server: {e}"),
    })?;
    Ok(())
}

/// C1 — Compatibilidad cliente/servidor de una sesion: lo que `herdr --session
/// <s> status` reporta y la GUI necesita para no morir en bucle cuando el server
/// es viejo (p. ej. server 0.8.0/protocolo privado 19 con cliente 0.9.1/22).
#[derive(Debug, Clone, Default, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(default)]
pub struct ServerCompat {
    pub running: bool,
    pub server_version: Option<String>,
    pub client_version: Option<String>,
    /// `private_protocol_compatible`: false = los bridges (`terminal session
    /// control`) seran rechazados por el server.
    pub private_protocol_compatible: Option<bool>,
    pub restart_needed: bool,
    pub server_protocol: Option<u64>,
    pub client_protocol: Option<u64>,
    pub server_binary_stale: bool,
}

impl ServerCompat {
    pub fn incompatible(&self) -> bool {
        self.private_protocol_compatible == Some(false)
    }

    /// Mensaje en espanol con las versiones, listo para ApiError o banner.
    pub fn incompatible_message(&self, session: &str) -> String {
        let server = self.server_version.as_deref().unwrap_or("desconocida");
        let client = self.client_version.as_deref().unwrap_or("desconocida");
        let server_protocol = self
            .server_protocol
            .map(|p| p.to_string())
            .unwrap_or_else(|| "desconocido".to_string());
        let client_protocol = self
            .client_protocol
            .map(|p| p.to_string())
            .unwrap_or_else(|| "desconocido".to_string());
        format!(
            "El servidor de la sesion {session} es herdr {server} (protocolo {server_protocol}) y el cliente {client} \
             (protocolo {client_protocol}): reinicia la sesion para usar las terminales."
        )
    }
}

fn json_bool(value: &serde_json::Value) -> Option<bool> {
    value.as_bool()
}

fn json_str(value: &serde_json::Value) -> Option<String> {
    value.as_str().map(str::to_string)
}

/// Parsea el `status --json` de herdr 0.9.x.
pub fn parse_server_status_json(raw: &str) -> Result<ServerCompat, crate::error::HerdrError> {
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|e| crate::error::HerdrError::Parse(format!("status json: {e}")))?;
    let client = &value["client"];
    let server = &value["server"];
    let update = &value["update"];
    let running = json_bool(&server["running"]).unwrap_or_else(|| server["status"] == "running");
    Ok(ServerCompat {
        running,
        server_version: json_str(&server["version"]),
        client_version: json_str(&client["version"]),
        private_protocol_compatible: json_bool(&server["compatible"]),
        restart_needed: json_bool(&server["restart_needed"])
            .or_else(|| json_bool(&update["restart_needed"]))
            .unwrap_or(false),
        server_protocol: server["protocol"].as_u64(),
        client_protocol: client["protocol"].as_u64(),
        server_binary_stale: json_bool(&server["server_binary_stale"])
            .or_else(|| json_bool(&update["server_binary_stale"]))
            .unwrap_or(false),
    })
}

fn parse_text_bool(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "yes" | "true" | "si" | "sí" | "1" => Some(true),
        "no" | "false" | "0" => Some(false),
        "unknown" | "" => None,
        _ => None,
    }
}

/// Respaldo para herdr sin `status --json`: formato texto `clave: valor` con
/// secciones (`client:`, `server:`, `update:`).
pub fn parse_server_status_text(raw: &str) -> Result<ServerCompat, crate::error::HerdrError> {
    let mut compat = ServerCompat::default();
    let mut section = String::new();
    let mut saw_key = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            let key = key.trim();
            let value = value.trim();
            // Seccion: la linea no lleva valor.
            if value.is_empty() && matches!(key, "client" | "server" | "update") {
                section = key.to_string();
                continue;
            }
            saw_key = true;
            match (section.as_str(), key) {
                ("client", "version") => compat.client_version = Some(value.to_string()),
                ("client", "protocol") => compat.client_protocol = value.parse().ok(),
                ("server", "status") => compat.running = value == "running",
                ("server", "version") => compat.server_version = Some(value.to_string()),
                ("server", "private_protocol") => compat.server_protocol = value.parse().ok(),
                ("server", "private_protocol_compatible") => {
                    compat.private_protocol_compatible = parse_text_bool(value);
                }
                ("server", "restart_needed") => {
                    compat.restart_needed = parse_text_bool(value).unwrap_or(false);
                }
                ("server", "server_binary_stale") => {
                    compat.server_binary_stale = parse_text_bool(value).unwrap_or(false);
                }
                ("update", "restart_needed") => {
                    compat.restart_needed |= parse_text_bool(value).unwrap_or(false);
                }
                ("update", "server_binary_stale") => {
                    compat.server_binary_stale |= parse_text_bool(value).unwrap_or(false);
                }
                _ => {}
            }
        }
    }
    if !saw_key {
        return Err(crate::error::HerdrError::Parse(
            "status: salida sin claves reconocibles".to_string(),
        ));
    }
    Ok(compat)
}

/// C1 — `herdr --session <s> status`: usa `--json` cuando la version instalada
/// lo soporta y cae al formato texto si no.
pub fn server_status(session: &str) -> Result<ServerCompat, crate::error::HerdrError> {
    let json = run_session_cli(&["status", "--json"], Some(session))?;
    if json.ok()
        && !json.stdout.trim().is_empty()
        && let Ok(compat) = parse_server_status_json(&json.stdout)
    {
        return Ok(compat);
    }
    let text = run_session_cli(&["status"], Some(session))?;
    if !text.ok() {
        return Err(crate::error::HerdrError::Api {
            code: "cli_failed".to_string(),
            message: format!("herdr status fallo: {}", text.stderr.trim()),
        });
    }
    parse_server_status_text(&text.stdout)
}

pub fn stop_session(name: &str) -> Result<CliOutput, crate::error::HerdrError> {
    run_session_cli(&["session", "stop", name, "--json"], None)
}

pub fn delete_session(name: &str) -> Result<CliOutput, crate::error::HerdrError> {
    run_session_cli(&["session", "delete", name, "--json"], None)
}

#[cfg(test)]
mod server_compat_tests {
    use super::*;

    const JSON_INCOMPATIBLE: &str = r#"{
        "client": {"version": "0.9.1-preview", "protocol": 22},
        "server": {
            "status": "running", "running": true, "version": "0.8.0-preview",
            "protocol": 19, "compatible": false, "restart_needed": true,
            "server_binary_stale": true
        },
        "update": {"restart_needed": true, "server_binary_stale": true}
    }"#;

    #[test]
    fn json_running_incompatible() {
        let compat = parse_server_status_json(JSON_INCOMPATIBLE).expect("parse");
        assert!(compat.running);
        assert_eq!(compat.server_version.as_deref(), Some("0.8.0-preview"));
        assert_eq!(compat.client_version.as_deref(), Some("0.9.1-preview"));
        assert_eq!(compat.private_protocol_compatible, Some(false));
        assert!(compat.restart_needed);
        assert_eq!(compat.server_protocol, Some(19));
        assert_eq!(compat.client_protocol, Some(22));
        assert!(compat.server_binary_stale);
        assert!(compat.incompatible());
    }

    #[test]
    fn json_running_compatible() {
        let raw = r#"{
            "client": {"version": "0.9.1", "protocol": 22},
            "server": {"status": "running", "running": true, "version": "0.9.1", "protocol": 22, "compatible": true}
        }"#;
        let compat = parse_server_status_json(raw).expect("parse");
        assert!(compat.running);
        assert_eq!(compat.private_protocol_compatible, Some(true));
        assert!(!compat.restart_needed);
        assert!(!compat.incompatible());
    }

    #[test]
    fn json_stopped_session() {
        let raw = r#"{
            "client": {"version": "0.9.1", "protocol": 22},
            "server": {"status": "not_running", "running": false, "version": null, "protocol": null, "compatible": null}
        }"#;
        let compat = parse_server_status_json(raw).expect("parse");
        assert!(!compat.running);
        assert_eq!(compat.private_protocol_compatible, None);
        assert_eq!(compat.server_version, None);
        assert!(!compat.incompatible());
    }

    #[test]
    fn text_running_incompatible() {
        let raw = "client:\n  version: 0.9.1-preview\n  protocol: 22\n\nserver:\n  status: running\n  version: 0.8.0-preview\n  private_protocol: 19\n  private_protocol_compatible: no\n\nupdate:\n  restart_needed: yes\n  server_binary_stale: yes\n";
        let compat = parse_server_status_text(raw).expect("parse");
        assert!(compat.running);
        assert_eq!(compat.server_version.as_deref(), Some("0.8.0-preview"));
        assert_eq!(compat.client_version.as_deref(), Some("0.9.1-preview"));
        assert_eq!(compat.private_protocol_compatible, Some(false));
        assert!(compat.restart_needed);
        assert_eq!(compat.server_protocol, Some(19));
        assert_eq!(compat.client_protocol, Some(22));
        assert!(compat.incompatible());
    }

    #[test]
    fn text_sin_claves_falla() {
        assert!(parse_server_status_text("nada util\n").is_err());
    }

    #[test]
    fn mensaje_incluye_versiones_y_sesion() {
        let compat = parse_server_status_json(JSON_INCOMPATIBLE).expect("parse");
        let message = compat.incompatible_message("herdr-desk-dev");
        assert!(message.contains("herdr-desk-dev"), "{message}");
        assert!(message.contains("0.8.0-preview"), "{message}");
        assert!(message.contains("0.9.1-preview"), "{message}");
        assert!(message.contains("protocolo 19"), "{message}");
        assert!(message.contains("protocolo 22"), "{message}");
    }
}
