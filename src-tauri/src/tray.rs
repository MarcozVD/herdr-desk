use serde::Serialize;
use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Wry};

use crate::state::AppState;
use herdr_core::error::ApiError;

#[derive(Serialize, Clone, Debug, PartialEq, serde::Deserialize)]
pub struct TrayAgent {
    pub pane_id: String,
    pub agent: String,
    pub display: String,
    pub status: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, serde::Deserialize)]
pub struct TraySession {
    pub name: String,
    pub running: bool,
    pub active: bool,
    pub default: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct TrayUpdate {
    pub sessions: Vec<TraySession>,
    pub agents: Vec<TrayAgent>,
}

/// Estado del tray en el backend: sesiones (del frontend) y agentes (de los
/// eventos de la conexion S + el frontend).
#[derive(Default)]
pub struct TrayState {
    pub sessions: Vec<TraySession>,
    pub agents: Vec<TrayAgent>,
    pub dirty: std::sync::Arc<tokio::sync::Notify>,
}

impl TrayState {
    pub fn upsert_agent(&mut self, agent: TrayAgent) {
        match self.agents.iter_mut().find(|a| a.pane_id == agent.pane_id) {
            Some(existing) => *existing = agent,
            None => self.agents.push(agent),
        }
        self.dirty.notify_waiters();
    }
}

/// Especificacion de menu testeable sin runtime de Tauri.
#[derive(Debug, PartialEq)]
pub enum MenuEntry {
    Item {
        id: String,
        label: String,
        enabled: bool,
    },
    Separator,
    Submenu {
        label: String,
        entries: Vec<MenuEntry>,
    },
}

pub const ID_SHOW: &str = "show";
pub const ID_QUIT: &str = "quit";
pub const PREFIX_CONNECT: &str = "sess-connect:";
pub const PREFIX_STOP: &str = "sess-stop:";
pub const PREFIX_FOCUS: &str = "agent-focus:";

static TRAY_ICON: std::sync::Mutex<Option<tauri::tray::TrayIcon<Wry>>> =
    std::sync::Mutex::new(None);

/// Icono de la bandeja en NEGRO, embebido en tiempo de compilacion
/// (include_bytes, sin ficheros en runtime). Sobre una barra de tareas clara
/// el icono BLANCO del ejecutable seria invisible: la bandeja lleva su propio
/// negro, la ventana/el exe llevan el blanco. Fuente: assets/icons/
/// herdr-black.png procesada con `tauri icon` (32x32, trazo negro, fondo
/// transparente).
const TRAY_ICON_PNG: &[u8] = include_bytes!("../icons/tray-black.png");

pub fn blocked_count(agents: &[TrayAgent]) -> usize {
    agents.iter().filter(|a| a.status == "blocked").count()
}

/// Estructura del menu del tray, pura para testear.
pub fn build_menu_spec(tray: &TrayState, active_session: &str) -> Vec<MenuEntry> {
    let mut entries = Vec::new();
    entries.push(MenuEntry::Item {
        id: ID_SHOW.to_string(),
        label: "Mostrar herdr-desk".to_string(),
        enabled: true,
    });
    entries.push(MenuEntry::Separator);

    let mut sessions = Vec::new();
    for s in &tray.sessions {
        if s.running && s.name == active_session {
            sessions.push(MenuEntry::Item {
                id: format!("noop:{}", s.name),
                label: format!("\u{25cf} {} (activa)", s.name),
                enabled: false,
            });
        } else if s.running {
            sessions.push(MenuEntry::Item {
                id: format!("{PREFIX_CONNECT}{}", s.name),
                label: format!("Conectar {}", s.name),
                enabled: true,
            });
            if !s.default {
                sessions.push(MenuEntry::Item {
                    id: format!("{PREFIX_STOP}{}", s.name),
                    label: format!("Detener {}…", s.name),
                    enabled: true,
                });
            }
        } else {
            sessions.push(MenuEntry::Item {
                id: format!("noop:{}", s.name),
                label: format!("{} (detenida)", s.name),
                enabled: false,
            });
        }
    }
    entries.push(MenuEntry::Submenu {
        label: "Sesiones".to_string(),
        entries: sessions,
    });

    let blocked = blocked_count(&tray.agents);
    let mut agent_entries = vec![MenuEntry::Item {
        id: "noop:blocked".to_string(),
        label: format!("Bloqueados: {blocked}"),
        enabled: false,
    }];
    for a in &tray.agents {
        if a.status == "blocked" || a.status == "working" {
            let name = if a.display.is_empty() {
                a.agent.clone()
            } else {
                a.display.clone()
            };
            agent_entries.push(MenuEntry::Item {
                id: format!("{PREFIX_FOCUS}{}", a.pane_id),
                label: format!("Enfocar {name} ({})", a.pane_id),
                enabled: true,
            });
        }
    }
    entries.push(MenuEntry::Submenu {
        label: "Agentes".to_string(),
        entries: agent_entries,
    });

    entries.push(MenuEntry::Separator);
    entries.push(MenuEntry::Item {
        id: ID_QUIT.to_string(),
        label: "Salir".to_string(),
        enabled: true,
    });
    entries
}

fn build_items(
    app: &AppHandle,
    entries: &[MenuEntry],
) -> tauri::Result<Vec<std::boxed::Box<dyn IsMenuItem<Wry>>>> {
    let mut items: Vec<std::boxed::Box<dyn IsMenuItem<Wry>>> = Vec::new();
    for entry in entries {
        match entry {
            MenuEntry::Item { id, label, enabled } => {
                let item = MenuItem::with_id(app, id, label, *enabled, None::<&str>)?;
                items.push(std::boxed::Box::new(item));
            }
            MenuEntry::Separator => {
                let sep = PredefinedMenuItem::separator(app)?;
                items.push(std::boxed::Box::new(sep));
            }
            MenuEntry::Submenu { label, entries } => {
                let submenu: Submenu<Wry> = Submenu::with_id(app, label, label, true)?;
                for item in build_items(app, entries)? {
                    submenu.append(item.as_ref())?;
                }
                items.push(std::boxed::Box::new(submenu));
            }
        }
    }
    Ok(items)
}

fn build_menu(app: &AppHandle, tray: &TrayState, active_session: &str) -> tauri::Result<Menu<Wry>> {
    let items = build_items(app, &build_menu_spec(tray, active_session))?;
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|b| b.as_ref()).collect();
    Menu::with_items(app, &refs)
}

/// Crea el icono de bandeja y deja la tarea de refresco del menu corriendo.
pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let state = app.state::<std::sync::Arc<AppState>>();
    let active = state.current().session.clone();
    let menu = {
        let tray_state = state.tray.lock().unwrap();
        build_menu(app, &tray_state, &active)?
    };

    // icono explicito de la bandeja (NEGRO): NO usamos default_window_icon,
    // que seria el blanco del ejecutable y desaparece en barras claras
    let mut builder = tauri::tray::TrayIconBuilder::with_id("main-tray");
    match tauri::image::Image::from_bytes(TRAY_ICON_PNG) {
        Ok(icon) => builder = builder.icon(icon),
        Err(err) => tracing::warn!("icono negro del tray no decodificable: {err}"),
    }
    let tray = builder
        .tooltip("herdr-desk")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id().as_ref());
        })
        .build(app)?;
    *TRAY_ICON.lock().unwrap() = Some(tray);

    // tarea de refresco del menu cuando el estado cambia
    let app2 = app.clone();
    let dirty = state.tray.lock().unwrap().dirty.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            dirty.notified().await;
            tokio::time::sleep(Duration::from_millis(100)).await;
            let st = app2.state::<AppState>();
            let active = st.current().session.clone();
            let (sessions, agents) = {
                let tray = st.tray.lock().unwrap();
                (tray.sessions.clone(), tray.agents.clone())
            };
            let tray_state = TrayState {
                sessions,
                agents,
                ..Default::default()
            };
            match build_menu(&app2, &tray_state, &active) {
                Ok(menu) => {
                    if let Some(tray) = TRAY_ICON.lock().unwrap().as_ref() {
                        let _ = tray.set_menu(Some(menu));
                    }
                }
                Err(err) => tracing::warn!("no se pudo reconstruir el menu del tray: {err}"),
            }
        }
    });
    Ok(())
}

use std::time::Duration;

fn handle_menu_event(app: &AppHandle, id: &str) {
    let state = app.state::<std::sync::Arc<AppState>>();
    if id == ID_SHOW {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
        return;
    }
    if id == ID_QUIT {
        tracing::info!("salida desde el tray");
        app.exit(0);
        return;
    }
    if let Some(name) = id.strip_prefix(PREFIX_CONNECT) {
        let name = name.to_string();
        let state2 = state.inner().clone();
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            match crate::commands::session::connect_session(&state2, Some(name.clone())).await {
                Ok(_) => state2.broadcast_event(
                    &serde_json::json!({"event": "session.connected", "data": {"session": name}})
                        .to_string(),
                ),
                Err(err) => tracing::warn!("connect desde tray fallo: {}", err.message),
            }
            drop(app2);
        });
        return;
    }
    if let Some(name) = id.strip_prefix(PREFIX_STOP) {
        let name = name.to_string();
        let state2 = state.inner().clone();
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            // confirmacion fuerte: dialogo nativo con las consecuencias explicitas
            let confirmed = tauri_plugin_dialog::DialogExt::dialog(&app2)
                .message(format!(
                    "Detener la sesion {name}? Termina todos los procesos de sus panes."
                ))
                .title("Detener sesion")
                .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
                    "Detener".to_string(),
                    "Cancelar".to_string(),
                ))
                .blocking_show();
            if confirmed {
                match herdr_core::cli::stop_session(&name) {
                    Ok(out) if out.ok() => state2.broadcast_event(
                        &serde_json::json!({"event": "session.stopped", "data": {"session": name}})
                            .to_string(),
                    ),
                    Ok(out) => tracing::warn!("stop de {name} fallo: {}", out.stderr.trim()),
                    Err(err) => tracing::warn!("stop de {name} fallo: {}", err.message()),
                }
            }
            drop(app2);
        });
        return;
    }
    if let Some(target) = id.strip_prefix(PREFIX_FOCUS) {
        let target = target.to_string();
        let state2 = state.inner().clone();
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            let client = state2.current().client.clone();
            match client
                .call("agent.focus", &serde_json::json!({"target": target}))
                .await
            {
                Ok(_) => {
                    if let Some(window) = app2.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                Err(err) => tracing::warn!("agent.focus desde tray fallo: {}", err.message()),
            }
            drop(app2);
        });
    }
}

/// Actualiza el estado del tray desde el frontend (snapshot resumido).
#[tauri::command]
pub async fn tray_update(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    sessions: Vec<TraySession>,
    agents: Vec<TrayAgent>,
) -> Result<(), ApiError> {
    let mut tray = state.tray.lock().unwrap();
    tray.sessions = sessions;
    for agent in agents {
        tray.upsert_agent(agent);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_spec_lists_sessions_with_connect_and_stop() {
        let tray = TrayState {
            sessions: vec![
                TraySession {
                    name: "herdr-desk-dev".to_string(),
                    running: true,
                    active: true,
                    default: false,
                },
                TraySession {
                    name: "default".to_string(),
                    running: true,
                    active: false,
                    default: true,
                },
                TraySession {
                    name: "vieja".to_string(),
                    running: true,
                    active: false,
                    default: false,
                },
                TraySession {
                    name: "muerta".to_string(),
                    running: false,
                    active: false,
                    default: false,
                },
            ],
            ..Default::default()
        };
        let spec = build_menu_spec(&tray, "herdr-desk-dev");
        let submenu = spec
            .iter()
            .find_map(|e| match e {
                MenuEntry::Submenu { label, entries } if label == "Sesiones" => Some(entries),
                _ => None,
            })
            .expect("submenu sesiones");
        let labels: Vec<&str> = submenu
            .iter()
            .filter_map(|e| match e {
                MenuEntry::Item { label, .. } => Some(label.as_str()),
                _ => None,
            })
            .collect();
        assert!(
            labels
                .iter()
                .any(|l| l.contains("(activa)") && l.contains("herdr-desk-dev"))
        );
        assert!(labels.iter().any(|l| l.contains("Conectar default")));
        assert!(
            !labels.iter().any(|l| l.contains("Detener default")),
            "default no se detiene"
        );
        assert!(labels.iter().any(|l| l.contains("Detener vieja…")));
        assert!(
            labels
                .iter()
                .any(|l| l.contains("(detenida)") && l.contains("muerta"))
        );
    }

    #[test]
    fn menu_spec_shows_blocked_count_and_focus_items() {
        let tray = TrayState {
            agents: vec![
                TrayAgent {
                    pane_id: "w1:p1".to_string(),
                    agent: "opencode".to_string(),
                    display: String::new(),
                    status: "blocked".to_string(),
                },
                TrayAgent {
                    pane_id: "w1:p2".to_string(),
                    agent: "claude".to_string(),
                    display: String::new(),
                    status: "working".to_string(),
                },
                TrayAgent {
                    pane_id: "w1:p3".to_string(),
                    agent: "codex".to_string(),
                    display: String::new(),
                    status: "idle".to_string(),
                },
            ],
            ..Default::default()
        };
        let spec = build_menu_spec(&tray, "s");
        let submenu = spec
            .iter()
            .find_map(|e| match e {
                MenuEntry::Submenu { label, entries } if label == "Agentes" => Some(entries),
                _ => None,
            })
            .expect("submenu agentes");
        let ids: Vec<&str> = submenu
            .iter()
            .filter_map(|e| match e {
                MenuEntry::Item { id, label, .. } => {
                    if label.starts_with("Bloqueados:") {
                        return Some("counter");
                    }
                    Some(id.as_str())
                }
                _ => None,
            })
            .collect();
        assert!(ids.contains(&"counter"));
        assert!(ids.contains(&"agent-focus:w1:p1"), "blocked: {ids:?}");
        assert!(
            ids.contains(&"agent-focus:w1:p2"),
            "working tambien se enfoca"
        );
        assert!(!ids.contains(&"agent-focus:w1:p3"), "idle no aparece");
        assert_eq!(blocked_count(&tray.agents), 1);
    }

    #[test]
    fn menu_spec_has_show_and_quit() {
        let spec = build_menu_spec(&TrayState::default(), "x");
        let ids: Vec<&str> = spec
            .iter()
            .filter_map(|e| match e {
                MenuEntry::Item { id, .. } => Some(id.as_str()),
                _ => None,
            })
            .collect();
        assert!(ids.contains(&ID_SHOW));
        assert!(ids.contains(&ID_QUIT));
    }
}
