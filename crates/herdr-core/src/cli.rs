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
