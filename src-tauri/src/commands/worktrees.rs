use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use herdr_core::error::ApiError;

use super::config;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Contrato worktree.* (schema/herdr-api.schema.json, protocolo 19)
//   worktree.list   {cwd?, workspace_id?}                -> worktree_list
//   worktree.create {workspace_id?, cwd?, branch?, base?, path?, label?, focus?}
//                                                        -> worktree_created
//   worktree.open   {workspace_id?, cwd?, branch?, path?, label?, focus?}
//                                                        -> worktree_opened
//   worktree.remove {workspace_id, force=false}          -> worktree_removed
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorktreeInfo {
    pub path: String,
    pub is_bare: bool,
    pub is_detached: bool,
    pub is_prunable: bool,
    pub is_linked_worktree: bool,
    pub label: String,
    pub branch: Option<String>,
    pub open_workspace_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorktreeSourceInfo {
    pub repo_key: String,
    pub repo_name: String,
    pub repo_root: String,
    pub source_checkout_path: String,
    pub source_workspace_id: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct WorktreeListResult {
    pub source: WorktreeSourceInfo,
    pub worktrees: Vec<WorktreeInfo>,
}

#[derive(Serialize, Clone, Debug)]
pub struct WorktreeCreated {
    /// WorkspaceInfo completo (passthrough fiel del server).
    pub workspace: Value,
    pub tab: Value,
    pub root_pane: Value,
    pub worktree: WorktreeInfo,
}

#[derive(Serialize, Clone, Debug)]
pub struct WorktreeOpened {
    pub workspace: Value,
    pub tab: Value,
    pub root_pane: Value,
    pub worktree: WorktreeInfo,
    pub already_open: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct WorktreeRemoved {
    pub workspace_id: String,
    pub path: String,
    pub forced: bool,
}

#[derive(Deserialize, Clone, Debug, Default)]
pub struct WorktreeCreateRequest {
    pub workspace_id: Option<String>,
    pub cwd: Option<String>,
    pub branch: Option<String>,
    pub base: Option<String>,
    pub path: Option<String>,
    pub label: Option<String>,
    pub focus: Option<bool>,
}

#[derive(Deserialize, Clone, Debug, Default)]
pub struct WorktreeOpenRequest {
    pub workspace_id: Option<String>,
    pub cwd: Option<String>,
    pub branch: Option<String>,
    pub path: Option<String>,
    pub label: Option<String>,
    pub focus: Option<bool>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct WorktreeRemoveRequest {
    pub workspace_id: String,
    #[serde(default)]
    pub force: bool,
    /// Doble confirmación expuesta en el contrato: la UI pregunta, y DEBE
    /// reenviar confirm=true junto a la petición. Sin esto no se elimina nada.
    pub confirm: Option<bool>,
}

fn invalid(msg: String) -> ApiError {
    ApiError {
        code: "invalid_params".to_string(),
        message: msg,
    }
}

fn server_error(msg: String) -> ApiError {
    ApiError {
        code: "server".to_string(),
        message: msg,
    }
}

/// worktree.list con la ruta de checkout indicada (o todo, si no se filtra).
pub(crate) async fn worktree_list_rpc(
    client: &herdr_core::RpcClient,
    workspace_id: Option<&str>,
    cwd: Option<&str>,
) -> Result<WorktreeListResult, ApiError> {
    let mut params = json!({});
    if let Some(w) = workspace_id {
        params["workspace_id"] = json!(w);
    }
    if let Some(c) = cwd {
        params["cwd"] = json!(c);
    }
    let result = client
        .call("worktree.list", &params)
        .await
        .map_err(|e| e.api())?;
    parse_worktree_list(&result)
}

/// Parseo tipado del resultado `worktree_list` (contrato con campos exactos).
pub fn parse_worktree_list(result: &Value) -> Result<WorktreeListResult, ApiError> {
    #[derive(Deserialize)]
    struct D {
        #[serde(rename = "type")]
        result_type: String,
        source: WorktreeSourceInfo,
        worktrees: Vec<WorktreeInfo>,
    }
    let d: D = serde_json::from_value(result.clone())
        .map_err(|e| server_error(format!("respuesta worktree_list malformada: {e}")))?;
    if d.result_type != "worktree_list" {
        return Err(server_error(format!(
            "el server respondió {} en lugar de worktree_list",
            d.result_type
        )));
    }
    Ok(WorktreeListResult {
        source: d.source,
        worktrees: d.worktrees,
    })
}

#[derive(Deserialize)]
struct WorktreeCreatedD {
    #[serde(rename = "type")]
    result_type: String,
    workspace: Value,
    tab: Value,
    root_pane: Value,
    worktree: WorktreeInfo,
}

fn parse_worktree_created(result: &Value) -> Result<WorktreeCreated, ApiError> {
    let d: WorktreeCreatedD = serde_json::from_value(result.clone())
        .map_err(|e| server_error(format!("respuesta worktree_created malformada: {e}")))?;
    if d.result_type != "worktree_created" {
        return Err(server_error(format!(
            "el server respondió {} en lugar de worktree_created",
            d.result_type
        )));
    }
    Ok(WorktreeCreated {
        workspace: d.workspace,
        tab: d.tab,
        root_pane: d.root_pane,
        worktree: d.worktree,
    })
}

#[derive(Deserialize)]
struct WorktreeOpenedD {
    #[serde(rename = "type")]
    result_type: String,
    workspace: Value,
    tab: Value,
    root_pane: Value,
    worktree: WorktreeInfo,
    already_open: bool,
}

fn parse_worktree_opened(result: &Value) -> Result<WorktreeOpened, ApiError> {
    let d: WorktreeOpenedD = serde_json::from_value(result.clone())
        .map_err(|e| server_error(format!("respuesta worktree_opened malformada: {e}")))?;
    if d.result_type != "worktree_opened" {
        return Err(server_error(format!(
            "el server respondió {} en lugar de worktree_opened",
            d.result_type
        )));
    }
    Ok(WorktreeOpened {
        workspace: d.workspace,
        tab: d.tab,
        root_pane: d.root_pane,
        worktree: d.worktree,
        already_open: d.already_open,
    })
}

#[derive(Deserialize)]
struct WorktreeRemovedD {
    #[serde(rename = "type")]
    result_type: String,
    workspace_id: String,
    path: String,
    forced: bool,
}

fn parse_worktree_removed(result: &Value) -> Result<WorktreeRemoved, ApiError> {
    let d: WorktreeRemovedD = serde_json::from_value(result.clone())
        .map_err(|e| server_error(format!("respuesta worktree_removed malformada: {e}")))?;
    if d.result_type != "worktree_removed" {
        return Err(server_error(format!(
            "el server respondió {} en lugar de worktree_removed",
            d.result_type
        )));
    }
    Ok(WorktreeRemoved {
        workspace_id: d.workspace_id,
        path: d.path,
        forced: d.forced,
    })
}

/// Expande `~` y `~/...` (o `~\...`) al home del usuario.
pub fn expand_tilde(path: &str) -> String {
    if path == "~" {
        return home_dir().unwrap_or_else(|| path.to_string());
    }
    for sep in ['/', '\\'] {
        let prefix = format!("~{sep}");
        if let Some(rest) = path.strip_prefix(&prefix)
            && let Some(home) = home_dir()
        {
            return format!("{home}{sep}{rest}");
        }
    }
    path.to_string()
}

fn home_dir() -> Option<String> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .filter(|s| !s.is_empty())
}

/// Default de ruta para crear worktrees: clave `directory` de `[worktrees]`
/// en la config de herdr (con `~` expandido). None si no está definida.
pub fn worktrees_directory_from_config() -> Option<String> {
    let raw = std::fs::read_to_string(config::config_path()).ok()?;
    let doc = raw.parse::<toml_edit::DocumentMut>().ok()?;
    let value = doc
        .as_table()
        .get("worktrees")?
        .as_table()?
        .get("directory")?
        .as_str()?
        .trim()
        .to_string();
    if value.is_empty() {
        return None;
    }
    Some(expand_tilde(&value))
}

fn guard_non_empty(field: &str, value: &Option<String>) -> Result<(), ApiError> {
    if let Some(v) = value
        && v.trim().is_empty()
    {
        return Err(invalid(format!("«{field}» no puede estar vacío")));
    }
    Ok(())
}

/// Crea y abre un worktree (rama nueva). La ruta por defecto sale de
/// `[worktrees] directory` de la config; las ramas las lista la UI con
/// `git branch --format=%(refname:short)` por la lista blanca de cli_run.
pub(crate) async fn worktree_create_rpc(
    client: &herdr_core::RpcClient,
    request: &WorktreeCreateRequest,
) -> Result<WorktreeCreated, ApiError> {
    for (field, value) in [
        ("branch", &request.branch),
        ("base", &request.base),
        ("path", &request.path),
        ("label", &request.label),
        ("cwd", &request.cwd),
    ] {
        guard_non_empty(field, value)?;
    }
    let path = match &request.path {
        Some(p) => Some(p.clone()),
        None => worktrees_directory_from_config(),
    };
    let mut params = json!({
        "focus": request.focus.unwrap_or(false),
    });
    for (key, value) in [
        ("workspace_id", &request.workspace_id),
        ("cwd", &request.cwd),
        ("branch", &request.branch),
        ("base", &request.base),
        ("label", &request.label),
    ] {
        if let Some(v) = value {
            params[key] = json!(v);
        }
    }
    if let Some(p) = &path {
        params["path"] = json!(p);
    }
    let result = client
        .call("worktree.create", &params)
        .await
        .map_err(|e| e.api())?;
    parse_worktree_created(&result)
}

/// Abre un worktree existente (por path y/o branch).
pub(crate) async fn worktree_open_rpc(
    client: &herdr_core::RpcClient,
    request: &WorktreeOpenRequest,
) -> Result<WorktreeOpened, ApiError> {
    for (field, value) in [
        ("branch", &request.branch),
        ("path", &request.path),
        ("label", &request.label),
        ("cwd", &request.cwd),
    ] {
        guard_non_empty(field, value)?;
    }
    if request.branch.is_none() && request.path.is_none() {
        return Err(invalid(
            "hay que indicar branch o path del worktree a abrir".to_string(),
        ));
    }
    let mut params = json!({
        "focus": request.focus.unwrap_or(false),
    });
    for (key, value) in [
        ("workspace_id", &request.workspace_id),
        ("cwd", &request.cwd),
        ("branch", &request.branch),
        ("path", &request.path),
        ("label", &request.label),
    ] {
        if let Some(v) = value {
            params[key] = json!(v);
        }
    }
    let result = client
        .call("worktree.open", &params)
        .await
        .map_err(|e| e.api())?;
    parse_worktree_opened(&result)
}

/// Elimina un checkout de worktree. Doble confirmación en el contrato:
/// la UI pregunta al usuario y reenvía `confirm: true`; `force` es para
/// worktrees con cambios sin guardar. Sin `confirm: true` no se elimina nada.
pub(crate) async fn worktree_remove_rpc(
    client: &herdr_core::RpcClient,
    request: &WorktreeRemoveRequest,
) -> Result<WorktreeRemoved, ApiError> {
    validate_remove_request(request)?;
    let params = json!({
        "workspace_id": request.workspace_id,
        "force": request.force,
    });
    let result = client
        .call("worktree.remove", &params)
        .await
        .map_err(|e| e.api())?;
    parse_worktree_removed(&result)
}

fn validate_remove_request(request: &WorktreeRemoveRequest) -> Result<(), ApiError> {
    if request.workspace_id.trim().is_empty() {
        return Err(invalid("«workspace_id» es obligatorio".to_string()));
    }
    if request.confirm != Some(true) {
        return Err(invalid(
            "doble confirmación requerida: reenvía la petición con confirm=true".to_string(),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Comandos Tauri
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn worktree_list(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    workspace_id: Option<String>,
    cwd: Option<String>,
) -> Result<WorktreeListResult, ApiError> {
    let client = state.current().client.clone();
    worktree_list_rpc(&client, workspace_id.as_deref(), cwd.as_deref()).await
}

#[tauri::command]
pub async fn worktree_create(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    request: WorktreeCreateRequest,
) -> Result<WorktreeCreated, ApiError> {
    let client = state.current().client.clone();
    worktree_create_rpc(&client, &request).await
}

#[tauri::command]
pub async fn worktree_open(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    request: WorktreeOpenRequest,
) -> Result<WorktreeOpened, ApiError> {
    let client = state.current().client.clone();
    worktree_open_rpc(&client, &request).await
}

#[tauri::command]
pub async fn worktree_remove(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    request: WorktreeRemoveRequest,
) -> Result<WorktreeRemoved, ApiError> {
    let client = state.current().client.clone();
    worktree_remove_rpc(&client, &request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn fixture_result() -> Value {
        let raw = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../schema/fixtures/worktree_list.json"),
        )
        .expect("fixture de worktree list");
        let v: Value = serde_json::from_str(&raw).expect("JSON de la fixture");
        v["result"].clone()
    }

    #[test]
    fn parsea_fixture_real_de_worktree_list() {
        let parsed = parse_worktree_list(&fixture_result()).expect("parseo");
        assert_eq!(parsed.source.repo_name, "herdr");
        assert_eq!(parsed.source.repo_root, r"C:\Users\dev\Documents\herdr");
        assert_eq!(parsed.source.source_workspace_id.as_deref(), Some("w1"));
        assert_eq!(parsed.worktrees.len(), 1);
        let wt = &parsed.worktrees[0];
        assert_eq!(wt.branch.as_deref(), Some("main"));
        assert_eq!(wt.label, "herdr");
        assert_eq!(wt.open_workspace_id.as_deref(), Some("w1"));
        assert!(!wt.is_bare && !wt.is_detached && !wt.is_prunable && !wt.is_linked_worktree);
    }

    #[test]
    fn rechaza_tipo_inesperado_del_server() {
        let v = json!({"type": "otra_cosa", "source": {}, "worktrees": []});
        let err = parse_worktree_list(&v).expect_err("debe fallar");
        assert_eq!(err.code, "server");
    }

    #[test]
    fn remove_sin_confirmacion_se_rechaza() {
        let req = WorktreeRemoveRequest {
            workspace_id: "w1".to_string(),
            force: false,
            confirm: None,
        };
        let err = validate_remove_request(&req).expect_err("sin confirm");
        assert_eq!(err.code, "invalid_params");
        assert!(err.message.contains("confirm=true"));

        let sin_workspace = WorktreeRemoveRequest {
            workspace_id: "  ".to_string(),
            force: false,
            confirm: Some(true),
        };
        let err2 = validate_remove_request(&sin_workspace).expect_err("workspace vacío");
        assert_eq!(err2.code, "invalid_params");
    }

    #[test]
    fn remove_con_confirmacion_pasa_el_guard() {
        let req = WorktreeRemoveRequest {
            workspace_id: "w1".to_string(),
            force: true,
            confirm: Some(true),
        };
        assert!(validate_remove_request(&req).is_ok());
    }

    #[test]
    fn expande_tilde_al_home() {
        let home = home_dir().expect("home del usuario");
        assert_eq!(expand_tilde("~"), home);
        let expanded = expand_tilde("~/worktrees");
        assert!(expanded.starts_with(&home), "{expanded}");
        assert!(expanded.contains("worktrees"));
        // separador windows
        let expanded2 = expand_tilde("~\\worktrees");
        assert!(expanded2.starts_with(&home));
        // sin tilde queda igual
        assert_eq!(expand_tilde(r"C:\tmp"), r"C:\tmp");
    }

    #[test]
    fn defaults_de_creacion_usan_focus_false() {
        let req = WorktreeCreateRequest::default();
        assert_eq!(req.focus, None);
        assert_eq!(req.branch, None);
        // el path por defecto lo resuelve la config (None si [worktrees] directory no existe)
        assert_eq!(req.path, None);
    }
}
