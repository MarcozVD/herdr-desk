#![cfg(all(test, feature = "sandbox"))]

//! Notificaciones nativas en entorno sandbox (sesion hd-test-*): identidad
//! AUMID real en el registro y contrato de degradacion. El toast visual solo
//! se dispara desde la GUI (necesita AppHandle); aqui se verifica la
//! identidad y la logica de entrega.

use crate::commands::notifications::{delivery_outcome, test_notification_content};
use crate::sandbox_guard::Sandbox;
use crate::toast_identity::{
    TOAST_AUMID, TOAST_DISPLAY_NAME, aumid_registered, write_aumid_for_test,
};

/// Roundtrip real del registro en la maquina de test: registrar -> presente ->
/// borrar -> ausente. Es el mismo mecanismo que usa notification_show para
/// decidir si entrega o degrada.
#[test]
fn aumid_roundtrip_en_registro_real() {
    let test_aumid = "com.mvale.herdrdesk.sandbox-test";
    write_aumid_for_test(test_aumid, TOAST_DISPLAY_NAME).expect("registrar AUMID de prueba");
    assert!(aumid_registered(test_aumid));

    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let _ = hkcu.delete_subkey(format!("SOFTWARE\\Classes\\AppUserModelId\\{test_aumid}"));
    assert!(!aumid_registered(test_aumid));
}

/// Contrato completo con server sandbox activo: el AUMID de la app responde y
/// la logica de entrega es coherente con el estado del registro.
#[tokio::test]
async fn entrega_coherente_con_registro_en_sesion_sandbox() {
    let _sandbox = Sandbox::start();

    let registered = aumid_registered(TOAST_AUMID);
    let outcome = delivery_outcome(registered, true);
    assert_eq!(outcome.aumid, TOAST_AUMID);
    if registered {
        assert_eq!(outcome.reason, "shown");
        assert!(outcome.delivered);
    } else {
        assert_eq!(outcome.reason, "registry_unavailable");
        assert!(!outcome.delivered);
        assert!(outcome.error.is_none(), "degradar en silencio");
    }
    assert_eq!(
        outcome.reason,
        if registered {
            "shown"
        } else {
            "registry_unavailable"
        }
    );
}

/// El contenido del toast de prueba es estable (botón "probar" de la UI).
#[test]
fn contenido_de_prueba_estable() {
    let (title, body) = test_notification_content();
    assert!(title.contains(TOAST_DISPLAY_NAME));
    assert!(!body.trim().is_empty());
}
