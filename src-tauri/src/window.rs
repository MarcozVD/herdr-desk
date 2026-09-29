use tauri::AppHandle;
use tauri::Manager;

/// Shows the main window once the frontend reports first render.
pub fn show_main(app: &AppHandle) -> Result<(), tauri::Error> {
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

/// B2 — trae la ventana principal al frente: segunda instancia de la app y
/// "Mostrar herdr-desk" del tray. `unminimize` es imprescindible: `show` no
/// restaura una ventana minimizada.
pub fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
