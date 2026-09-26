use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;

use herdr_core::error::ApiError;

// ---------------------------------------------------------------------------
// Catalogo de la consola API (T4.5): lee schema/herdr-api.schema.json (el
// contrato real, protocolo 19) y lo normaliza para que la UI genere formularios
// y visores sin conocer JSON Schema. Se cachea en memoria: el archivo solo se
// parsea la primera vez (o con refresh=true).
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ApiParamSpec {
    pub name: String,
    /// string | bool | int | float | enum | array | object | map | unknown
    pub kind: String,
    pub required: bool,
    pub nullable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enum_values: Option<Vec<String>>,
    /// Tipo del elemento para array/map (name = "$item").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item: Option<Box<ApiParamSpec>>,
    /// Hijos para object.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<Vec<ApiParamSpec>>,
    /// Nombre del $ref original (p.ej. PluginInvocationContext) para badges.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_name: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ApiMethodSpec {
    pub method: String,
    /// Grupo = segmento antes del primer punto ("plugin", "worktree", ...;
    /// metodos raiz como ping → "core").
    pub group: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub params: Vec<ApiParamSpec>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ApiCatalog {
    pub protocol: u32,
    pub schema_version: u32,
    pub total: usize,
    pub methods: Vec<ApiMethodSpec>,
}

const MAX_REF_DEPTH: usize = 6;

/// Rutas candidatas del schema: env explícita, path de compilación (dev) y
/// ancestros del ejecutable (instalado junto al binario).
fn schema_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(p) = std::env::var("HERDR_DESK_SCHEMA_PATH")
        && !p.trim().is_empty()
    {
        candidates.push(PathBuf::from(p));
    }
    candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("../schema/herdr-api.schema.json"));
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        let mut here = dir.to_path_buf();
        for _ in 0..4 {
            candidates.push(here.join("schema/herdr-api.schema.json"));
            if !here.pop() {
                break;
            }
        }
    }
    candidates
}

fn find_schema_file() -> Result<PathBuf, ApiError> {
    for candidate in schema_candidates() {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(ApiError {
        code: "schema_not_found".to_string(),
        message: format!(
            "no se encontró herdr-api.schema.json; probé: {}",
            schema_candidates()
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join("; ")
        ),
    })
}

/// Descripciones de primer mano (contratos implementados en herdr-desk).
/// Lo que no está acá no se inventa: description = None y la UI muestra el nombre.
fn method_description(method: &str) -> Option<&'static str> {
    Some(match method {
        "ping" => "latido: versión, protocolo y capacidades del server",
        "server.stop" => "detiene el server via socket",
        "server.reload_config" => {
            "recarga config.toml en el server activo (applied/partial/failed)"
        }
        "server.agent_manifests" => "estado de los manifiestos de integración de agentes",
        "server.reload_agent_manifests" => "relee los manifiestos de agentes desde disco",
        "notification.show" => "muestra un aviso en los clientes herdr conectados",
        "session.snapshot" => "snapshot completo de la sesión (workspaces, tabs, panes)",
        "workspace.create" => "crea un workspace con cwd, label y focus opcionales",
        "workspace.close" => "cierra un workspace por id",
        "worktree.list" => {
            "lista los worktrees del repo del workspace (branch, flags y workspace abierto)"
        }
        "worktree.create" => "crea y abre un worktree (rama, base, ruta, label, focus)",
        "worktree.open" => "abre un worktree existente por branch o path",
        "worktree.remove" => "elimina un checkout de worktree (force opcional)",
        "plugin.list" => {
            "plugins instalados con versión, estado, warnings, acciones, panes y eventos"
        }
        "plugin.enable" => "habilita un plugin",
        "plugin.disable" => "deshabilita un plugin",
        "plugin.link" => "vincula un plugin local por ruta",
        "plugin.unlink" => "desvincula un plugin local",
        "plugin.action.list" => "acciones de plugins con contextos soportados",
        "plugin.action.invoke" => "invoca una acción con contexto de workspace/tab/pane",
        "plugin.log.list" => "logs de comandos de plugins (estado, salida, códigos)",
        "plugin.pane.open" => "abre un pane de plugin (overlay/popup/split/tab/zoomed)",
        "plugin.pane.focus" => "enfoca un pane de plugin",
        "plugin.pane.close" => "cierra un pane de plugin",
        "integration.install" => "instala la integración de un agente (target del enum)",
        "integration.uninstall" => "desinstala la integración de un agente",
        "events.subscribe" => "abre la conexión S de eventos para un conjunto de panes",
        _ => return None,
    })
}

fn group_of(method: &str) -> String {
    match method.split_once('.') {
        Some((group, _)) => group.to_string(),
        None => "core".to_string(),
    }
}

fn type_of(schema: &Value) -> Option<String> {
    match schema.get("type") {
        Some(Value::String(t)) => Some(t.clone()),
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|v| v.as_str())
            .find(|t| *t != "null")
            .map(|t| t.to_string()),
        _ => None,
    }
}

fn is_nullable(schema: &Value) -> bool {
    match schema.get("type") {
        Some(Value::Array(items)) => items.iter().any(|v| v.as_str() == Some("null")),
        _ => schema.get("anyOf").is_some_and(|any| {
            any.as_array().is_some_and(|branches| {
                branches.iter().any(|b| {
                    b.as_str() == Some("null")
                        || b.get("type").and_then(Value::as_str) == Some("null")
                })
            })
        }),
    }
}

fn kind_of(type_name: &str, schema: &Value) -> String {
    if schema.get("enum").is_some() {
        return "enum".to_string();
    }
    match type_name {
        "string" => "string".to_string(),
        "boolean" => "bool".to_string(),
        "integer" | "number" => {
            if type_name == "number" {
                "float".to_string()
            } else {
                "int".to_string()
            }
        }
        "array" => "array".to_string(),
        "object" => {
            if schema.get("properties").is_some() {
                "object".to_string()
            } else if schema
                .get("additionalProperties")
                .is_some_and(|a| a.is_object())
            {
                "map".to_string()
            } else {
                "object".to_string()
            }
        }
        _ => "unknown".to_string(),
    }
}

/// Normaliza un esquema JSON a ApiParamSpec resolviendo $ref (con límite de
/// profundidad), anyOf (primera rama no null) y uniones con null.
fn normalize_param(
    name: &str,
    schema: &Value,
    defs: &serde_json::Map<String, Value>,
    depth: usize,
) -> ApiParamSpec {
    if depth > MAX_REF_DEPTH {
        return ApiParamSpec {
            name: name.to_string(),
            kind: "unknown".to_string(),
            required: false,
            nullable: false,
            default: None,
            enum_values: None,
            item: None,
            properties: None,
            ref_name: None,
        };
    }

    // $ref: resolver y continuar (conservando el nombre original)
    if let Some(target) = schema.get("$ref").and_then(Value::as_str)
        && let Some(def_name) = target.rsplit('/').next()
        && let Some(def) = defs.get(def_name)
    {
        let mut spec = normalize_param(name, def, defs, depth + 1);
        spec.ref_name = Some(def_name.to_string());
        return spec;
    }

    // anyOf: primera rama no null; null solo marca nullable
    if let Some(branches) = schema.get("anyOf").and_then(Value::as_array)
        && let Some(branch) = branches.iter().find(|b| b.as_str() != Some("null"))
    {
        let mut spec = normalize_param(name, branch, defs, depth + 1);
        spec.nullable = is_nullable(schema);
        return spec;
    }

    let type_name = type_of(schema).unwrap_or_else(|| "unknown".to_string());
    let kind = kind_of(&type_name, schema);

    let mut spec = ApiParamSpec {
        name: name.to_string(),
        kind,
        required: false,
        nullable: is_nullable(schema),
        default: schema.get("default").cloned().filter(|v| !v.is_null()),
        enum_values: schema.get("enum").and_then(Value::as_array).map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        }),
        item: None,
        properties: None,
        ref_name: None,
    };

    match spec.kind.as_str() {
        "array" => {
            spec.item = schema
                .get("items")
                .map(|items| Box::new(normalize_param("$item", items, defs, depth + 1)));
        }
        "map" => {
            if let Some(additional) = schema.get("additionalProperties").filter(|a| a.is_object()) {
                spec.item = Some(Box::new(normalize_param(
                    "$item",
                    additional,
                    defs,
                    depth + 1,
                )));
            }
        }
        "object" => {
            if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
                let required_list: Vec<&str> = schema
                    .get("required")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(Value::as_str).collect())
                    .unwrap_or_default();
                spec.properties = Some(
                    properties
                        .iter()
                        .map(|(child_name, child)| {
                            let mut child_spec =
                                normalize_param(child_name, child, defs, depth + 1);
                            child_spec.required = required_list.contains(&child_name.as_str());
                            child_spec
                        })
                        .collect(),
                );
            }
        }
        _ => {}
    }
    spec
}

fn normalize_params(
    params_schema: &Value,
    defs: &serde_json::Map<String, Value>,
) -> Vec<ApiParamSpec> {
    let mut out = Vec::new();
    if let Some(properties) = params_schema.get("properties").and_then(Value::as_object) {
        let required_list: Vec<&str> = params_schema
            .get("required")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        for (name, schema) in properties {
            let mut spec = normalize_param(name, schema, defs, 0);
            spec.required = required_list.contains(&name.as_str());
            out.push(spec);
        }
    }
    out
}

/// Construye el catálogo desde un archivo de schema concreto.
pub fn build_catalog_from_path(path: &Path) -> Result<ApiCatalog, ApiError> {
    let raw = std::fs::read_to_string(path).map_err(|e| ApiError {
        code: "schema_not_found".to_string(),
        message: format!("no se pudo leer {}: {e}", path.display()),
    })?;
    let schema: Value = serde_json::from_str(&raw).map_err(|e| ApiError {
        code: "parse".to_string(),
        message: format!("el schema no es JSON válido: {e}"),
    })?;
    let protocol = schema.get("protocol").and_then(Value::as_u64).unwrap_or(0) as u32;
    let schema_version = schema
        .get("schema_version")
        .and_then(Value::as_u64)
        .unwrap_or(0) as u32;
    let defs = schema
        .get("schemas")
        .and_then(|s| s.get("request"))
        .and_then(|r| r.get("$defs"))
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let one_of = schema
        .get("schemas")
        .and_then(|s| s.get("request"))
        .and_then(|r| r.get("oneOf"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut methods = Vec::with_capacity(one_of.len());
    for entry in &one_of {
        let method = entry
            .get("properties")
            .and_then(|p| p.get("method"))
            .and_then(|m| m.get("const"))
            .and_then(Value::as_str);
        let Some(method) = method else { continue };
        let params_schema = entry
            .get("properties")
            .and_then(|p| p.get("params"))
            .cloned()
            .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
        let params = match params_schema.get("$ref").and_then(Value::as_str) {
            Some(target) => {
                let def_name = target.rsplit('/').next().unwrap_or("");
                match defs.get(def_name) {
                    Some(def) => normalize_params(def, &defs),
                    None => Vec::new(),
                }
            }
            None => normalize_params(&params_schema, &defs),
        };
        methods.push(ApiMethodSpec {
            method: method.to_string(),
            group: group_of(method),
            description: method_description(method).map(String::from),
            params,
        });
    }
    methods.sort_by(|a, b| a.method.cmp(&b.method));
    Ok(ApiCatalog {
        protocol,
        schema_version,
        total: methods.len(),
        methods,
    })
}

static CATALOG_CACHE: Mutex<Option<Arc<ApiCatalog>>> = Mutex::new(None);

/// Catálogo cacheado: el schema solo se parsea una vez por proceso.
pub async fn build_catalog_cached(refresh: bool) -> Result<Arc<ApiCatalog>, ApiError> {
    if !refresh
        && let Ok(guard) = CATALOG_CACHE.lock()
        && let Some(catalog) = guard.as_ref()
    {
        return Ok(catalog.clone());
    }
    let path = find_schema_file()?;
    let catalog = build_catalog_from_path(&path)?;
    let catalog = Arc::new(catalog);
    if let Ok(mut guard) = CATALOG_CACHE.lock() {
        *guard = Some(catalog.clone());
    }
    Ok(catalog)
}

/// Catálogo de métodos del server para generar formularios en la UI.
#[tauri::command]
pub async fn api_catalog(refresh: Option<bool>) -> Result<Arc<ApiCatalog>, ApiError> {
    build_catalog_cached(refresh.unwrap_or(false)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn real_catalog() -> ApiCatalog {
        build_catalog_from_path(&find_schema_file().expect("schema real"))
            .expect("catálogo del schema real")
    }

    fn method<'a>(catalog: &'a ApiCatalog, name: &str) -> &'a ApiMethodSpec {
        catalog
            .methods
            .iter()
            .find(|m| m.method == name)
            .unwrap_or_else(|| panic!("método {name} en el catálogo"))
    }

    fn param<'a>(method: &'a ApiMethodSpec, name: &str) -> &'a ApiParamSpec {
        method
            .params
            .iter()
            .find(|p| p.name == name)
            .unwrap_or_else(|| panic!("param {name} en {}", method.method))
    }

    #[test]
    fn catalogo_del_schema_real_con_protocolo_y_total() {
        let raw: Value =
            serde_json::from_str(&std::fs::read_to_string(find_schema_file().unwrap()).unwrap())
                .unwrap();
        let expected_total = raw["schemas"]["request"]["oneOf"].as_array().unwrap().len();

        let catalog = real_catalog();
        assert_eq!(catalog.protocol, 19);
        assert_eq!(catalog.total, expected_total);
        assert_eq!(catalog.methods.len(), catalog.total);
        // ordenado por nombre, sin duplicados
        for pair in catalog.methods.windows(2) {
            assert!(pair[0].method < pair[1].method);
        }
    }

    #[test]
    fn notification_show_parametros_normalizados() {
        let catalog = real_catalog();
        let m = method(&catalog, "notification.show");
        assert_eq!(m.group, "notification");
        let title = param(m, "title");
        assert_eq!(title.kind, "string");
        assert!(title.required);
        assert!(!title.nullable);

        let body = param(m, "body");
        assert_eq!(body.kind, "string");
        assert!(!body.required);
        assert!(body.nullable);

        let sound = param(m, "sound");
        assert_eq!(sound.kind, "enum");
        assert_eq!(
            sound.enum_values.as_deref(),
            Some(
                &[
                    "none".to_string(),
                    "done".to_string(),
                    "request".to_string()
                ][..]
            )
        );
        // en el schema solo title es required; el server deduce el resto
        assert!(!sound.required);

        let position = param(m, "position");
        assert_eq!(position.kind, "enum");
        assert!(position.nullable);
        assert!(
            position
                .enum_values
                .as_ref()
                .unwrap()
                .contains(&"bottom-right".to_string())
        );
    }

    #[test]
    fn worktree_remove_create_con_required_y_defaults() {
        let catalog = real_catalog();
        let remove = method(&catalog, "worktree.remove");
        let workspace_id = param(remove, "workspace_id");
        assert_eq!(workspace_id.kind, "string");
        assert!(workspace_id.required);
        let force = param(remove, "force");
        assert_eq!(force.kind, "bool");
        assert!(!force.required);
        assert_eq!(force.default, Some(json!(false)));

        let create = method(&catalog, "worktree.create");
        assert_eq!(create.params.len(), 7);
        assert!(create.params.iter().all(|p| !p.required));
        assert_eq!(param(create, "focus").default, Some(json!(false)));
    }

    #[test]
    fn ping_sin_params_y_refs_resueltos() {
        let catalog = real_catalog();
        assert!(method(&catalog, "ping").params.is_empty());

        let invoke = method(&catalog, "plugin.action.invoke");
        let context = param(invoke, "context");
        assert_eq!(context.ref_name.as_deref(), Some("PluginInvocationContext"));
        assert_eq!(context.kind, "object");
        let properties = context.properties.as_ref().unwrap();
        let tab_id = properties.iter().find(|p| p.name == "tab_id").unwrap();
        assert_eq!(tab_id.kind, "string");
        assert!(tab_id.nullable);
        let status = properties
            .iter()
            .find(|p| p.name == "focused_pane_status")
            .unwrap();
        assert_eq!(status.kind, "enum");
        assert!(
            status
                .enum_values
                .as_ref()
                .unwrap()
                .contains(&"blocked".to_string())
        );
    }

    #[test]
    fn pane_open_con_map_enum_y_popup_size() {
        let catalog = real_catalog();
        let open = method(&catalog, "plugin.pane.open");
        assert!(param(open, "plugin_id").required);
        assert!(param(open, "entrypoint").required);
        let placement = param(open, "placement");
        assert_eq!(placement.kind, "enum");
        assert!(placement.nullable);
        assert!(
            placement
                .enum_values
                .as_ref()
                .unwrap()
                .contains(&"overlay".to_string())
        );
        let width = param(open, "width");
        // PopupSize: anyOf int | string ("80%")
        assert_eq!(width.ref_name.as_deref(), Some("PopupSize"));
        let env = param(open, "env");
        assert_eq!(env.kind, "map");
        assert_eq!(env.item.as_ref().unwrap().kind, "string");
        let direction = param(open, "direction");
        assert_eq!(
            direction.enum_values.as_deref(),
            Some(&["right".to_string(), "down".to_string()][..])
        );
    }

    #[test]
    fn grupos_cubiertos_y_descripciones_curadas() {
        let catalog = real_catalog();
        for group in [
            "server",
            "workspace",
            "worktree",
            "tab",
            "agent",
            "pane",
            "layout",
            "plugin",
            "integration",
            "notification",
            "session",
            "events",
            "client",
            "popup",
        ] {
            assert!(
                catalog.methods.iter().any(|m| m.group == group),
                "grupo {group} sin métodos"
            );
        }
        assert!(
            method(&catalog, "server.reload_config")
                .description
                .is_some()
        );
        assert!(method(&catalog, "worktree.list").description.is_some());
    }

    #[test]
    fn cache_devuelve_el_mismo_arc() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let a = rt.block_on(build_catalog_cached(false)).unwrap();
        let b = rt.block_on(build_catalog_cached(false)).unwrap();
        assert!(Arc::ptr_eq(&a, &b), "segunda llamada debe venir de cache");
    }

    #[test]
    fn schema_inexistente_da_error_tipado() {
        let err = build_catalog_from_path(Path::new("Z:/no/existe.schema.json"))
            .expect_err("debe fallar");
        assert_eq!(err.code, "schema_not_found");
    }
}
