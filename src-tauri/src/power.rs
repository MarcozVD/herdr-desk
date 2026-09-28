//! T5.2 — Memoria del WebView2 en reposo: al minimizar la ventana se pasa el
//! WebView2 a `MemoryUsageTargetLevel::Low` (menos páginas residentes) y se
//! vuelve a `Normal` al restaurarla o traerla al frente (incluido «Mostrar
//! herdr-desk» del icono de bandeja). Usa la misma `webview2-com` que Tauri
//! (0.38): llamar con otra versión rompería el cast COM.
//!
//! Es una optimización: si el runtime de WebView2 es anterior a `ICoreWebView2_19`
//! o la llamada falla, no pasa nada.

use tauri::WebviewWindow;

/// Cambia el nivel de memoria del WebView2 de `window`.
#[cfg(windows)]
pub fn set_memory_usage_low(window: &WebviewWindow, low: bool) {
    let _ = window.with_webview(move |webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL, ICoreWebView2_19,
        };
        use windows_core::Interface;

        // SAFETY: mismo hilo de UI que el WebView2 (lo garantiza `with_webview`).
        let core = match unsafe { webview.controller().CoreWebView2() } {
            Ok(core) => core,
            Err(err) => {
                tracing::debug!("CoreWebView2 no disponible: {err}");
                return;
            }
        };
        let core19 = match core.cast::<ICoreWebView2_19>() {
            Ok(core19) => core19,
            Err(_) => {
                tracing::debug!("WebView2 sin ICoreWebView2_19: no hay MemoryUsageTargetLevel");
                return;
            }
        };
        let level = if low {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        } else {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        };
        // SAFETY: `with_webview` ejecuta el closure en el hilo de UI del WebView2,
        // que es donde COM exige estas llamadas.
        match unsafe { core19.SetMemoryUsageTargetLevel(level) } {
            Ok(()) => tracing::debug!(
                "MemoryUsageTargetLevel={}",
                if low { "low" } else { "normal" }
            ),
            Err(err) => tracing::debug!("MemoryUsageTargetLevel fallo: {err}"),
        }
    });
}

#[cfg(not(windows))]
pub fn set_memory_usage_low(_window: &WebviewWindow, _low: bool) {}

/// Engancha el ciclo minimizar/restaurar de la ventana principal.
pub fn install(window: &WebviewWindow) {
    let win = window.clone();
    window.clone().on_window_event(move |event| match event {
        // Minimizar/restaurar llega como Resized; el tamaño del evento no es
        // fiable (medido: seguía reportando el tamaño normal), así que se
        // pregunta al estado real de la ventana.
        tauri::WindowEvent::Resized(_) => {
            set_memory_usage_low(&win, win.is_minimized().unwrap_or(false));
        }
        // Restaurada o traída al frente (tray incluido): memoria normal.
        tauri::WindowEvent::Focused(true) => set_memory_usage_low(&win, false),
        _ => {}
    });
}
