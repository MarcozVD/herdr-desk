use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use herdr_core::error::ApiError;

use crate::state::AppState;

// ---------------------------------------------------------------------------
// Contrato plugin.* (schema/herdr-api.schema.json, protocolo 19):
//   plugin.list    {plugin_id?}                  -> plugin_list {plugins}
//   plugin.enable  {plugin_id}                   -> plugin_enabled {plugin}
//   plugin.disable {plugin_id}                   -> plugin_disabled {plugin}
//   plugin.unlink  {plugin_id}                   -> plugin_unlinked {plugin_id, removed}
//   plugin.link    {path, enabled=true, source?} -> plugin_linked {plugin}
//   plugin.action.list   {plugin_id?}            -> plugin_action_list {actions}
//   plugin.action.invoke {action_id, plugin_id?, context?} -> plugin_action_invoked
//   plugin.log.list      {plugin_id?, limit?}    -> plugin_log_list {logs}
//   plugin.pane.open/focus/close                                 -> plugin_pane_*
// Instalacion desde GitHub via CLI `herdr plugin install owner/repo[/subdir]
// --ref X -y`, solo tras vista previa propia (repo+ref+manifiesto leidos del
// repo) y confirmacion explicita en el contrato.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct PluginSourceInfo {
    /// local | github
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub repo: Option<String>,
    #[serde(default)]
    pub subdir: Option<String>,
    #[serde(default)]
    pub requested_ref: Option<String>,
    #[serde(default)]
    pub resolved_commit: Option<String>,
    #[serde(default)]
    pub managed_path: Option<String>,
    #[serde(default)]
    pub installed_unix_ms: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PluginActionInfo {
    pub plugin_id: String,
    pub action_id: String,
    pub title: String,
    pub command: Vec<String>,
    #[serde(default)]
    pub contexts: Vec<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub platforms: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PluginManifestPane {
    pub id: String,
    pub title: String,
    pub command: Vec<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// overlay | popup | split | tab | zoomed
    #[serde(default)]
    pub placement: Option<String>,
    /// celdas (int) o porcentaje ("80%")
    #[serde(default)]
    pub width: Option<Value>,
    #[serde(default)]
    pub height: Option<Value>,
    #[serde(default)]
    pub platforms: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PluginManifestEventHook {
    pub on: String,
    pub command: Vec<String>,
    #[serde(default)]
    pub platforms: Option<Vec<String>>,
}

/// InstalledPluginInfo exacto del schema. build/startup/link_handlers pasan
/// como Value (no son parte de la vista principal de T4.1).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PluginInfo {
    pub plugin_id: String,
    pub name: String,
    pub version: String,
    pub manifest_path: String,
    pub plugin_root: String,
    pub enabled: bool,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub min_herdr_version: String,
    #[serde(default)]
    pub source: Option<PluginSourceInfo>,
    #[serde(default)]
    pub actions: Vec<PluginActionInfo>,
    #[serde(default)]
    pub panes: Vec<PluginManifestPane>,
    #[serde(default)]
    pub events: Vec<PluginManifestEventHook>,
    #[serde(default)]
    pub build: Vec<Value>,
    #[serde(default)]
    pub startup: Vec<Value>,
    #[serde(default)]
    pub link_handlers: Vec<Value>,
    #[serde(default)]
    pub platforms: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct PluginWorktreeContext {
    #[serde(default)]
    pub repo_key: String,
    #[serde(default)]
    pub repo_name: String,
    #[serde(default)]
    pub repo_root: String,
    #[serde(default)]
    pub source_checkout_path: String,
    #[serde(default)]
    pub source_workspace_id: Option<String>,
}

/// PluginInvocationContext exacto (workspace/tab/pane/selection).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct PluginInvocationContext {
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub workspace_label: Option<String>,
    #[serde(default)]
    pub workspace_cwd: Option<String>,
    #[serde(default)]
    pub tab_id: Option<String>,
    #[serde(default)]
    pub tab_label: Option<String>,
    #[serde(default)]
    pub focused_pane_id: Option<String>,
    #[serde(default)]
    pub focused_pane_agent: Option<String>,
    /// idle | working | blocked | done | unknown
    #[serde(default)]
    pub focused_pane_status: Option<String>,
    #[serde(default)]
    pub focused_pane_cwd: Option<String>,
    #[serde(default)]
    pub selected_text: Option<String>,
    #[serde(default)]
    pub clicked_url: Option<String>,
    #[serde(default)]
    pub link_handler_id: Option<String>,
    #[serde(default)]
    pub invocation_source: Option<String>,
    #[serde(default)]
    pub correlation_id: Option<String>,
    #[serde(default)]
    pub worktree: Option<PluginWorktreeContext>,
}

#[derive(Serialize, Clone, Debug)]
pub struct PluginUnlinked {
    pub plugin_id: String,
    pub removed: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct PluginActionInvoked {
    pub action: PluginActionInfo,
    pub context: Option<PluginInvocationContext>,
    pub log: PluginCommandLogInfo,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PluginCommandLogInfo {
    pub log_id: String,
    pub plugin_id: String,
    pub command: Vec<String>,
    /// running | succeeded | failed
    pub status: String,
    pub started_unix_ms: u64,
    #[serde(default)]
    pub finished_unix_ms: Option<u64>,
    #[serde(default)]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub event: Option<String>,
    #[serde(default)]
    pub action_id: Option<String>,
    #[serde(default)]
    pub stdout: Option<String>,
    #[serde(default)]
    pub stderr: Option<String>,
}

#[derive(Deserialize, Clone, Debug, Default)]
pub struct PluginPaneOpenRequest {
    pub plugin_id: String,
    pub entrypoint: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub target_pane_id: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    /// right | down
    #[serde(default)]
    pub direction: Option<String>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
    #[serde(default)]
    pub focus: Option<bool>,
    /// celdas (int) o porcentaje ("80%")
    #[serde(default)]
    pub width: Option<Value>,
    #[serde(default)]
    pub height: Option<Value>,
    /// overlay | popup | split | tab | zoomed
    #[serde(default)]
    pub placement: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct PluginLinkRequest {
    pub path: String,
    #[serde(default)]
    pub enabled: Option<bool>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct PluginUnlinkRequest {
    pub plugin_id: String,
    /// Confirmación expuesta en el contrato: la UI pregunta y reenvía
    /// confirm=true. Sin ella no se desvincula nada.
    pub confirm: Option<bool>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct PluginActionInvokeRequest {
    pub action_id: String,
    #[serde(default)]
    pub plugin_id: Option<String>,
    #[serde(default)]
    pub context: Option<PluginInvocationContext>,
}

// ---------------------------------------------------------------------------
// Vista previa e instalación desde GitHub
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct PluginManifestPreview {
    pub id: String,
    pub name: String,
    pub version: String,
    pub min_herdr_version: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct PluginInstallPreview {
    pub spec: String,
    pub owner: String,
    pub repo: String,
    pub subdir: Option<String>,
    pub requested_ref: Option<String>,
    pub resolved_commit: Option<String>,
    pub manifest: PluginManifestPreview,
    pub manifest_raw: String,
    /// Token que plugin_install exige para probar que hubo vista previa.
    pub preview_token: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct PluginInstallOutcome {
    pub spec: String,
    pub requested_ref: Option<String>,
    pub exit_code: i32,
    pub output: String,
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

// ---------------------------------------------------------------------------
// Parseo de resultados
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct PluginListD {
    #[serde(rename = "type")]
    result_type: String,
    plugins: Vec<PluginInfo>,
}

pub fn parse_plugin_list(result: &Value) -> Result<Vec<PluginInfo>, ApiError> {
    let d: PluginListD = serde_json::from_value(result.clone())
        .map_err(|e| server_error(format!("respuesta plugin_list malformada: {e}")))?;
    if d.result_type != "plugin_list" {
        return Err(server_error(format!(
            "el server respondió {} en lugar de plugin_list",
            d.result_type
        )));
    }
    Ok(d.plugins)
}

#[derive(Deserialize)]
struct PluginWrappedD {
    #[serde(rename = "type")]
    result_type: String,
    plugin: PluginInfo,
}

pub(crate) fn parse_plugin_wrapped(result: &Value, expected: &str) -> Result<PluginInfo, ApiError> {
    let d: PluginWrappedD = serde_json::from_value(result.clone())
        .map_err(|e| server_error(format!("respuesta {expected} malformada: {e}")))?;
    if d.result_type != expected {
        return Err(server_error(format!(
            "el server respondió {} en lugar de {expected}",
            d.result_type
        )));
    }
    Ok(d.plugin)
}

#[derive(Deserialize)]
struct PluginUnlinkedD {
    #[serde(rename = "type")]
    result_type: String,
    plugin_id: String,
    removed: bool,
}

fn parse_plugin_unlinked(result: &Value) -> Result<PluginUnlinked, ApiError> {
    let d: PluginUnlinkedD = serde_json::from_value(result.clone())
        .map_err(|e| server_error(format!("respuesta plugin_unlinked malformada: {e}")))?;
    if d.result_type != "plugin_unlinked" {
        return Err(server_error(format!(
            "el server respondió {} en lugar de plugin_unlinked",
            d.result_type
        )));
    }
    Ok(PluginUnlinked {
        plugin_id: d.plugin_id,
        removed: d.removed,
    })
}

#[derive(Deserialize)]
struct PluginActionListD {
    #[serde(rename = "type")]
    result_type: String,
    actions: Vec<PluginActionInfo>,
}

fn parse_action_list(result: &Value) -> Result<Vec<PluginActionInfo>, ApiError> {
    let d: PluginActionListD = serde_json::from_value(result.clone())
        .map_err(|e| server_error(format!("respuesta plugin_action_list malformada: {e}")))?;
    if d.result_type != "plugin_action_list" {
        return Err(server_error(format!(
            "el server respondió {} en lugar de plugin_action_list",
            d.result_type
        )));
    }
    Ok(d.actions)
}

#[derive(Deserialize)]
struct PluginActionInvokedD {
    #[serde(rename = "type")]
    result_type: String,
    action: PluginActionInfo,
    #[serde(default)]
    context: Option<PluginInvocationContext>,
    log: PluginCommandLogInfo,
}

fn parse_action_invoked(result: &Value) -> Result<PluginActionInvoked, ApiError> {
    let d: PluginActionInvokedD = serde_json::from_value(result.clone())
        .map_err(|e| server_error(format!("respuesta plugin_action_invoked malformada: {e}")))?;
    if d.result_type != "plugin_action_invoked" {
        return Err(server_error(format!(
            "el server respondió {} en lugar de plugin_action_invoked",
            d.result_type
        )));
    }
    Ok(PluginActionInvoked {
        action: d.action,
        context: d.context,
        log: d.log,
    })
}

#[derive(Deserialize)]
struct PluginLogListD {
    #[serde(rename = "type")]
    result_type: String,
    logs: Vec<PluginCommandLogInfo>,
}

fn parse_log_list(result: &Value) -> Result<Vec<PluginCommandLogInfo>, ApiError> {
    let d: PluginLogListD = serde_json::from_value(result.clone())
        .map_err(|e| server_error(format!("respuesta plugin_log_list malformada: {e}")))?;
    if d.result_type != "plugin_log_list" {
        return Err(server_error(format!(
            "el server respondió {} en lugar de plugin_log_list",
            d.result_type
        )));
    }
    Ok(d.logs)
}

#[derive(Deserialize)]
struct PluginPaneOpenedD {
    #[serde(rename = "type")]
    result_type: String,
    plugin_pane: Value,
}

fn parse_plugin_pane(result: &Value, expected: &str) -> Result<Value, ApiError> {
    let d: PluginPaneOpenedD = serde_json::from_value(result.clone())
        .map_err(|e| server_error(format!("respuesta {expected} malformada: {e}")))?;
    if d.result_type != expected {
        return Err(server_error(format!(
            "el server respondió {} en lugar de {expected}",
            d.result_type
        )));
    }
    Ok(d.plugin_pane)
}

// ---------------------------------------------------------------------------
// Núcleo RPC
// ---------------------------------------------------------------------------

pub(crate) async fn plugin_list_rpc(
    client: &herdr_core::RpcClient,
    plugin_id: Option<&str>,
) -> Result<Vec<PluginInfo>, ApiError> {
    let mut params = json!({});
    if let Some(id) = plugin_id {
        params["plugin_id"] = json!(id);
    }
    let result = client
        .call("plugin.list", &params)
        .await
        .map_err(|e| e.api())?;
    parse_plugin_list(&result)
}

async fn plugin_set_enabled_rpc(
    client: &herdr_core::RpcClient,
    plugin_id: &str,
    enable: bool,
) -> Result<PluginInfo, ApiError> {
    if plugin_id.trim().is_empty() {
        return Err(invalid("«plugin_id» es obligatorio".to_string()));
    }
    let method = if enable {
        "plugin.enable"
    } else {
        "plugin.disable"
    };
    let expected = if enable {
        "plugin_enabled"
    } else {
        "plugin_disabled"
    };
    let result = client
        .call(method, &json!({ "plugin_id": plugin_id }))
        .await
        .map_err(|e| e.api())?;
    parse_plugin_wrapped(&result, expected)
}

fn validate_unlink(request: &PluginUnlinkRequest) -> Result<(), ApiError> {
    if request.plugin_id.trim().is_empty() {
        return Err(invalid("«plugin_id» es obligatorio".to_string()));
    }
    if request.confirm != Some(true) {
        return Err(invalid(
            "confirmación requerida: reenvía la petición con confirm=true".to_string(),
        ));
    }
    Ok(())
}

pub(crate) async fn plugin_unlink_rpc(
    client: &herdr_core::RpcClient,
    request: &PluginUnlinkRequest,
) -> Result<PluginUnlinked, ApiError> {
    validate_unlink(request)?;
    let result = client
        .call("plugin.unlink", &json!({ "plugin_id": request.plugin_id }))
        .await
        .map_err(|e| e.api())?;
    parse_plugin_unlinked(&result)
}

pub(crate) async fn plugin_link_rpc(
    client: &herdr_core::RpcClient,
    request: &PluginLinkRequest,
) -> Result<PluginInfo, ApiError> {
    if request.path.trim().is_empty() {
        return Err(invalid("«path» es obligatorio".to_string()));
    }
    let mut params = json!({ "path": request.path });
    if let Some(enabled) = request.enabled {
        params["enabled"] = json!(enabled);
    }
    let result = client
        .call("plugin.link", &params)
        .await
        .map_err(|e| e.api())?;
    parse_plugin_wrapped(&result, "plugin_linked")
}

pub(crate) async fn plugin_action_list_rpc(
    client: &herdr_core::RpcClient,
    plugin_id: Option<&str>,
) -> Result<Vec<PluginActionInfo>, ApiError> {
    let mut params = json!({});
    if let Some(id) = plugin_id {
        params["plugin_id"] = json!(id);
    }
    let result = client
        .call("plugin.action.list", &params)
        .await
        .map_err(|e| e.api())?;
    parse_action_list(&result)
}

pub(crate) async fn plugin_action_invoke_rpc(
    client: &herdr_core::RpcClient,
    request: &PluginActionInvokeRequest,
) -> Result<PluginActionInvoked, ApiError> {
    if request.action_id.trim().is_empty() {
        return Err(invalid("«action_id» es obligatorio".to_string()));
    }
    let mut params = json!({ "action_id": request.action_id });
    if let Some(id) = &request.plugin_id {
        params["plugin_id"] = json!(id);
    }
    if let Some(ctx) = &request.context {
        params["context"] = serde_json::to_value(ctx)
            .map_err(|e| invalid(format!("contexto no serializable: {e}")))?;
    }
    let result = client
        .call("plugin.action.invoke", &params)
        .await
        .map_err(|e| e.api())?;
    parse_action_invoked(&result)
}

pub(crate) async fn plugin_logs_rpc(
    client: &herdr_core::RpcClient,
    plugin_id: Option<&str>,
    limit: Option<u32>,
) -> Result<Vec<PluginCommandLogInfo>, ApiError> {
    let mut params = json!({});
    if let Some(id) = plugin_id {
        params["plugin_id"] = json!(id);
    }
    if let Some(limit) = limit {
        params["limit"] = json!(limit);
    }
    let result = client
        .call("plugin.log.list", &params)
        .await
        .map_err(|e| e.api())?;
    parse_log_list(&result)
}

pub(crate) async fn plugin_pane_open_rpc(
    client: &herdr_core::RpcClient,
    request: &PluginPaneOpenRequest,
) -> Result<Value, ApiError> {
    if request.plugin_id.trim().is_empty() {
        return Err(invalid("«plugin_id» es obligatorio".to_string()));
    }
    if request.entrypoint.trim().is_empty() {
        return Err(invalid("«entrypoint» es obligatorio".to_string()));
    }
    let mut params = json!({
        "plugin_id": request.plugin_id,
        "entrypoint": request.entrypoint,
        "focus": request.focus.unwrap_or(false),
    });
    for (key, value) in [
        ("workspace_id", &request.workspace_id),
        ("target_pane_id", &request.target_pane_id),
        ("cwd", &request.cwd),
        ("direction", &request.direction),
        ("placement", &request.placement),
    ] {
        if let Some(v) = value {
            params[key] = json!(v);
        }
    }
    if let Some(env) = &request.env {
        params["env"] = json!(env);
    }
    for (key, value) in [("width", &request.width), ("height", &request.height)] {
        if let Some(v) = value {
            params[key] = v.clone();
        }
    }
    let result = client
        .call("plugin.pane.open", &params)
        .await
        .map_err(|e| e.api())?;
    parse_plugin_pane(&result, "plugin_pane_opened")
}

async fn plugin_pane_focus_close_rpc(
    client: &herdr_core::RpcClient,
    pane_id: &str,
    method: &str,
    expected: &str,
) -> Result<Value, ApiError> {
    if pane_id.trim().is_empty() {
        return Err(invalid("«pane_id» es obligatorio".to_string()));
    }
    let result = client
        .call(method, &json!({ "pane_id": pane_id }))
        .await
        .map_err(|e| e.api())?;
    parse_plugin_pane(&result, expected)
}

// ---------------------------------------------------------------------------
// Vista previa + instalación via CLI (git + herdr plugin install)
// ---------------------------------------------------------------------------

/// owner/repo[/subdir] → (owner, repo, subdir). Rechaza metacaracteres, "..",
/// espacios y rutas absolutas: el spec viaja como argumento único al CLI.
pub fn parse_plugin_spec(spec: &str) -> Result<(String, String, Option<String>), ApiError> {
    let spec = spec.trim();
    let parts: Vec<&str> = spec.split('/').collect();
    if parts.len() < 2 || parts.iter().any(|p| p.is_empty()) {
        return Err(invalid(format!(
            "spec inválido «{spec}»: se espera owner/repo[/subdir]"
        )));
    }
    let owner = parts[0];
    let repo_raw = parts[1];
    let repo = repo_raw.strip_suffix(".git").unwrap_or(repo_raw);
    let subdir = if parts.len() > 2 {
        Some(parts[2..].join("/"))
    } else {
        None
    };
    for (label, component) in [("owner", owner), ("repo", repo)] {
        if !valid_git_component(component) {
            return Err(invalid(format!(
                "«{label}» inválido «{component}»: solo letras, números, ., _ y -"
            )));
        }
    }
    if let Some(sd) = &subdir
        && (!valid_git_component_path(sd) || sd.contains(".."))
    {
        return Err(invalid(format!("«subdir» inválido «{sd}»")));
    }
    Ok((owner.to_string(), repo.to_string(), subdir))
}

fn valid_git_component(s: &str) -> bool {
    !s.is_empty()
        && s != "."
        && s != ".."
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn valid_git_component_path(s: &str) -> bool {
    !s.is_empty() && s.split('/').all(valid_git_component)
}

pub fn validate_ref(git_ref: &str) -> Result<String, ApiError> {
    let git_ref = git_ref.trim();
    if git_ref.is_empty()
        || git_ref.starts_with('-')
        || git_ref.starts_with('/')
        || !valid_git_component_path(git_ref)
        || git_ref.contains("..")
    {
        return Err(invalid(format!("ref inválida «{git_ref}»")));
    }
    Ok(git_ref.to_string())
}

/// Token one-shot que liga la instalación con su vista previa.
fn preview_token(spec: &str, git_ref: Option<&str>, commit: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    spec.hash(&mut hasher);
    git_ref.unwrap_or("").hash(&mut hasher);
    commit.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

static PENDING_PREVIEWS: Mutex<Option<HashMap<String, PreviewRecord>>> = Mutex::new(None);

type PreviewRecord = (String, Option<String>);

fn remember_preview(token: String, spec: String, git_ref: Option<String>) {
    if let Ok(mut guard) = PENDING_PREVIEWS.lock() {
        guard
            .get_or_insert_with(HashMap::new)
            .insert(token, (spec, git_ref));
    }
}

fn take_preview(token: &str, spec: &str, git_ref: Option<&str>) -> bool {
    if let Ok(mut guard) = PENDING_PREVIEWS.lock()
        && let Some(map) = guard.as_mut()
        && let Some((seen_spec, seen_ref)) = map.remove(token)
    {
        return seen_spec == spec && seen_ref.as_deref() == git_ref;
    }
    false
}

const GIT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
const INSTALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);

/// Spawn directo (sin shell, CREATE_NO_WINDOW, HERDR_* limpias, timeout).
async fn run_captured(
    program: &str,
    args: &[&str],
    cwd: Option<&std::path::Path>,
    timeout: std::time::Duration,
) -> Result<(i32, String, String), ApiError> {
    use std::process::Stdio;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .creation_flags(CREATE_NO_WINDOW);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    for (key, _) in std::env::vars() {
        if key.starts_with("HERDR_") {
            cmd.env_remove(key);
        }
    }
    let mut child = cmd.spawn().map_err(|e| ApiError {
        code: "cli_failed".to_string(),
        message: format!("no se pudo ejecutar {program}: {e}"),
    })?;
    let mut stdout_pipe = child.stdout.take().ok_or_else(|| ApiError {
        code: "cli_failed".to_string(),
        message: "sin stdout".to_string(),
    })?;
    let mut stderr_pipe = child.stderr.take().ok_or_else(|| ApiError {
        code: "cli_failed".to_string(),
        message: "sin stderr".to_string(),
    })?;
    let read_out = tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut buf = String::new();
        let _ = stdout_pipe.read_to_string(&mut buf).await;
        buf
    });
    let read_err = tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut buf = String::new();
        let _ = stderr_pipe.read_to_string(&mut buf).await;
        buf
    });
    let status = tokio::time::timeout(timeout, child.wait())
        .await
        .map_err(|_| ApiError {
            code: "timeout".to_string(),
            message: format!("{program} excedió el timeout"),
        })?
        .map_err(|e| ApiError {
            code: "cli_failed".to_string(),
            message: format!("error esperando {program}: {e}"),
        })?;
    let stdout = read_out.await.unwrap_or_default();
    let stderr = read_err.await.unwrap_or_default();
    Ok((status.code().unwrap_or(-1), stdout, stderr))
}

fn manifest_candidates(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    [root.join("herdr-plugin.toml"), root.join("manifest.toml")]
        .into_iter()
        .filter(|p| p.is_file())
        .collect()
}

fn parse_manifest_text(text: &str) -> Result<PluginManifestPreview, ApiError> {
    let doc = text.parse::<toml_edit::DocumentMut>().map_err(|e| {
        invalid(format!(
            "manifiesto del plugin no es TOML válido: {}",
            e.message()
        ))
    })?;
    let get_str = |key: &str| {
        doc.as_table()
            .get(key)
            .and_then(|item| item.as_str())
            .map(|s| s.to_string())
    };
    let id = get_str("id").ok_or_else(|| invalid("manifiesto sin «id»".to_string()))?;
    let name = get_str("name").ok_or_else(|| invalid("manifiesto sin «name»".to_string()))?;
    let version =
        get_str("version").ok_or_else(|| invalid("manifiesto sin «version»".to_string()))?;
    let min = get_str("min_herdr_version")
        .ok_or_else(|| invalid("manifiesto sin «min_herdr_version»".to_string()))?;
    Ok(PluginManifestPreview {
        id,
        name,
        version,
        min_herdr_version: min,
        description: get_str("description"),
    })
}

/// Vista previa de instalación: valida spec/ref, clona shallow el repo y lee
/// el manifiesto ANTES de instalar nada. Devuelve un token que plugin_install
/// exige (prueba de que la UI mostró la vista previa).
pub(crate) async fn plugin_install_preview_rpc(
    spec: &str,
    git_ref: Option<&str>,
) -> Result<PluginInstallPreview, ApiError> {
    let (owner, repo, subdir) = parse_plugin_spec(spec)?;
    let git_ref = git_ref.map(validate_ref).transpose()?;
    let url = format!("https://github.com/{owner}/{repo}.git");

    let tmp = std::env::temp_dir().join(format!(
        "herdr-desk-plugin-preview-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let _ = std::fs::remove_dir_all(&tmp);

    let mut clone_args: Vec<String> = vec!["clone".into(), "--depth".into(), "1".into()];
    if let Some(r) = &git_ref {
        clone_args.push("--branch".into());
        clone_args.push(r.clone());
    }
    clone_args.push(url.clone());
    clone_args.push(tmp.to_string_lossy().to_string());
    let args_ref: Vec<&str> = clone_args.iter().map(|s| s.as_str()).collect();

    let (code, _out, stderr) = run_captured("git", &args_ref, None, GIT_TIMEOUT).await?;
    if code != 0 {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(ApiError {
            code: "plugin_preview_failed".to_string(),
            message: format!(
                "no se pudo clonar {url} (ref {}): {}",
                git_ref.as_deref().unwrap_or("default"),
                stderr.trim()
            ),
        });
    }

    // commit resuelto del clone
    let (_, commit_out, _) = run_captured("git", &["rev-parse", "HEAD"], Some(&tmp), GIT_TIMEOUT)
        .await
        .unwrap_or((1, String::new(), String::new()));
    let commit = commit_out.trim().to_string();

    let manifest_path = manifest_candidates(&tmp)
        .into_iter()
        .next()
        .ok_or_else(|| {
            let _ = std::fs::remove_dir_all(&tmp);
            invalid(format!(
                "el repo {owner}/{repo} no trae herdr-plugin.toml ni manifest.toml{}",
                subdir
                    .as_deref()
                    .map(|s| format!(" en {s}"))
                    .unwrap_or_default()
            ))
        })?;
    let manifest_raw = std::fs::read_to_string(&manifest_path).map_err(|e| {
        let _ = std::fs::remove_dir_all(&tmp);
        invalid(format!("no se pudo leer {}: {e}", manifest_path.display()))
    })?;
    let manifest = match parse_manifest_text(&manifest_raw) {
        Ok(m) => m,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&tmp);
            return Err(e);
        }
    };
    let _ = std::fs::remove_dir_all(&tmp);

    let token = preview_token(spec, git_ref.as_deref(), &commit);
    remember_preview(token.clone(), spec.to_string(), git_ref.clone());

    Ok(PluginInstallPreview {
        spec: spec.to_string(),
        owner,
        repo,
        subdir,
        requested_ref: git_ref,
        resolved_commit: if commit.is_empty() {
            None
        } else {
            Some(commit)
        },
        manifest,
        manifest_raw,
        preview_token: token,
    })
}

/// Instala SOLO con confirm=true y el token de una vista previa previa que
/// coincida con spec+ref. Ejecuta `herdr plugin install <spec> --ref X -y`.
pub(crate) async fn plugin_install_rpc(
    spec: &str,
    git_ref: Option<&str>,
    preview_token: Option<&str>,
    confirm: Option<bool>,
) -> Result<PluginInstallOutcome, ApiError> {
    parse_plugin_spec(spec)?;
    let git_ref = git_ref.map(validate_ref).transpose()?;
    if confirm != Some(true) {
        return Err(invalid(
            "confirmación requerida: la instalación desde GitHub necesita confirm=true".to_string(),
        ));
    }
    let token = preview_token.ok_or_else(|| {
        invalid(
            "falta la vista previa: llama a plugin_install_preview antes de instalar".to_string(),
        )
    })?;
    if !take_preview(token, spec, git_ref.as_deref()) {
        return Err(invalid(
            "la vista previa no coincide (spec/ref distintos) o ya se usó".to_string(),
        ));
    }

    let mut args: Vec<String> = vec!["plugin".into(), "install".into(), spec.to_string()];
    if let Some(r) = &git_ref {
        args.push("--ref".into());
        args.push(r.clone());
    }
    args.push("-y".into());
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let (code, stdout, stderr) = run_captured("herdr", &args_ref, None, INSTALL_TIMEOUT).await?;
    if code != 0 {
        return Err(ApiError {
            code: "cli_failed".to_string(),
            message: format!(
                "herdr plugin install salió con código {}: {}",
                code,
                if stderr.trim().is_empty() {
                    stdout.trim()
                } else {
                    stderr.trim()
                }
            ),
        });
    }
    Ok(PluginInstallOutcome {
        spec: spec.to_string(),
        requested_ref: git_ref,
        exit_code: code,
        output: if stdout.trim().is_empty() {
            stderr
        } else {
            stdout
        },
    })
}

// ---------------------------------------------------------------------------
// Comandos Tauri
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn plugin_list(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    plugin_id: Option<String>,
) -> Result<Vec<PluginInfo>, ApiError> {
    let client = state.current().client.clone();
    plugin_list_rpc(&client, plugin_id.as_deref()).await
}

#[tauri::command]
pub async fn plugin_enable(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    plugin_id: String,
) -> Result<PluginInfo, ApiError> {
    let client = state.current().client.clone();
    plugin_set_enabled_rpc(&client, &plugin_id, true).await
}

#[tauri::command]
pub async fn plugin_disable(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    plugin_id: String,
) -> Result<PluginInfo, ApiError> {
    let client = state.current().client.clone();
    plugin_set_enabled_rpc(&client, &plugin_id, false).await
}

#[tauri::command]
pub async fn plugin_unlink(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    request: PluginUnlinkRequest,
) -> Result<PluginUnlinked, ApiError> {
    let client = state.current().client.clone();
    plugin_unlink_rpc(&client, &request).await
}

/// Vincula un plugin local; la UI resuelve la carpeta (selector) y pasa la ruta.
#[tauri::command]
pub async fn plugin_link(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    request: PluginLinkRequest,
) -> Result<PluginInfo, ApiError> {
    let client = state.current().client.clone();
    plugin_link_rpc(&client, &request).await
}

#[tauri::command]
pub async fn plugin_action_list(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    plugin_id: Option<String>,
) -> Result<Vec<PluginActionInfo>, ApiError> {
    let client = state.current().client.clone();
    plugin_action_list_rpc(&client, plugin_id.as_deref()).await
}

#[tauri::command]
pub async fn plugin_action_invoke(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    request: PluginActionInvokeRequest,
) -> Result<PluginActionInvoked, ApiError> {
    let client = state.current().client.clone();
    plugin_action_invoke_rpc(&client, &request).await
}

#[tauri::command]
pub async fn plugin_logs(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    plugin_id: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<PluginCommandLogInfo>, ApiError> {
    let client = state.current().client.clone();
    plugin_logs_rpc(&client, plugin_id.as_deref(), limit).await
}

#[tauri::command]
pub async fn plugin_pane_open(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    request: PluginPaneOpenRequest,
) -> Result<Value, ApiError> {
    let client = state.current().client.clone();
    plugin_pane_open_rpc(&client, &request).await
}

#[tauri::command]
pub async fn plugin_pane_focus(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    pane_id: String,
) -> Result<Value, ApiError> {
    let client = state.current().client.clone();
    plugin_pane_focus_close_rpc(
        &client,
        &pane_id,
        "plugin.pane.focus",
        "plugin_pane_focused",
    )
    .await
}

#[tauri::command]
pub async fn plugin_pane_close(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    pane_id: String,
) -> Result<Value, ApiError> {
    let client = state.current().client.clone();
    plugin_pane_focus_close_rpc(&client, &pane_id, "plugin.pane.close", "plugin_pane_closed").await
}

/// Vista previa de instalación desde GitHub (repo, ref y manifiesto leídos).
#[tauri::command]
pub async fn plugin_install_preview(
    spec: String,
    git_ref: Option<String>,
) -> Result<PluginInstallPreview, ApiError> {
    plugin_install_preview_rpc(&spec, git_ref.as_deref()).await
}

/// Instalación desde GitHub: exige confirm=true + preview_token de la vista
/// previa; ejecuta `herdr plugin install <spec> --ref X -y` (argv directo).
#[tauri::command]
pub async fn plugin_install(
    spec: String,
    git_ref: Option<String>,
    preview_token: Option<String>,
    confirm: Option<bool>,
) -> Result<PluginInstallOutcome, ApiError> {
    plugin_install_rpc(&spec, git_ref.as_deref(), preview_token.as_deref(), confirm).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Value {
        let raw = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join(format!("../schema/fixtures/{name}")),
        )
        .expect("fixture de plugin");
        serde_json::from_str(&raw).expect("JSON de la fixture")
    }

    #[test]
    fn parsea_fixture_real_de_plugin_link() {
        let v = fixture("plugin_link.json");
        let plugin = parse_plugin_wrapped(&v["result"], "plugin_linked").expect("parseo");
        assert_eq!(plugin.plugin_id, "hd-probe");
        assert_eq!(plugin.name, "hd-probe");
        assert_eq!(plugin.version, "0.1.0");
        assert_eq!(plugin.min_herdr_version, "0.8.0");
        assert!(plugin.enabled);
        assert_eq!(plugin.source.unwrap().kind, "local");
        assert!(plugin.warnings[0].contains("platforms"));
    }

    #[test]
    fn parsea_fixture_de_plugin_list() {
        let v = fixture("plugin_list.json");
        let plugins = parse_plugin_list(&v).expect("parseo");
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].plugin_id, "hd-probe");
        assert!(plugins[0].panes.is_empty());
        assert!(plugins[0].events.is_empty());
        assert!(plugins[0].actions.is_empty());
    }

    #[test]
    fn tipo_inesperado_da_error_de_server() {
        let err = parse_plugin_list(&json!({"type": "plugin_enabled", "plugins": []}))
            .expect_err("debe fallar");
        assert_eq!(err.code, "server");
    }

    #[test]
    fn unlink_sin_confirmacion_se_rechaza() {
        let req = PluginUnlinkRequest {
            plugin_id: "hd".to_string(),
            confirm: None,
        };
        let err = validate_unlink(&req).expect_err("sin confirm");
        assert_eq!(err.code, "invalid_params");
        assert!(err.message.contains("confirm=true"));
        let ok = PluginUnlinkRequest {
            plugin_id: "hd".to_string(),
            confirm: Some(true),
        };
        assert!(validate_unlink(&ok).is_ok());
    }

    #[test]
    fn specs_github_validos_e_invalidos() {
        let (owner, repo, subdir) = parse_plugin_spec("owner/repo").expect("owner/repo");
        assert_eq!(
            (owner.as_str(), repo.as_str(), subdir.as_deref()),
            ("owner", "repo", None)
        );
        let (owner, repo, subdir) = parse_plugin_spec("owner/repo/sub/dir").expect("con subdir");
        assert_eq!(owner, "owner");
        assert_eq!(repo, "repo");
        assert_eq!(subdir.as_deref(), Some("sub/dir"));
        let (_, repo, _) = parse_plugin_spec("owner/repo.git").expect("sin .git");
        assert_eq!(repo, "repo");

        for bad in [
            "",
            "solo-owner",
            "/repo",
            "owner/",
            "../repo",
            "ow n/repo",
            "owner/re po/x",
            "owner/repo/..",
        ] {
            let err = parse_plugin_spec(bad).expect_err("debe rechazar");
            assert_eq!(err.code, "invalid_params", "spec: {bad}");
        }
    }

    #[test]
    fn refs_validas_e_invalidas() {
        assert_eq!(validate_ref("main").unwrap(), "main");
        assert_eq!(validate_ref("v1.2.3").unwrap(), "v1.2.3");
        assert_eq!(validate_ref("release/1.0").unwrap(), "release/1.0");
        for bad in ["", " -branch", "a..b", "x y", "/abs"] {
            assert!(validate_ref(bad).is_err(), "ref: {bad}");
        }
    }

    #[test]
    fn manifiesto_minimo_se_parsea_y_exige_campos() {
        let ok = "id = \"p\"\nname = \"P\"\nversion = \"1.0\"\nmin_herdr_version = \"0.8\"\ndescription = \"d\"\n";
        let m = parse_manifest_text(ok).expect("manifiesto");
        assert_eq!(m.id, "p");
        assert_eq!(m.min_herdr_version, "0.8");
        assert_eq!(m.description.as_deref(), Some("d"));

        for bad in [
            "name = \"P\"\nversion = \"1\"\nmin_herdr_version = \"0.8\"\n", // sin id
            "id = \"p\"\nversion = \"1\"\nmin_herdr_version = \"0.8\"\n",   // sin name
            "id = \"p\"\nname = \"P\"\nversion = \"1\"\n",                  // sin min
            "no es toml {{{\n",
        ] {
            assert!(
                parse_manifest_text(bad).is_err(),
                "manifiesto inválido aceptado: {bad}"
            );
        }
    }

    #[test]
    fn token_de_vista_previa_liga_spec_y_ref() {
        let t1 = preview_token("owner/repo", Some("main"), "abc");
        let t2 = preview_token("owner/repo", Some("main"), "abc");
        let t3 = preview_token("owner/repo", Some("dev"), "abc");
        let t4 = preview_token("owner/otro", Some("main"), "abc");
        assert_eq!(t1, t2);
        assert_ne!(t1, t3);
        assert_ne!(t1, t4);
    }

    #[test]
    fn memoria_de_vistas_previas_es_one_shot() {
        let token = preview_token("owner/repo-mem", None, "abc");
        remember_preview(token.clone(), "owner/repo-mem".into(), None);
        assert!(take_preview(&token, "owner/repo-mem", None));
        assert!(!take_preview(&token, "owner/repo-mem", None), "one-shot");
    }

    #[test]
    fn install_sin_confirm_o_sin_preview_se_rechaza() {
        // los guards corren antes de tocar la CLI; el server de la sandbox no
        // es necesario para estas dos negaciones
        let rt = tokio::runtime::Runtime::new().unwrap();
        let err = rt
            .block_on(plugin_install_rpc("owner/repo", None, Some("tok"), None))
            .expect_err("sin confirm");
        assert_eq!(err.code, "invalid_params");

        remember_preview(
            preview_token("owner/repo-otro", None, "abc"),
            "owner/repo-otro".into(),
            None,
        );
        let err = rt
            .block_on(plugin_install_rpc(
                "owner/repo-otro",
                None,
                Some("tok-que-no-existe"),
                Some(true),
            ))
            .expect_err("sin preview valido");
        assert!(err.message.contains("vista previa"), "{}", err.message);
    }
}
