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
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        use winreg::RegKey;
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
        assert_eq!(defaults.terminal_font_size_px, DEFAULT_TERMINAL_FONT_SIZE_PX);
        assert_eq!(defaults.terminal_line_height, DEFAULT_TERMINAL_LINE_HEIGHT);
    }

    #[test]
    fn real_machine_detection_reports_something() {
        // informativo: la deteccion real de esta maquina (no assert de familia concreta)
        let resolved = resolve_terminal_font_family(&terminal_font_installed);
        assert!(!resolved.is_empty());
        println!("gui_defaults en esta maquina: terminal_font_family={resolved}");
    }
}
