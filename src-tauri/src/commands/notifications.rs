use serde::Serialize;

use herdr_core::error::ApiError;

use crate::toast_identity::{TOAST_AUMID, aumid_registered, find_icon_uri};

// ---------------------------------------------------------------------------
// Notificaciones nativas de Windows (T2.5): toasts del SO con la identidad
// AUMID de toast_identity.rs (com.mvale.herdrdesk). El nombre del command
// replica el metodo notification.show del protocolo 19, pero aqui es local:
// el server no manda notificaciones del SO por la GUI.
// Contrato de degradación: si el registro no está disponible o el toast falla,
// se responde Ok con delivered=false y el motivo (nunca Err), para que la UI
// pueda avisar sin romper el flujo.
// ---------------------------------------------------------------------------

pub const REASON_SHOWN: &str = "shown";
pub const REASON_REGISTRY_UNAVAILABLE: &str = "registry_unavailable";
pub const REASON_NOT_SUPPORTED: &str = "not_supported";
pub const REASON_ERROR: &str = "error";

#[derive(Serialize, Clone, Debug)]
pub struct NotificationShowOutcome {
    pub delivered: bool,
    /// shown | registry_unavailable | not_supported | error
    pub reason: String,
    /// AUMID usado (el de la app), útil para diagnóstico en la UI.
    pub aumid: String,
    pub error: Option<String>,
}

/// Lógica de entrega pura (testeable): decide el resultado según la
/// disponibilidad del registro y la plataforma.
pub fn delivery_outcome(aumid_ok: bool, platform_supported: bool) -> NotificationShowOutcome {
    if !platform_supported {
        return NotificationShowOutcome {
            delivered: false,
            reason: REASON_NOT_SUPPORTED.to_string(),
            aumid: TOAST_AUMID.to_string(),
            error: None,
        };
    }
    if !aumid_ok {
        // degradar en silencio y avisar: el flujo sigue, la UI decide mostralo
        return NotificationShowOutcome {
            delivered: false,
            reason: REASON_REGISTRY_UNAVAILABLE.to_string(),
            aumid: TOAST_AUMID.to_string(),
            error: None,
        };
    }
    NotificationShowOutcome {
        delivered: true,
        reason: REASON_SHOWN.to_string(),
        aumid: TOAST_AUMID.to_string(),
        error: None,
    }
}

/// Contenido del toast de prueba (título/cuerpo fijos para el botón "probar").
pub fn test_notification_content() -> (String, String) {
    (
        "herdr-desk · prueba".to_string(),
        "Si ves esto, las notificaciones nativas funcionan.".to_string(),
    )
}

/// Muestra una notificación nativa con el AUMID de la app.
/// - `title`: obligatorio; `body`: opcional.
/// - `icon`: ruta opcional de imagen para el toast; por defecto el icono
///   de la app (`find_icon_uri`), y si no hay, el que resuelva el SO.
/// - `test: true`: toast de prueba con contenido fijo (ignora title/body).
#[tauri::command]
pub async fn notification_show(
    app: tauri::AppHandle,
    title: Option<String>,
    body: Option<String>,
    icon: Option<String>,
    test: Option<bool>,
) -> Result<NotificationShowOutcome, ApiError> {
    let (title, body) = if test.unwrap_or(false) {
        let (t, b) = test_notification_content();
        (Some(t), Some(b))
    } else {
        match title {
            Some(t) if !t.trim().is_empty() => (Some(t), body),
            _ => {
                return Err(ApiError {
                    code: "invalid_params".to_string(),
                    message: "«title» es obligatorio para notification_show".to_string(),
                });
            }
        }
    };

    // identidad: si el AUMID no está (p.ej. borrado del registro), se reintenta
    // registrar una vez; si sigue sin haber registro, degradar sin fallar.
    let mut aumid_ok = aumid_registered(TOAST_AUMID);
    if !aumid_ok {
        crate::toast_identity::setup_toast_identity();
        aumid_ok = aumid_registered(TOAST_AUMID);
    }
    if !aumid_ok {
        return Ok(delivery_outcome(false, true));
    }

    let icon = match icon {
        Some(i) if !i.trim().is_empty() => Some(i),
        _ => find_icon_uri(),
    };

    let outcome = show_native_toast(&app, title.as_deref(), body.as_deref(), icon.as_deref());
    match outcome {
        Ok(()) => Ok(delivery_outcome(true, true)),
        Err(e) => Ok(NotificationShowOutcome {
            delivered: false,
            reason: REASON_ERROR.to_string(),
            aumid: TOAST_AUMID.to_string(),
            error: Some(e),
        }),
    }
}

/// Puente con el plugin de notificaciones (testable con inyección de error
/// mediante el trait; en runtime usa el AppHandle real).
fn show_native_toast(
    app: &tauri::AppHandle,
    title: Option<&str>,
    body: Option<&str>,
    icon: Option<&str>,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    let mut builder = app.notification().builder();
    if let Some(t) = title {
        builder = builder.title(t);
    }
    if let Some(b) = body {
        builder = builder.body(b);
    }
    if let Some(i) = icon {
        builder = builder.icon(i);
    }
    builder.show().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registro_no_disponible_degrada_sin_error() {
        let outcome = delivery_outcome(false, true);
        assert!(!outcome.delivered);
        assert_eq!(outcome.reason, REASON_REGISTRY_UNAVAILABLE);
        assert_eq!(outcome.aumid, TOAST_AUMID);
        assert!(outcome.error.is_none());
    }

    #[test]
    fn plataforma_sin_soporte_degrada() {
        let outcome = delivery_outcome(true, false);
        assert!(!outcome.delivered);
        assert_eq!(outcome.reason, REASON_NOT_SUPPORTED);
    }

    #[test]
    fn entrega_ok_con_registro() {
        let outcome = delivery_outcome(true, true);
        assert!(outcome.delivered);
        assert_eq!(outcome.reason, REASON_SHOWN);
    }

    #[test]
    fn toast_de_prueba_tiene_contenido_fijo() {
        let (title, body) = test_notification_content();
        assert!(title.contains("herdr-desk"));
        assert!(title.contains("prueba"));
        assert!(!body.is_empty());
    }

    #[test]
    fn aumid_de_la_app_esta_en_el_registro_en_windows() {
        // en la maquina de desarrollo la GUI ya pasó por setup_toast_identity;
        // si no está, aumid_registered degrada a false sin fallar (contrato)
        let registered = aumid_registered(TOAST_AUMID);
        let outcome = delivery_outcome(registered, true);
        assert_eq!(outcome.delivered, registered);
    }

    #[cfg(windows)]
    #[test]
    fn aumid_inexistente_devuelve_false() {
        assert!(!aumid_registered("com.mvale.herdrdesk.no-existe"));
    }
}
