//! T3.5 — Ajustes exclusivos de la GUI en `%APPDATA%\herdr-desk\settings.json`.
//!
//! El resto de la configuración (tema, UI, sonidos…) vive en el `config.toml` de
//! herdr y se toca con `config_read`/`config_write`. Aquí solo van las claves que
//! herdr no conoce (nivel de cristal, WebGL, LRU de terminales…), para no meter
//! secciones desconocidas en su config (el server las avisaría como warning).

use std::path::{Path, PathBuf};

use herdr_core::error::ApiError;
use serde::Serialize;
use serde_json::Value;

/// Ruta del settings.json de la GUI.
pub(crate) fn gui_settings_path() -> PathBuf {
    herdr_core::config::gui_settings_dir().join("settings.json")
}

#[derive(Serialize, Clone, Debug)]
pub struct GuiSettingsWrite {
    pub path: String,
    pub written: usize,
}

fn invalid(message: String) -> ApiError {
    ApiError {
        code: "invalid_params".to_string(),
        message,
    }
}

/// Lee el archivo como objeto JSON. Ausente, ilegible o corrupto → objeto vacío
/// (la GUI arranca con sus valores por defecto, nunca se queda sin prefs).
pub(crate) fn read_gui_settings(path: &Path) -> Value {
    let raw = std::fs::read_to_string(path).unwrap_or_default();
    match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Object(map)) => Value::Object(map),
        _ => Value::Object(serde_json::Map::new()),
    }
}

/// Escritura atómica (tmp + rename) del objeto completo.
pub(crate) fn write_gui_settings(path: &Path, values: &Value) -> Result<GuiSettingsWrite, ApiError> {
    let object = values
        .as_object()
        .ok_or_else(|| invalid("los ajustes de la GUI deben ser un objeto JSON".to_string()))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| ApiError {
            code: "io".to_string(),
            message: format!("no se pudo crear {}: {e}", dir.display()),
        })?;
    }
    let text = serde_json::to_string_pretty(values).map_err(|e| invalid(e.to_string()))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| ApiError {
        code: "io".to_string(),
        message: format!("no se pudo escribir {}: {e}", tmp.display()),
    })?;
    std::fs::rename(&tmp, path).map_err(|e| ApiError {
        code: "io".to_string(),
        message: format!("no se pudo reemplazar {}: {e}", path.display()),
    })?;
    Ok(GuiSettingsWrite {
        path: path.display().to_string(),
        written: object.len(),
    })
}

#[tauri::command]
pub async fn gui_settings_read() -> Result<Value, ApiError> {
    Ok(read_gui_settings(&gui_settings_path()))
}

#[tauri::command]
pub async fn gui_settings_write(values: Value) -> Result<GuiSettingsWrite, ApiError> {
    write_gui_settings(&gui_settings_path(), &values)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("hd-gui-settings-{}-{name}.json", std::process::id()))
    }

    #[test]
    fn ausente_devuelve_objeto_vacio() {
        let path = temp_path("ausente");
        let _ = std::fs::remove_file(&path);
        assert_eq!(read_gui_settings(&path), serde_json::json!({}));
    }

    #[test]
    fn roundtrip_escribe_y_lee() {
        let path = temp_path("roundtrip");
        let values = serde_json::json!({ "glass": "off", "webgl": false, "terminal_lru_max": 8 });
        let result = write_gui_settings(&path, &values).expect("write");
        assert_eq!(result.written, 3);
        assert_eq!(read_gui_settings(&path), values);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn corrupto_devuelve_vacio_sin_respirar() {
        let path = temp_path("corrupto");
        std::fs::write(&path, "{esto no es json").unwrap();
        assert_eq!(read_gui_settings(&path), serde_json::json!({}));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn no_objeto_se_rechaza() {
        let path = temp_path("no-objeto");
        let err = write_gui_settings(&path, &serde_json::json!([1, 2])).expect_err("debe rechazar");
        assert_eq!(err.code, "invalid_params");
    }
}
