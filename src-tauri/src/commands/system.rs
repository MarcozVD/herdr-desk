use serde::Serialize;

use herdr_core::error::ApiError;

pub const FALLBACK_TERMINAL_FONT: &str = "monospace";
pub const DEFAULT_TERMINAL_FONT_SIZE_PX: u32 = 13;
pub const DEFAULT_TERMINAL_LINE_HEIGHT: f64 = 1.0;

/// Cascada de fuentes de terminal, igual que la terminal de Windows:
/// Win11 trae Cascadia de serie; Consolas es el último recurso con forma real.
pub const TERMINAL_FONT_CANDIDATES: [&str; 3] = ["Cascadia Code", "Cascadia Mono", "Consolas"];

#[derive(Serialize, Clone, Debug)]
pub struct GuiDefaults {
    pub terminal_font_family: String,
    pub terminal_font_size_px: u32,
    pub terminal_line_height: f64,
}

/// Resuelve la primera familia instalada según la cascada; el probe inyectado
/// permite testear sin depender de las fuentes reales de la máquina.
pub fn resolve_terminal_font_family(is_installed: &dyn Fn(&str) -> bool) -> String {
    TERMINAL_FONT_CANDIDATES
        .iter()
        .find(|c| is_installed(c))
        .map(|c| c.to_string())
        .unwrap_or_else(|| FALLBACK_TERMINAL_FONT.to_string())
}

/// ¿Está `family` instalada? Fuente de verdad: claves Fonts del registro
/// (HKLM para fuentes del sistema + HKCU para fuentes por usuario).
pub fn terminal_font_installed(family: &str) -> bool {
    #[cfg(windows)]
    {
        use winreg::RegKey;
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        let needle = family.to_ascii_lowercase();
        for hkey in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
            let key = RegKey::predef(hkey)
                .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts");
            if let Ok(key) = key {
                for value_name in key.enum_values().flatten().map(|(n, _)| n) {
                    if value_name.to_ascii_lowercase().contains(&needle) {
                        return true;
                    }
                }
            }
        }
        false
    }
    #[cfg(not(windows))]
    {
        let _ = family;
        false
    }
}

#[tauri::command]
pub async fn gui_defaults() -> Result<GuiDefaults, ApiError> {
    Ok(build_gui_defaults(&terminal_font_installed))
}

/// T3.7 — Cambia el efecto Mica de la ventana entre oscuro y claro según el tema
/// activo. El frontend llama a este command en vez de la API JS de ventana
/// (cuyo enum `Effect` no expone `micaDark`/`micaLight`).
#[tauri::command]
pub async fn set_mica(app: tauri::AppHandle, dark: bool) -> Result<(), ApiError> {
    use tauri::Manager;
    use tauri::utils::config::WindowEffectsConfig;
    use tauri::window::Effect;

    let effects = WindowEffectsConfig {
        effects: vec![if dark {
            Effect::MicaDark
        } else {
            Effect::MicaLight
        }],
        ..Default::default()
    };
    if let Some(window) = app.get_webview_window("main") {
        window.set_effects(effects).map_err(|e| ApiError {
            code: "window".to_string(),
            message: format!("no se pudo cambiar el efecto Mica: {e}"),
        })?;
    }
    Ok(())
}

/// T3.8 — Comando personalizado `[[keys.command]] type="shell"`: detached, sin
/// consola (excepción documentada del §7: es config del propio usuario).
#[tauri::command]
pub async fn run_shell_command(command: String, cwd: Option<String>) -> Result<(), ApiError> {
    let command = command.trim().to_string();
    if command.is_empty() {
        return Err(ApiError {
            code: "invalid_params".to_string(),
            message: "comando vacío".to_string(),
        });
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        let mut process = std::process::Command::new("cmd.exe");
        process
            .args(["/d", "/c", &command])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
        if let Some(dir) = cwd.as_deref().filter(|d| !d.is_empty()) {
            process.current_dir(dir);
        }
        process.spawn().map_err(|e| ApiError {
            code: "io".to_string(),
            message: format!("no se pudo lanzar el comando: {e}"),
        })?;
    }
    #[cfg(not(windows))]
    {
        let mut process = std::process::Command::new("sh");
        process
            .args(["-c", &command])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        if let Some(dir) = cwd.as_deref().filter(|d| !d.is_empty()) {
            process.current_dir(dir);
        }
        process.spawn().map_err(|e| ApiError {
            code: "io".to_string(),
            message: format!("no se pudo lanzar el comando: {e}"),
        })?;
    }
    Ok(())
}

/// T3.9 — Archivo temporal para `edit_scrollback` (el visor externo lo abre con
/// `opener`). El nombre se sanea: solo letras, números, «-» y «_».
/// T3.10 — Estado git de un workspace (rama + cambios) para los tokens de la
/// sidebar. La salida se lee de `git status --porcelain=v2 --branch` (lista
/// blanca). Sin watcher propio: el frontend lo refresca con el snapshot.
#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct GitStatusInfo {
    pub branch: Option<String>,
    pub dirty: u32,
    pub ahead: u32,
    pub behind: u32,
}

/// Parsea `git status --porcelain=v2 --branch`.
pub fn parse_git_status(stdout: &str) -> GitStatusInfo {
    let mut info = GitStatusInfo::default();
    for line in stdout.lines() {
        if let Some(head) = line.strip_prefix("# branch.head ") {
            let head = head.trim();
            if !head.is_empty() && head != "(detached)" {
                info.branch = Some(head.to_string());
            }
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            for part in ab.split_whitespace() {
                if let Some(stripped) = part.strip_prefix('+') {
                    info.ahead = stripped.parse().unwrap_or(0);
                } else if let Some(stripped) = part.strip_prefix('-') {
                    info.behind = stripped.parse().unwrap_or(0);
                }
            }
        } else if !line.starts_with('#') && !line.trim().is_empty() {
            info.dirty += 1;
        }
    }
    info
}

#[tauri::command]
pub async fn git_status(cwd: String) -> Result<GitStatusInfo, ApiError> {
    if cwd.trim().is_empty() {
        return Err(ApiError {
            code: "invalid_params".to_string(),
            message: "cwd vacío para git status".to_string(),
        });
    }
    let argv: Vec<String> = ["git", "status", "--porcelain=v2", "--branch"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let out = super::cli_run::run_whitelisted_in(&argv, Some(std::path::Path::new(&cwd))).await?;
    if out.exit_code != 0 {
        return Err(ApiError {
            code: "cli_failed".to_string(),
            message: format!("git status salió con {}: {}", out.exit_code, out.stderr.trim()),
        });
    }
    Ok(parse_git_status(&out.stdout))
}

#[tauri::command]
pub async fn write_scratch_file(name: String, text: String) -> Result<String, ApiError> {
    let clean: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(60)
        .collect();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!(
        "herdr-desk-{}-{stamp}.txt",
        if clean.is_empty() { "scratch" } else { &clean }
    ));
    std::fs::write(&path, text).map_err(|e| ApiError {
        code: "io".to_string(),
        message: format!("no se pudo escribir {}: {e}", path.display()),
    })?;
    Ok(path.display().to_string())
}

/// Punto único de construcción de los defaults: permite testear con un probe inyectado.
pub fn build_gui_defaults(is_installed: &dyn Fn(&str) -> bool) -> GuiDefaults {
    GuiDefaults {
        terminal_font_family: resolve_terminal_font_family(is_installed),
        terminal_font_size_px: DEFAULT_TERMINAL_FONT_SIZE_PX,
        terminal_line_height: DEFAULT_TERMINAL_LINE_HEIGHT,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_installed<'a>(installed: &'a [&'a str]) -> impl Fn(&str) -> bool + 'a {
        move |family: &str| installed.iter().any(|i| i.eq_ignore_ascii_case(family))
    }

    #[test]
    fn picks_cascadia_code_first() {
        let probe = with_installed(&["Cascadia Code", "Cascadia Mono", "Consolas"]);
        assert_eq!(resolve_terminal_font_family(&probe), "Cascadia Code");
    }

    #[test]
    fn falls_back_to_cascadia_mono() {
        let probe = with_installed(&["Cascadia Mono", "Consolas"]);
        assert_eq!(resolve_terminal_font_family(&probe), "Cascadia Mono");
    }

    #[test]
    fn falls_back_to_consolas() {
        let probe = with_installed(&["Consolas"]);
        assert_eq!(resolve_terminal_font_family(&probe), "Consolas");
    }

    #[test]
    fn falls_back_to_generic_monospace() {
        let probe = with_installed(&[]);
        assert_eq!(resolve_terminal_font_family(&probe), FALLBACK_TERMINAL_FONT);
    }

    #[test]
    fn match_is_case_insensitive() {
        let probe = with_installed(&["cascadia code"]);
        assert_eq!(resolve_terminal_font_family(&probe), "Cascadia Code");
    }

    #[test]
    fn defaults_values_are_sane() {
        let probe = with_installed(&["Consolas"]);
        let defaults = build_gui_defaults(&probe);
        assert_eq!(defaults.terminal_font_family, "Consolas");
        assert_eq!(
            defaults.terminal_font_size_px,
            DEFAULT_TERMINAL_FONT_SIZE_PX
        );
        assert_eq!(defaults.terminal_line_height, DEFAULT_TERMINAL_LINE_HEIGHT);
    }

    #[test]
    fn real_machine_detection_reports_something() {
        // informativo: la deteccion real de esta maquina (no assert de familia concreta)
        let resolved = resolve_terminal_font_family(&terminal_font_installed);
        assert!(!resolved.is_empty());
        println!("gui_defaults en esta maquina: terminal_font_family={resolved}");
    }

    #[test]
    fn parsea_git_status_v2() {
        let stdout = "# branch.oid abc\n# branch.head main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 aaa bbb archivo.txt\n? nuevo.txt\n";
        let info = parse_git_status(stdout);
        assert_eq!(info.branch.as_deref(), Some("main"));
        assert_eq!(info.ahead, 2);
        assert_eq!(info.behind, 1);
        assert_eq!(info.dirty, 2);
    }

    #[test]
    fn git_detached_sin_rama_y_sin_cambios() {
        let info = parse_git_status("# branch.head (detached)\n# branch.ab +0 -0\n");
        assert_eq!(info.branch, None);
        assert_eq!(info.dirty, 0);
    }
}
