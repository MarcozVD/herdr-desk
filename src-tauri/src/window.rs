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
