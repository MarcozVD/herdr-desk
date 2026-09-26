//! Identidad de notificaciones en Windows (patron windows-toast-identity.md del
//! skill tauri-desktop-app): registra el AUMID de la app con DisplayName (y
//! IconUri cuando hay un icono disponible) para que los toasts muestren
//! "herdr-desk" y no "Windows PowerShell".

use herdr_core::error::ApiError;

pub const TOAST_AUMID: &str = "com.mvale.herdrdesk";
pub const TOAST_DISPLAY_NAME: &str = "herdr-desk";

#[cfg(windows)]
fn write_aumid_registry(
    aumid: &str,
    display_name: &str,
    icon_path: Option<&str>,
) -> Result<(), ApiError> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key_path = format!("SOFTWARE\\Classes\\AppUserModelId\\{aumid}");
    let (key, _) = hkcu
        .create_subkey_with_flags(&key_path, KEY_SET_VALUE)
        .map_err(|e| ApiError {
            code: "cli_failed".to_string(),
            message: format!("no se pudo registrar el AUMID {aumid}: {e}"),
        })?;
    key.set_value("DisplayName", &display_name)
        .map_err(|e| ApiError {
            code: "cli_failed".to_string(),
            message: format!("no se pudo escribir DisplayName del AUMID: {e}"),
        })?;
    if let Some(icon) = icon_path {
        let _ = key.set_value("IconUri", &icon);
    }
    Ok(())
}

#[cfg(windows)]
fn find_icon_uri() -> Option<String> {
    // icono junto al exe (instalado) o del repo (dev)
    let exe = std::env::current_exe().ok()?;
    let candidates = [
        exe.with_file_name("icon.ico"),
        exe.parent()?.join("icons").join("icon.ico"),
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("icons")
            .join("icon.ico"),
    ];
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().to_string())
}

/// Registra la identidad de toasts (idempotente). No es fatal si falla: el
/// toast sigue funcionando, solo con el nombre equivocado.
pub fn setup_toast_identity() {
    #[cfg(windows)]
    {
        let icon = find_icon_uri();
        if let Err(err) = write_aumid_registry(TOAST_AUMID, TOAST_DISPLAY_NAME, icon.as_deref()) {
            tracing::warn!("identidad de toasts no registrada: {}", err.message);
        } else {
            tracing::info!("AUMID {TOAST_AUMID} registrado (DisplayName={TOAST_DISPLAY_NAME})");
        }
    }
    #[cfg(not(windows))]
    {
        tracing::info!("identidad de toasts: no aplica fuera de Windows");
    }
}

/// Registra un AUMID arbitrario (para tests con AUMID de prueba).
#[cfg(all(windows, test))]
pub fn write_aumid_for_test(aumid: &str, display_name: &str) -> Result<(), ApiError> {
    write_aumid_registry(aumid, display_name, None)
}

#[cfg(all(windows, test))]
pub fn read_aumid_display_name(aumid: &str) -> Option<String> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey(format!("SOFTWARE\\Classes\\AppUserModelId\\{aumid}"))
        .ok()?;
    key.get_value("DisplayName").ok()
}

/// Verificacion de identidad: registra un AUMID de prueba, lo lee y lo borra.
#[cfg(all(windows, test))]
#[test]
fn toast_identity_roundtrip() {
    let test_aumid = "com.mvale.herdrdesk.toast-test";
    write_aumid_for_test(test_aumid, TOAST_DISPLAY_NAME).expect("registrar AUMID de prueba");
    let display = read_aumid_display_name(test_aumid);
    assert_eq!(display.as_deref(), Some(TOAST_DISPLAY_NAME));

    // cleanup de la clave de prueba
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let _ = hkcu.delete_subkey(format!("SOFTWARE\\Classes\\AppUserModelId\\{test_aumid}"));
    assert!(read_aumid_display_name(test_aumid).is_none());
}

/// Comando de consulta: que AUMID usa la app (para el frontend y diagnósticos).
#[tauri::command]
pub async fn toast_identity() -> Result<serde_json::Value, ApiError> {
    Ok(serde_json::json!({
        "aumid": TOAST_AUMID,
        "display_name": TOAST_DISPLAY_NAME,
    }))
}
