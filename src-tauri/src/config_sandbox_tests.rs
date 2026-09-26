#![cfg(all(test, feature = "sandbox"))]

//! Tests de config contra la CLI y el server reales, siempre en sesion
//! sandbox hd-test-* con config TEMPORAL (nunca la config.toml del usuario).

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use crate::commands::config::{
    ConfigChange, check_config_text, parse_default_config, write_config_file_with,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DETACHED_PROCESS: u32 = 0x0000_0008;
const MAX_WAIT: Duration = Duration::from_secs(15);

static TEST_SEQ: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

fn fixture() -> String {
    std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../schema/fixtures/default_config.toml"),
    )
    .expect("fixture de la config por defecto")
}

fn change(path: &str, value: Option<&str>) -> ConfigChange {
    ConfigChange {
        path: path.to_string(),
        value: value.map(|s| s.to_string()),
    }
}

fn tmp_config(tag: &str, seed: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("herdr-desk-cfgtest-{}-{tag}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("tmp dir");
    let path = dir.join("config.toml");
    std::fs::write(&path, seed).expect("seed config");
    path
}

/// Server real en sesion hd-test-* leyendo UNA CONFIG TEMPORAL
/// (HERDR_CONFIG_PATH al arrancar; reload_config relee esa misma ruta).
struct TestServer {
    name: String,
}

impl TestServer {
    fn start(config_path: &Path) -> Self {
        let name = format!(
            "hd-test-cfg-{}-{}",
            std::process::id(),
            TEST_SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        );
        let _ = herdr_core::cli::stop_session(&name);
        let _ = herdr_core::cli::delete_session(&name);

        let exe = herdr_core::cli::herdr_exe().expect("herdr en PATH");
        let mut cmd = std::process::Command::new(exe);
        cmd.args(["--session", &name, "server"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
            .env("HERDR_CONFIG_PATH", config_path);
        cmd.spawn().expect("spawn server sandbox");

        let deadline = Instant::now() + MAX_WAIT;
        loop {
            assert!(
                Instant::now() < deadline,
                "server sandbox {name} no arranco en {MAX_WAIT:?}"
            );
            if let Ok(list) = herdr_core::cli::session_list()
                && list.sessions.iter().any(|s| s.name == name && s.running)
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        Self { name }
    }

    fn client(&self) -> herdr_core::RpcClient {
        let socket = herdr_core::paths::session_socket(&self.name);
        herdr_core::RpcClient::new(herdr_core::paths::pipe_name(&socket))
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        let _ = herdr_core::cli::stop_session(&self.name);
        let _ = herdr_core::cli::delete_session(&self.name);
    }
}

/// `herdr config check` de verdad sobre texto roto: exit != 0 y diagnostico
/// parse_error (severidad error, mensaje traducido).
#[tokio::test]
async fn check_rejects_broken_toml_text() {
    let bad = "[ui]\nsidebar_width = \"no-es-numero\"\n";
    let out = check_config_text(bad).await.expect("check ejecutado");
    assert_ne!(out.exit_code, 0, "la CLI debe reportar problemas");
    assert!(out.has_blocking_error());
    let parse = out
        .diagnostics
        .iter()
        .find(|d| d.code == "parse_error")
        .expect("diagnostico parse_error");
    assert_eq!(parse.severity, "error");
    assert!(parse.message.contains("TOML"), "{}", parse.message);
}

/// Clave desconocida: warning (no bloquea); la CLI la ignora.
#[tokio::test]
async fn check_warns_on_unknown_key() {
    let text = "[theme]\nclave_rara = 1\n";
    let out = check_config_text(text).await.expect("check ejecutado");
    assert_ne!(out.exit_code, 0);
    assert!(
        !out.has_blocking_error(),
        "clave desconocida es warning: {:?}",
        out.diagnostics
    );
    let warn = out
        .diagnostics
        .iter()
        .find(|d| d.code == "unknown_key")
        .expect("diagnostico unknown_key");
    assert_eq!(warn.severity, "warning");
    assert!(
        warn.message.contains("theme.clave_rara"),
        "{}",
        warn.message
    );
}

/// El fixture real (captura viva de herdr --default-config) pasa el check.
#[tokio::test]
async fn check_accepts_default_config_fixture() {
    let out = check_config_text(&fixture())
        .await
        .expect("check ejecutado");
    assert_eq!(out.exit_code, 0, "{:?}", out.diagnostics);
    assert!(out.diagnostics.is_empty());
    // ademas: el parser de defaults sobre el fixture real
    let defaults = parse_default_config(&fixture());
    assert!(
        defaults
            .sections
            .iter()
            .any(|s| s.path == "theme" && s.keys.iter().any(|k| k.key == "name"))
    );
}

/// Roundtrip completo contra server real: validar → escribir → recargar.
/// La config temporal recibe el cambio y el server lo aplica.
#[tokio::test]
async fn write_roundtrip_with_real_server_reload() {
    let path = tmp_config("ok", &fixture());
    let server = TestServer::start(&path);
    let before = std::fs::read_to_string(&path).unwrap();

    let result = write_config_file_with(
        &path,
        &[
            change("theme.name", Some("\"nord\"")),
            change("ui.accent", Some("\"blue\"")),
        ],
        Some(&server.client()),
        true,
    )
    .await
    .expect("escritura");

    assert!(!result.rejected, "{:?}", result.diagnostics);
    assert_eq!(result.applied, 2);
    let reload = result.reload.expect("reload contra server vivo");
    assert_eq!(
        reload.status, "applied",
        "diagnostics: {:?}",
        reload.diagnostics
    );
    assert!(reload.error.is_none());

    let after = std::fs::read_to_string(&path).unwrap();
    assert!(after.contains("name = \"nord\""), "config final: {after}");
    assert!(after.contains("accent = \"blue\""));
    assert!(after.contains("# Built-in themes"), "comentarios perdidos");
    assert!(
        after.contains("# name = \"catppuccin\""),
        "comentario de la clave perdida"
    );

    // backup real en disco en la primera escritura
    let backup = result.backup.expect("backup de la primera escritura");
    let backup_text = std::fs::read_to_string(&backup).expect("backup leible");
    assert_eq!(backup_text, before, "backup = contenido previo");

    // segunda escritura: ya no genera backup nuevo (el .bak-<ts> queda intacto)
    let result2 = write_config_file_with(
        &path,
        &[change("ui.mouse_capture", Some("false"))],
        Some(&server.client()),
        false,
    )
    .await
    .expect("escritura 2");
    assert!(!result2.rejected);
    assert!(
        result2.backup.is_none(),
        "solo la primera escritura respalda"
    );
}

/// Cambio que ROMPE la validacion: se rechaza y config.toml queda intacto
/// (rollback por no-escritura; ni backup ni reload).
#[tokio::test]
async fn write_rejects_invalid_change_without_touching_file() {
    let path = tmp_config("bad", &fixture());
    let before = std::fs::read_to_string(&path).unwrap();

    let result = write_config_file_with(
        &path,
        &[change("ui.sidebar_width", Some("\"treinta\""))],
        None,
        true,
    )
    .await
    .expect("escritura");

    assert!(result.rejected);
    assert_eq!(result.applied, 0);
    assert!(result.backup.is_none());
    assert!(result.reload.is_none());
    assert!(
        result
            .diagnostics
            .iter()
            .any(|d| d.code == "parse_error" && d.severity == "error")
    );

    let after = std::fs::read_to_string(&path).unwrap();
    assert_eq!(
        after, before,
        "el archivo no debe tocarce si la validacion falla"
    );
}

/// Contrato del server con config que la CLI acepta pero el runtime puede
/// rechazar: reload_config responde applied|partial|failed; si failed,
/// el núcleo revierte al contenido previo (rollback real).
#[tokio::test]
async fn server_failed_reload_rolls_back() {
    let path = tmp_config("runtime", &fixture());
    let server = TestServer::start(&path);
    let before = std::fs::read_to_string(&path).unwrap();

    // tema inexistente: la CLI no lo valida (solo sintaxis); el server si puede
    let result = write_config_file_with(
        &path,
        &[change("theme.name", Some("\"tema-inexistente-xyz\""))],
        Some(&server.client()),
        true,
    )
    .await
    .expect("escritura");

    assert!(!result.rejected, "{:?}", result.diagnostics);
    let reload = result.reload.expect("reload contra server vivo");
    assert!(
        matches!(reload.status.as_str(), "applied" | "partial" | "failed"),
        "status del contrato: {}",
        reload.status
    );
    if reload.status == "failed" {
        assert!(result.rolled_back, "failed debe revertir");
        let restored = std::fs::read_to_string(&path).unwrap();
        assert_eq!(restored, before, "rollback restaura el contenido previo");
    }
}

/// Los comandos spawn del server en los tests son argv directo con flags de
/// ventana (sin shell); verificacion defensiva del contrato de la casa.
#[test]
fn sandbox_spawns_use_direct_argv() {
    let exe = herdr_core::cli::herdr_exe().expect("herdr exe");
    assert!(exe.ends_with("herdr.exe"), "{exe:?}");
}
