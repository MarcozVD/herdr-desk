use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::Serialize;

use herdr_core::error::ApiError;

pub const CLI_RUN_TIMEOUT: Duration = Duration::from_secs(15);
pub const AGENT_KINDS_TTL: Duration = Duration::from_secs(60);

/// Lista blanca de comandos ejecutables desde la GUI (guardarrail del plan §7).
/// Match EXACTO de argv completo: sin shell, sin composición, sin redirecciones.
/// Para agregar una entrada basta sumarla aqui (y resolver su exe en `resolve_program`).
/// `config reset-keys` delega en la CLI el backup y la limpieza de atajos
/// (semantica propia de herdr); argv exacto sin flags ni argumentos.
pub const WHITELIST: [&[&str]; 15] = [
    &["herdr", "agent", "start", "--help"],
    &["herdr", "status", "--json"],
    &["herdr", "--default-config"],
    &["herdr", "--skill"],
    &["herdr", "config", "check"],
    &["herdr", "config", "reset-keys"],
    &["herdr", "integration", "status"],
    &["herdr", "plugin", "config-dir"],
    &["herdr", "update"],
    &["herdr", "update", "--handoff"],
    &["herdr", "channel", "show"],
    &["herdr", "channel", "set", "stable"],
    &["herdr", "channel", "set", "preview"],
    &["git", "branch", "--format=%(refname:short)"],
    &["git", "status", "--porcelain=v2", "--branch"],
];

#[derive(Serialize, Clone, Debug)]
pub struct CliRunOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct AgentKinds {
    pub kinds: Vec<String>,
    /// Motivo si la lista vino vacia (la ayuda no la trajo, fallo de ejecucion, etc.)
    pub reason: Option<String>,
    pub cached: bool,
}

fn is_whitelisted(argv: &[String]) -> bool {
    WHITELIST.iter().any(|allowed| {
        allowed.len() == argv.len()
            && allowed
                .iter()
                .zip(argv.iter())
                .all(|(a, b)| a.eq_ignore_ascii_case(b))
    })
}

/// Defensa en profundidad: ni el match exacto deberia dejar pasar metacaracteres
/// de shell, pero se rechazan explicitamente antes de resolver el programa.
fn contains_shell_metachar(argv: &[String]) -> bool {
    argv.iter().any(|arg| {
        arg.chars()
            .any(|c| matches!(c, '|' | '>' | '<' | '&' | ';' | '`' | '$' | '\n'))
    })
}

fn resolve_program(program: &str) -> Result<std::path::PathBuf, ApiError> {
    match program {
        "herdr" => herdr_core::paths::find_herdr_exe(None).ok_or_else(|| ApiError {
            code: "cli_failed".to_string(),
            message: "no se encontro el ejecutable herdr".to_string(),
        }),
        "git" => Ok(std::path::PathBuf::from("git")),
        other => Err(ApiError {
            code: "invalid_params".to_string(),
            message: format!("programa no permitido: {other}"),
        }),
    }
}

/// Ejecuta un argv de la lista blanca: sin shell, CREATE_NO_WINDOW, timeout,
/// stdout/stderr capturados. Rechaza con ApiError explicito todo lo que no
/// matchee exactamente una entrada de la lista blanca.
pub async fn run_whitelisted(argv: &[String]) -> Result<CliRunOutput, ApiError> {
    run_whitelisted_with_env(argv, &[]).await
}

/// Igual que `run_whitelisted`, pero permite inyectar variables de entorno
/// concretas DESPUES de limpiar todas las HERDR_* heredadas. Uso interno:
/// config check apunta HERDR_CONFIG_PATH a un archivo temporal propio.
/// El argv debe seguir en la lista blanca; nunca acepta entorno del cliente.
pub async fn run_whitelisted_with_env(
    argv: &[String],
    extra_env: &[(String, String)],
) -> Result<CliRunOutput, ApiError> {
    run_whitelisted_impl(argv, extra_env, None).await
}

/// Variante con directorio de trabajo (T3.10: `git status` por workspace).
pub async fn run_whitelisted_in(
    argv: &[String],
    cwd: Option<&std::path::Path>,
) -> Result<CliRunOutput, ApiError> {
    run_whitelisted_impl(argv, &[], cwd).await
}

async fn run_whitelisted_impl(
    argv: &[String],
    extra_env: &[(String, String)],
    cwd: Option<&std::path::Path>,
) -> Result<CliRunOutput, ApiError> {
    if argv.is_empty() {
        return Err(ApiError {
            code: "invalid_params".to_string(),
            message: "argv vacio".to_string(),
        });
    }
    if contains_shell_metachar(argv) {
        return Err(ApiError {
            code: "invalid_params".to_string(),
            message: "el argv contiene caracteres de shell no permitidos".to_string(),
        });
    }
    if !is_whitelisted(argv) {
        return Err(ApiError {
            code: "invalid_params".to_string(),
            message: format!("comando fuera de la lista blanca: {}", argv.join(" ")),
        });
    }
    let program = resolve_program(&argv[0])?;

    let mut cmd = tokio::process::Command::new(&program);
    cmd.args(&argv[1..])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        // tokio::process::Command::creation_flags es inherent en Windows (sin trait)
        cmd.creation_flags(herdr_core::terminal::CREATE_NO_WINDOW);
    }
    for (key, _) in std::env::vars() {
        if key.starts_with("HERDR_") {
            cmd.env_remove(key);
        }
    }
    for (key, value) in extra_env {
        cmd.env(key, value);
    }
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    let mut child = cmd.spawn().map_err(|e| ApiError {
        code: "cli_failed".to_string(),
        message: format!("no se pudo ejecutar {}: {e}", argv[0]),
    })?;
    let mut stdout_pipe = child.stdout.take().ok_or_else(|| ApiError {
        code: "cli_failed".to_string(),
        message: "sin stdout".to_string(),
    })?;
    let mut stderr_pipe = child.stderr.take().ok_or_else(|| ApiError {
        code: "cli_failed".to_string(),
        message: "sin stderr".to_string(),
    })?;

    let read_out = tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut buf = String::new();
        let _ = stdout_pipe.read_to_string(&mut buf).await;
        buf
    });
    let read_err = tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut buf = String::new();
        let _ = stderr_pipe.read_to_string(&mut buf).await;
        buf
    });

    let wait = tokio::time::timeout(CLI_RUN_TIMEOUT, child.wait());
    let status = match wait.await {
        Ok(Ok(status)) => status,
        Ok(Err(e)) => {
            return Err(ApiError {
                code: "cli_failed".to_string(),
                message: format!("error esperando {}: {e}", argv[0]),
            });
        }
        Err(_) => {
            // timeout: matar el proceso (kill_on_drop lo cubre al drop del child)
            let _ = child.kill().await;
            return Err(ApiError {
                code: "timeout".to_string(),
                message: format!("{} excedio el timeout", argv.join(" ")),
            });
        }
    };

    let stdout = read_out.await.unwrap_or_default();
    let stderr = read_err.await.unwrap_or_default();
    Ok(CliRunOutput {
        exit_code: status.code().unwrap_or(-1),
        stdout,
        stderr,
    })
}

/// Extrae los kinds de la ayuda de `herdr agent start --help`
/// (bloque clap `[possible values: a, b, c]`).
pub fn parse_agent_kinds(help_text: &str) -> Vec<String> {
    let Some(idx) = help_text.find("[possible values:") else {
        return Vec::new();
    };
    let rest = &help_text[idx + "[possible values:".len()..];
    let Some(end) = rest.find(']') else {
        return Vec::new();
    };
    rest[..end]
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

#[tauri::command]
pub async fn cli_run(argv: Vec<String>) -> Result<CliRunOutput, ApiError> {
    run_whitelisted(&argv).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[tokio::test]
    async fn rejects_empty_argv() {
        let err = run_whitelisted(&[]).await.expect_err("argv vacio");
        assert_eq!(err.code, "invalid_params");
    }

    #[tokio::test]
    async fn rejects_program_outside_whitelist() {
        for argv in [
            argv(&["cmd", "/c", "echo hola"]),
            argv(&["powershell", "-Command", "ls"]),
            argv(&["herdr", "server", "stop"]), // herdr real pero comando mutante
            argv(&["herdr", "status"]),         // faltan flags exactos
            argv(&["herdr", "status", "--json", "--extra"]), // flag inesperada
            argv(&["git", "push", "origin", "main"]), // git mutante
            argv(&["C:\\Windows\\System32\\cmd.exe", "/c", "dir"]), // ruta no permitida
        ] {
            let err = run_whitelisted(&argv)
                .await
                .expect_err(&format!("debe rechazar: {}", argv.join(" ")));
            assert_eq!(err.code, "invalid_params", "argv: {}", argv.join(" "));
        }
    }

    #[tokio::test]
    async fn rejects_shell_metachars_even_if_shape_matches() {
        let mut with_amp = argv(&["herdr", "status", "--json"]);
        with_amp.push("&&".to_string());
        let err = run_whitelisted(&with_amp).await.expect_err("metacaracter");
        assert_eq!(err.code, "invalid_params");
        assert!(err.message.contains("shell"));

        let with_redirect = argv(&["git", "branch", "--format=%(refname:short)>out.txt"]);
        let err2 = run_whitelisted(&with_redirect)
            .await
            .expect_err("redireccion");
        assert_eq!(err2.code, "invalid_params");
    }

    #[test]
    fn whitelist_shape_is_exact() {
        assert!(is_whitelisted(&argv(&["herdr", "status", "--json"])));
        assert!(is_whitelisted(&argv(&[
            "git",
            "branch",
            "--format=%(refname:short)"
        ])));
        assert!(is_whitelisted(&argv(&["herdr", "config", "reset-keys"])));
        // F4/T4.4: update y canal entran con argv exacto.
        assert!(is_whitelisted(&argv(&["herdr", "update"])));
        assert!(is_whitelisted(&argv(&["herdr", "update", "--handoff"])));
        assert!(is_whitelisted(&argv(&["herdr", "channel", "show"])));
        assert!(is_whitelisted(&argv(&["herdr", "channel", "set", "preview"])));
        assert!(!is_whitelisted(&argv(&["herdr", "channel", "set", "nightly"])));
        assert!(!is_whitelisted(&argv(&["herdr", "update", "--extra"])));
        assert!(!is_whitelisted(&argv(&["herdr"])));
        assert!(!is_whitelisted(&argv(&["git"])));
        assert!(!is_whitelisted(&argv(&["herdr", "server", "stop"])));
        assert!(!is_whitelisted(&argv(&[
            "herdr",
            "config",
            "reset-keys",
            "--extra"
        ])));
    }

    #[test]
    fn parses_agent_kinds_from_recorded_fixture() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../schema/fixtures/agent_start_help.txt");
        let help = std::fs::read_to_string(path).expect("fixture de agent start --help");
        let kinds = parse_agent_kinds(&help);
        assert!(kinds.len() >= 10, "kinds: {kinds:?}");
        assert!(kinds.contains(&"opencode".to_string()));
        assert!(kinds.contains(&"claude".to_string()));
        assert!(kinds.iter().all(|k| !k.contains(' ')));
    }

    #[test]
    fn parses_nothing_when_help_has_no_possible_values() {
        assert!(parse_agent_kinds("sin valores posibles aca").is_empty());
        assert!(parse_agent_kinds("[possible values: sin cierre").is_empty());
    }
}

/// Cache en memoria de los kinds de agente (TTL corto + refresh manual).
type KindsCacheEntry = (Vec<String>, Option<String>, Instant);
static KINDS_CACHE: std::sync::Mutex<Option<KindsCacheEntry>> = std::sync::Mutex::new(None);

/// Parsea la lista de kinds de `herdr agent start --help`. Si la ayuda no trae
/// la lista, devuelve vacia con motivo (nunca error fatal).
#[tauri::command]
pub async fn agent_kinds(refresh: Option<bool>) -> Result<AgentKinds, ApiError> {
    let force = refresh.unwrap_or(false);
    if !force
        && let Ok(guard) = KINDS_CACHE.lock()
        && let Some((kinds, reason, at)) = guard.as_ref()
        && at.elapsed() < AGENT_KINDS_TTL
    {
        return Ok(AgentKinds {
            kinds: kinds.clone(),
            reason: reason.clone(),
            cached: true,
        });
    }

    let argv: Vec<String> = ["herdr", "agent", "start", "--help"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let out = match run_whitelisted(&argv).await {
        Ok(out) => out,
        Err(err) => {
            return Ok(AgentKinds {
                kinds: Vec::new(),
                reason: Some(format!("no se pudo ejecutar la ayuda: {}", err.message)),
                cached: false,
            });
        }
    };
    if out.exit_code != 0 {
        return Ok(AgentKinds {
            kinds: Vec::new(),
            reason: Some(format!(
                "herdr agent start --help salio con codigo {}",
                out.exit_code
            )),
            cached: false,
        });
    }
    let kinds = parse_agent_kinds(&out.stdout);
    let reason = if kinds.is_empty() {
        Some("la ayuda no trae la lista [possible values: ...]".to_string())
    } else {
        None
    };
    if let Ok(mut guard) = KINDS_CACHE.lock() {
        *guard = Some((kinds.clone(), reason.clone(), Instant::now()));
    }
    Ok(AgentKinds {
        kinds,
        reason,
        cached: false,
    })
}
