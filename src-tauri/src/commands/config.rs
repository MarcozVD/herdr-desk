use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use toml_edit::{DocumentMut, Item, Table};

use herdr_core::error::ApiError;

use super::cli_run::run_whitelisted_with_env;

/// Path del config de herdr (respeta HERDR_CONFIG_PATH si el usuario lo define).
fn config_path() -> PathBuf {
    if let Ok(p) = std::env::var("HERDR_CONFIG_PATH")
        && !p.is_empty()
    {
        return PathBuf::from(p);
    }
    herdr_core::config::herdr_config_toml()
}

// ---------------------------------------------------------------------------
// Diagnósticos de `herdr config check`
// ---------------------------------------------------------------------------

/// Diagnóstico de la comprobación de config, traducido para la UI.
/// `severity`: "error" (bloquea la escritura) | "warning" (el server ignora la clave).
#[derive(Serialize, Clone, Debug)]
pub struct ConfigDiagnostic {
    pub severity: String,
    pub code: String, // parse_error | unknown_key | unknown_section | cli_failed
    pub message: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct ConfigCheckResult {
    pub exit_code: i32,
    pub diagnostics: Vec<ConfigDiagnostic>,
}

impl ConfigCheckResult {
    pub fn has_blocking_error(&self) -> bool {
        self.diagnostics.iter().any(|d| d.severity == "error")
    }
}

/// Parsea la salida en texto de `herdr config check` (la CLI no tiene --json;
/// verificado contra la CLI real: `config: ok` exit 0 / `config: issues found` exit 1).
///
/// Formatos reales observados:
///   config parse error: TOML parse error at line N, column M\n...\n; using defaults
///   unknown config key <seccion>.<clave>; ignoring key
///   unknown config section [<nombre>]; ignoring section
pub fn parse_check_output(stdout: &str, stderr: &str) -> Vec<ConfigDiagnostic> {
    let mut diags: Vec<ConfigDiagnostic> = Vec::new();
    let mut lines = stdout.lines().peekable();
    while let Some(line) = lines.next() {
        if let Some(rest) = line.strip_prefix("config parse error: ") {
            let mut detail = String::from(rest.trim_end());
            for next in lines.by_ref() {
                let next = next.trim_end();
                if next == "; using defaults" {
                    break;
                }
                if next.starts_with("unknown config ") {
                    // diagnóstico siguiente embebido por seguridad (no debería pasar)
                    if let Some(d) = parse_unknown_line(next) {
                        diags.push(d);
                    }
                    break;
                }
                detail.push('\n');
                detail.push_str(next);
            }
            diags.push(ConfigDiagnostic {
                severity: "error".to_string(),
                code: "parse_error".to_string(),
                message: format!(
                    "la configuración no es TOML válido o un valor tiene un tipo inválido:\n{detail}"
                ),
            });
        } else if let Some(d) = parse_unknown_line(line) {
            diags.push(d);
        }
    }
    if diags.is_empty() && !stderr.trim().is_empty() {
        diags.push(ConfigDiagnostic {
            severity: "error".to_string(),
            code: "cli_failed".to_string(),
            message: format!("la CLI reportó un error al validar: {}", stderr.trim()),
        });
    }
    diags
}

fn parse_unknown_line(line: &str) -> Option<ConfigDiagnostic> {
    if let Some(rest) = line
        .strip_prefix("unknown config key ")
        .and_then(|r| r.strip_suffix("; ignoring key"))
    {
        return Some(ConfigDiagnostic {
            severity: "warning".to_string(),
            code: "unknown_key".to_string(),
            message: format!("clave desconocida «{rest}»: el server la ignorará"),
        });
    }
    if let Some(rest) = line
        .strip_prefix("unknown config section [")
        .and_then(|r| r.strip_suffix("]; ignoring section"))
    {
        return Some(ConfigDiagnostic {
            severity: "warning".to_string(),
            code: "unknown_section".to_string(),
            message: format!("sección desconocida [{rest}]: el server la ignorará"),
        });
    }
    None
}

/// Ejecuta `herdr config check` sobre UN TEXTO propuesto (sin tocar config.toml):
/// escribe el texto en un archivo temporal y apunta HERDR_CONFIG_PATH ahí.
/// El argv sigue la lista blanca; la inyección de entorno es solo esa variable,
/// aplicada después de limpiar todas las HERDR_* heredadas (ver cli_run).
pub(crate) async fn check_config_text(text: &str) -> Result<ConfigCheckResult, ApiError> {
    let tmp = std::env::temp_dir().join(format!(
        "herdr-desk-config-check-{}-{}.toml",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::write(&tmp, text).map_err(|e| ApiError {
        code: "io".to_string(),
        message: format!("no se pudo preparar la validación: {e}"),
    })?;
    let argv: Vec<String> = ["herdr", "config", "check"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let env = vec![("HERDR_CONFIG_PATH".to_string(), tmp.display().to_string())];
    let out = run_whitelisted_with_env(&argv, &env).await;
    let _ = std::fs::remove_file(&tmp);
    let out = out?;
    Ok(ConfigCheckResult {
        exit_code: out.exit_code,
        diagnostics: parse_check_output(&out.stdout, &out.stderr),
    })
}

// ---------------------------------------------------------------------------
// Config por defecto (herdr --default-config)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct ConfigDefaultKey {
    pub key: String,
    /// Representación TOML del valor por defecto (None = sin valor conocido).
    pub value: Option<String>,
    /// true si la clave viene sin comentar en --default-config (p.ej. pane_history).
    pub active: bool,
    /// Comentarios de línea que la describen (para la ayuda del formulario).
    pub description: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct ConfigDefaultSection {
    /// Ruta punteada; "" = raíz, "ui.toast", "keys.command", ...
    pub path: String,
    /// true si es [[array de tablas]] ([[keys.command]]).
    pub table_array: bool,
    pub description: String,
    pub keys: Vec<ConfigDefaultKey>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ConfigDefault {
    pub sections: Vec<ConfigDefaultSection>,
}

/// Divide `clave = valor` (tras quitar `# ` inicial si lo hubiera).
fn split_kv(src: &str) -> Option<(&str, &str)> {
    let src = src.trim_start();
    let mut end = 0;
    for (i, c) in src.char_indices() {
        if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
            end = i + c.len_utf8();
        } else {
            break;
        }
    }
    if end == 0 {
        return None;
    }
    let key = &src[..end];
    let rest = src[end..].trim_start().strip_prefix('=')?;
    Some((key, rest.trim_start()))
}

/// Separa un comentario final ` # ...` fuera de comillas. Devuelve (valor, comentario).
fn strip_trailing_comment(v: &str) -> (&str, String) {
    let mut in_double = false;
    let mut in_single = false;
    let mut escaped = false;
    let mut prev_space = false;
    for (i, c) in v.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match c {
            '\\' if in_double => escaped = true,
            '"' if in_double => in_double = false,
            '"' if !in_single => in_double = true,
            '\'' if in_single => in_single = false,
            '\'' if !in_double => in_single = true,
            '#' if !in_double && !in_single && prev_space => {
                return (v[..i].trim_end(), v[i + 1..].trim().to_string());
            }
            _ => {}
        }
        prev_space = c.is_whitespace();
    }
    (v.trim_end(), String::new())
}

/// Valor TOML canónico o None si el texto no es un valor válido.
/// Se normaliza el decor del documento sintético (`v = ...`) y se recortan
/// espacios del borde.
fn try_parse_value(text: &str) -> Option<String> {
    let doc = format!("v = {text}").parse::<DocumentMut>().ok()?;
    let item = doc.as_table().get("v")?;
    let Item::Value(v) = item else {
        return None;
    };
    let mut clean = v.clone();
    clean.decor_mut().set_prefix(" ");
    clean.decor_mut().set_suffix("");
    Some(clean.to_string().trim().to_string())
}

/// Parsea la salida de `herdr --default-config` (TOML anotado, casi todo comentado)
/// en secciones con claves, valores y descripciones. Contrato verificado contra la
/// CLI real (fixture: schema/fixtures/default_config.toml).
pub fn parse_default_config(text: &str) -> ConfigDefault {
    let mut sections = vec![ConfigDefaultSection {
        path: String::new(),
        table_array: false,
        description: String::new(),
        keys: Vec::new(),
    }];
    let mut cur = 0usize;
    let mut pending: Vec<String> = Vec::new();

    for raw_line in text.lines() {
        let line = raw_line.trim_end();
        let trimmed = line.trim_start();
        if trimmed.is_empty() {
            pending.clear();
            continue;
        }
        // encabezado de sección, activo o comentado
        let (header_src, commented_header) = match trimmed.strip_prefix('#') {
            Some(rest) => (rest.trim_start(), true),
            None => (trimmed, false),
        };
        if header_src.starts_with('[') {
            let table_array = header_src.starts_with("[[");
            let path = header_src
                .trim_start_matches('[')
                .trim_end_matches(']')
                .trim()
                .to_string();
            let description = std::mem::take(&mut pending).join("\n");
            sections.push(ConfigDefaultSection {
                path,
                table_array,
                description,
                keys: Vec::new(),
            });
            cur = sections.len() - 1;
            continue;
        }
        // clave, activa o comentada
        let (kv_src, commented) = if commented_header {
            (header_src, true)
        } else {
            (trimmed, false)
        };
        if let Some((k, v)) = split_kv(kv_src) {
            let (val_text, trailing) = strip_trailing_comment(v);
            if let Some(canonical) = try_parse_value(val_text) {
                let mut description = std::mem::take(&mut pending).join("\n");
                if !trailing.is_empty() {
                    if description.is_empty() {
                        description = trailing;
                    } else {
                        description.push('\n');
                        description.push_str(&trailing);
                    }
                }
                sections[cur].keys.push(ConfigDefaultKey {
                    key: k.to_string(),
                    value: Some(canonical),
                    active: !commented,
                    description,
                });
                continue;
            }
        }
        // prosa: descripción pendiente para la próxima clave/sección
        pending.push(
            trimmed
                .strip_prefix('#')
                .map(|s| s.trim_start().to_string())
                .unwrap_or_else(|| trimmed.to_string()),
        );
    }
    sections.retain(|s| !s.path.is_empty() || !s.keys.is_empty());
    ConfigDefault { sections }
}

static DEFAULTS_CACHE: std::sync::Mutex<Option<ConfigDefault>> = std::sync::Mutex::new(None);

async fn get_defaults_cached(refresh: bool) -> Result<ConfigDefault, ApiError> {
    if !refresh
        && let Ok(guard) = DEFAULTS_CACHE.lock()
        && let Some(d) = guard.as_ref()
    {
        return Ok(d.clone());
    }
    let argv: Vec<String> = ["herdr", "--default-config"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let out = super::cli_run::run_whitelisted(&argv).await?;
    if out.exit_code != 0 {
        return Err(ApiError {
            code: "cli_failed".to_string(),
            message: format!(
                "herdr --default-config salió con código {}: {}",
                out.exit_code,
                out.stderr.trim()
            ),
        });
    }
    let defaults = parse_default_config(&out.stdout);
    if let Ok(mut guard) = DEFAULTS_CACHE.lock() {
        *guard = Some(defaults.clone());
    }
    Ok(defaults)
}

/// Config por defecto estructurada para pintar el formulario de F3.
#[tauri::command]
pub async fn config_default(refresh: Option<bool>) -> Result<ConfigDefault, ApiError> {
    get_defaults_cached(refresh.unwrap_or(false)).await
}

// ---------------------------------------------------------------------------
// Lectura de la config activa
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct ConfigEntry {
    /// Ruta punteada ("theme.name", "ui.accent", "keys.command", ...).
    pub path: String,
    /// Valor efectivo en representación TOML.
    pub value: String,
    /// "file" si viene de config.toml, "default" si es el valor por defecto.
    pub origin: String,
    /// Ayuda del --default-config, si la clave es conocida.
    pub description: Option<String>,
    pub in_defaults: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct ConfigRead {
    pub path: String,
    pub exists: bool,
    /// Diagnóstico si el TOML actual no parsea (la UI puede avisar).
    pub diagnostics: Vec<ConfigDiagnostic>,
    pub entries: Vec<ConfigEntry>,
}

fn collect_file_entries(table: &Table, prefix: &str, out: &mut Vec<(String, String)>) {
    for (k, item) in table.iter() {
        let path = if prefix.is_empty() {
            k.to_string()
        } else {
            format!("{prefix}.{k}")
        };
        match item {
            Item::Value(v) => out.push((path, v.to_string())),
            Item::Table(t) => collect_file_entries(t, &path, out),
            Item::ArrayOfTables(_) => out.push((path, item.to_string())),
            Item::None => {}
        }
    }
}

/// Config activa con valores efectivos y su origen ("file" / "default").
#[tauri::command]
pub async fn config_read() -> Result<ConfigRead, ApiError> {
    let defaults = get_defaults_cached(false).await?;
    let path = config_path();
    let raw = std::fs::read_to_string(&path).unwrap_or_default();
    let exists = path.is_file();

    let mut diagnostics = Vec::new();
    let mut file_entries: Vec<(String, String)> = Vec::new();
    if !raw.trim().is_empty() {
        match raw.parse::<DocumentMut>() {
            Ok(doc) => collect_file_entries(doc.as_table(), "", &mut file_entries),
            Err(e) => diagnostics.push(ConfigDiagnostic {
                severity: "error".to_string(),
                code: "parse_error".to_string(),
                message: format!("config.toml no es TOML válido: {}", e.message()),
            }),
        }
    }

    let mut entries: Vec<ConfigEntry> = Vec::new();
    for section in &defaults.sections {
        for key in &section.keys {
            let path = if section.path.is_empty() {
                key.key.clone()
            } else {
                format!("{}.{}", section.path, key.key)
            };
            let description = if key.description.is_empty() {
                None
            } else {
                Some(key.description.clone())
            };
            if let Some(pos) = file_entries.iter().position(|(p, _)| *p == path) {
                let (p, v) = file_entries.remove(pos);
                entries.push(ConfigEntry {
                    path: p,
                    value: v,
                    origin: "file".to_string(),
                    description,
                    in_defaults: true,
                });
            } else if let Some(v) = &key.value {
                entries.push(ConfigEntry {
                    path,
                    value: v.clone(),
                    origin: "default".to_string(),
                    description,
                    in_defaults: true,
                });
            }
        }
    }
    // claves del archivo que no están en los defaults (desconocidas para la ayuda)
    for (path, value) in file_entries {
        entries.push(ConfigEntry {
            path,
            value,
            origin: "file".to_string(),
            description: None,
            in_defaults: false,
        });
    }

    Ok(ConfigRead {
        path: path.display().to_string(),
        exists,
        diagnostics,
        entries,
    })
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

#[derive(Deserialize, Clone, Debug)]
pub struct ConfigChange {
    /// Ruta punteada ("theme.name"). Último segmento = clave a tocar.
    pub path: String,
    /// Valor en representación TOML (p.ej. `"nord"`, `true`, `3`, `[{ key = "..." }]`).
    /// None = quitar la clave (vuelve al default del server).
    pub value: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ConfigReloadOutcome {
    /// applied | partial | failed (contrato server.reload_config, protocolo 19).
    pub status: String,
    pub diagnostics: Vec<String>,
    /// true si no había server al que recargar (la config aplica al arrancar).
    pub skipped: bool,
    pub error: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ConfigWriteResult {
    pub applied: usize,
    /// true si la validación de la CLI rechazó el cambio (no se escribió nada).
    pub rejected: bool,
    /// Copia config.toml.bak-<timestamp> hecha en la primera escritura.
    pub backup: Option<String>,
    pub reload: Option<ConfigReloadOutcome>,
    /// true si el server rechazó la config y se restauró la anterior.
    pub rolled_back: bool,
    pub diagnostics: Vec<ConfigDiagnostic>,
}

fn invalid(msg: String) -> ApiError {
    ApiError {
        code: "invalid_params".to_string(),
        message: msg,
    }
}

fn validate_path(path: &str) -> Result<Vec<String>, ApiError> {
    let segments: Vec<String> = path.split('.').map(|s| s.trim().to_string()).collect();
    if segments.is_empty() || segments.iter().any(|s| s.is_empty()) {
        return Err(invalid(format!("ruta de clave vacía: «{path}»")));
    }
    for seg in &segments {
        if !seg
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return Err(invalid(format!(
                "ruta de clave inválida «{path}»: los segmentos deben ser claves TOML simples"
            )));
        }
    }
    Ok(segments)
}

/// Interpreta el valor TOML de un cambio: valor simple/inline (`v = <texto>`) o
/// fragmento de documento (`[[keys.command]] ...`) localizado en la misma ruta.
/// El item devuelto va sin decor (canonical) para render limpio.
fn parse_value_item(value_text: &str, path: &str) -> Result<Item, ApiError> {
    // prefijo " ": el espacio entre `=` y el valor lo aporta el decor del valor
    fn clean(item: Item) -> Item {
        if let Item::Value(mut v) = item {
            v.decor_mut().set_prefix(" ");
            v.decor_mut().set_suffix("");
            return Item::Value(v);
        }
        item
    }
    if let Ok(doc) = format!("v = {value_text}").parse::<DocumentMut>()
        && let Some(item) = doc.as_table().get("v")
        && matches!(item, Item::Value(_))
    {
        return Ok(clean(item.clone()));
    }
    if let Ok(frag) = value_text.parse::<DocumentMut>() {
        let segments: Vec<&str> = path.split('.').collect();
        let mut table = frag.as_table();
        let mut ok = true;
        for seg in &segments[..segments.len() - 1] {
            table = match table.get(seg) {
                Some(Item::Table(t)) => t,
                _ => {
                    ok = false;
                    break;
                }
            };
        }
        if ok
            && let Some(item) = table.get(segments[segments.len() - 1])
            && !matches!(item, Item::None)
        {
            return Ok(clean(item.clone()));
        }
    }
    Err(invalid(format!(
        "valor TOML inválido para «{path}»: {value_text}"
    )))
}

/// Aplica los cambios preservando comentarios y formato (toml_edit).
/// Claves existentes: se conserva el decor de la clave y el sufijo del valor
/// (comentarios en la misma línea). La ayuda de cada clave la pinta la UI con
/// config_default: no se reinyectan comentarios para no duplicar bloques.
pub fn apply_changes(raw: &str, changes: &[ConfigChange]) -> Result<(String, usize), ApiError> {
    let mut doc: DocumentMut = if raw.trim().is_empty() {
        DocumentMut::new()
    } else {
        raw.parse::<DocumentMut>().map_err(|e| {
            invalid(format!(
                "config.toml actual no es TOML válido: {}",
                e.message()
            ))
        })?
    };
    let mut applied = 0usize;

    for change in changes {
        let segments = validate_path(&change.path)?;
        let (parents, leaf) = segments.split_at(segments.len() - 1);

        let mut table = doc.as_table_mut();
        for seg in parents {
            // dos fases: decidir/insertar y luego pedir el prestamo mutable,
            // para no solapar dos &mut sobre la misma tabla
            match table.get(seg) {
                Some(Item::Table(_)) => {}
                Some(_) => {
                    return Err(invalid(format!(
                        "la ruta «{}» colisiona con un valor existente",
                        change.path
                    )));
                }
                None => {
                    table.insert(seg, Item::Table(Table::new()));
                }
            }
            table = match table.get_mut(seg) {
                Some(Item::Table(t)) => t,
                _ => unreachable!("acabamos de asegurar la tabla"),
            };
        }
        let leaf = &leaf[0];

        match &change.value {
            Some(value_text) => {
                let new_item = parse_value_item(value_text, &change.path)?;
                let old = table.insert(leaf, new_item);
                // conservar el comentario final de la línea si la clave existía
                if let Some(Item::Value(old_v)) = &old
                    && let Some(suffix) = old_v.decor().suffix()
                    && let Some(Item::Value(new_v)) = table.get_mut(leaf)
                {
                    new_v.decor_mut().set_suffix(suffix.clone());
                }
                applied += 1;
            }
            None => {
                if table.remove(leaf).is_some() {
                    applied += 1;
                }
            }
        }
    }
    Ok((doc.to_string(), applied))
}

static BACKUP_TAKEN: AtomicBool = AtomicBool::new(false);

/// Copia de seguridad config.toml.bak-<timestamp> solo en la primera escritura
/// de esta ejecución (conserva el estado previo a la sesión de la GUI).
fn take_backup_if(path: &Path, first: bool) -> Option<String> {
    if !first {
        return None;
    }
    if !path.is_file() {
        return None;
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let name = format!("{}.bak-{ts}", path.file_name()?.to_string_lossy());
    let bak = path.with_file_name(name);
    std::fs::copy(path, &bak)
        .ok()
        .map(|_| bak.display().to_string())
}

/// Escritura atómica: archivo temporal + rename (mismo volumen).
fn atomic_write(path: &Path, text: &str) -> Result<(), ApiError> {
    let tmp = path.with_extension("toml.tmp");
    std::fs::write(&tmp, text).map_err(|e| ApiError {
        code: "io".to_string(),
        message: format!("no se pudo escribir {}: {e}", tmp.display()),
    })?;
    std::fs::rename(&tmp, path).map_err(|e| ApiError {
        code: "io".to_string(),
        message: format!("no se pudo reemplazar {}: {e}", path.display()),
    })
}

/// Recarga la config del server activo via RPC `server.reload_config`
/// (contrato protocolo 19: params {} → {type:"config_reload", status, diagnostics}).
async fn reload_server(client: &herdr_core::RpcClient) -> ConfigReloadOutcome {
    match client
        .call("server.reload_config", &serde_json::json!({}))
        .await
    {
        Ok(v) => ConfigReloadOutcome {
            status: v
                .get("status")
                .and_then(|s| s.as_str())
                .unwrap_or("unknown")
                .to_string(),
            diagnostics: v
                .get("diagnostics")
                .and_then(|d| d.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default(),
            skipped: false,
            error: None,
        },
        Err(err) => {
            let hint = if matches!(err.code().as_str(), "transport" | "timeout") {
                "sin server activo: la config se aplicará al arrancar"
            } else {
                "no se pudo recargar el server"
            };
            ConfigReloadOutcome {
                status: String::new(),
                diagnostics: Vec::new(),
                skipped: true,
                error: Some(format!("{hint}: {}", err.message())),
            }
        }
    }
}

/// Núcleo reutilizable (tests incluidos): valida con la CLI, hace backup en la
/// primera escritura, escribe atómico, recarga el server y revierte si el server
/// rechaza la config (status failed).
pub(crate) async fn write_config_file(
    path: &Path,
    changes: &[ConfigChange],
    client: Option<&herdr_core::RpcClient>,
) -> Result<ConfigWriteResult, ApiError> {
    let first = !BACKUP_TAKEN.swap(true, Ordering::SeqCst);
    write_config_file_with(path, changes, client, first).await
}

/// Variante con backup explícito (los tests fuerzan `first` para aislarse).
pub(crate) async fn write_config_file_with(
    path: &Path,
    changes: &[ConfigChange],
    client: Option<&herdr_core::RpcClient>,
    first: bool,
) -> Result<ConfigWriteResult, ApiError> {
    let raw_original = std::fs::read_to_string(path).unwrap_or_default();

    let (new_text, applied) = apply_changes(&raw_original, changes)?;

    // 1) validación con la CLI ANTES de tocar config.toml
    let check = check_config_text(&new_text).await?;
    if check.has_blocking_error() {
        return Ok(ConfigWriteResult {
            applied: 0,
            rejected: true,
            backup: None,
            reload: None,
            rolled_back: false,
            diagnostics: check.diagnostics,
        });
    }

    // 2) backup en la primera escritura + escritura atómica
    let backup = take_backup_if(path, first);
    atomic_write(path, &new_text)?;

    // 3) recarga del server solo tras validar y escribir; rollback si el server falla
    let mut rolled_back = false;
    let mut reload = None;
    if let Some(client) = client {
        let outcome = reload_server(client).await;
        if outcome.status == "failed" {
            atomic_write(path, &raw_original)?;
            let _ = reload_server(client).await;
            rolled_back = true;
        }
        reload = Some(outcome);
    }

    Ok(ConfigWriteResult {
        applied,
        rejected: false,
        backup,
        reload,
        rolled_back,
        diagnostics: check.diagnostics,
    })
}

/// Escribe solo las claves cambiadas conservando comentarios y formato.
#[tauri::command]
pub async fn config_write(
    state: tauri::State<'_, crate::state::AppState>,
    changes: Vec<ConfigChange>,
) -> Result<ConfigWriteResult, ApiError> {
    let path = config_path();
    let client = state.current().client.clone();
    write_config_file(&path, &changes, Some(&client)).await
}

#[derive(Serialize, Clone, Debug)]
pub struct ConfigResetResult {
    pub output: super::cli_run::CliRunOutput,
    pub reload: Option<ConfigReloadOutcome>,
}

/// Restaura los atajos de teclado al valor por defecto delegando en
/// `herdr config reset-keys` (la CLI hace su propio backup de config.toml).
/// argv exacto agregado a la lista blanca: sin flags ni argumentos posibles.
#[tauri::command]
pub async fn config_reset_keys(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<ConfigResetResult, ApiError> {
    let argv: Vec<String> = ["herdr", "config", "reset-keys"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let output = super::cli_run::run_whitelisted(&argv).await?;
    let client = state.current().client.clone();
    let reload = reload_server(&client).await;
    Ok(ConfigResetResult {
        output,
        reload: Some(reload),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> String {
        std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../schema/fixtures/default_config.toml"),
        )
        .expect("fixture de la config por defecto")
    }

    fn change(path: &str, value: Option<&str>) -> ConfigChange {
        ConfigChange {
            path: path.to_string(),
            value: value.map(|s| s.to_string()),
        }
    }

    #[test]
    fn parsea_fixture_real_de_default_config() {
        let defaults = parse_default_config(&fixture());
        let theme = defaults
            .sections
            .iter()
            .find(|s| s.path == "theme")
            .expect("seccion theme");
        let name = theme.keys.iter().find(|k| k.key == "name").expect("name");
        assert!(!name.active);
        assert_eq!(name.value.as_deref(), Some("\"catppuccin\""));
        assert!(
            name.description.contains("Built-in themes"),
            "{:?}",
            name.description
        );

        let cmd = defaults
            .sections
            .iter()
            .find(|s| s.path == "keys.command")
            .expect("keys.command");
        assert!(cmd.table_array);
        for k in ["key", "type", "command", "width", "height"] {
            assert!(cmd.keys.iter().any(|kk| kk.key == k), "falta {k}");
        }
        let cmd_key = cmd.keys.iter().find(|k| k.key == "key").unwrap();
        assert_eq!(cmd_key.value.as_deref(), Some("\"prefix+alt+g\""));

        let experimental = defaults
            .sections
            .iter()
            .find(|s| s.path == "experimental")
            .expect("experimental");
        let pane_history = experimental
            .keys
            .iter()
            .find(|k| k.key == "pane_history")
            .expect("pane_history");
        assert!(pane_history.active, "pane_history viene sin comentar");
        assert_eq!(pane_history.value.as_deref(), Some("false"));

        let root = &defaults.sections[0];
        assert!(root.path.is_empty());
        assert!(root.keys.iter().any(|k| k.key == "onboarding"));
    }

    #[test]
    fn roundtrip_preserva_formato_y_comentarios() {
        let original = fixture();
        let (new_text, applied) =
            apply_changes(&original, &[change("theme.name", Some("\"nord\""))]).expect("apply");
        assert_eq!(applied, 1);

        // todas las líneas originales sobreviven en orden; solo se agrega la clave
        let a: Vec<&str> = original.lines().collect();
        let b: Vec<&str> = new_text.lines().collect();
        let mut i = 0;
        let mut added: Vec<&str> = Vec::new();
        for line in &b {
            if i < a.len() && a[i] == *line {
                i += 1;
            } else {
                added.push(line);
            }
        }
        assert_eq!(i, a.len(), "líneas originales alteradas");
        let added_clean: Vec<&&str> = added.iter().filter(|l| !l.trim().is_empty()).collect();
        assert_eq!(added_clean, vec![&"name = \"nord\""], "agregado: {added:?}");
        assert!(
            new_text.contains("# Built-in themes"),
            "comentarios perdidos"
        );
        assert!(
            new_text.contains("# name = \"catppuccin\""),
            "comentario de la clave perdida"
        );

        let doc = new_text
            .parse::<DocumentMut>()
            .expect("TOML válido tras escribir");
        assert_eq!(
            doc.as_table()
                .get("theme")
                .unwrap()
                .get("name")
                .unwrap()
                .as_str(),
            Some("nord")
        );
    }

    #[test]
    fn reemplazo_en_sitio_conserva_comentario_de_linea() {
        let raw =
            "# mi config\n[theme]\nname = \"catppuccin\" # tema casero\n[ui]\naccent = \"cyan\"\n";
        let (out, applied) =
            apply_changes(raw, &[change("theme.name", Some("\"nord\""))]).expect("apply");
        assert_eq!(applied, 1);
        assert!(
            out.contains("name = \"nord\" # tema casero"),
            "comentario final perdido: {out}"
        );
        assert!(!out.contains("catppuccin"));
        assert!(out.contains("# mi config"));
    }

    #[test]
    fn quitar_clave_vuelve_al_default() {
        let raw = "[ui]\naccent = \"blue\"\n";
        let (out, applied) = apply_changes(raw, &[change("ui.accent", None)]).expect("apply");
        assert_eq!(applied, 1);
        assert!(!out.contains("accent"));
        assert!(out.contains("[ui]"));
    }

    #[test]
    fn clave_nueva_en_doc_vacio_es_valida() {
        let (out, applied) = apply_changes(
            "",
            &[
                change("theme.name", Some("\"nord\"")),
                change("ui.accent", Some("\"blue\"")),
            ],
        )
        .expect("apply");
        assert_eq!(applied, 2);
        let doc = out.parse::<DocumentMut>().expect("TOML válido");
        assert_eq!(
            doc.as_table()
                .get("theme")
                .unwrap()
                .get("name")
                .unwrap()
                .as_str(),
            Some("nord")
        );
        assert_eq!(
            doc.as_table()
                .get("ui")
                .unwrap()
                .get("accent")
                .unwrap()
                .as_str(),
            Some("blue")
        );
    }

    #[test]
    fn tabla_de_comandos_acepta_fragmento_e_inline() {
        // fragmento [[keys.command]]
        let frag =
            "[[keys.command]]\nkey = \"prefix+alt+t\"\ntype = \"popup\"\ncommand = \"btop\"\n";
        let (out, applied) =
            apply_changes(raw_fixture_min(), &[change("keys.command", Some(frag))]).expect("apply");
        assert_eq!(applied, 1);
        assert!(out.contains("[[keys.command]]"));
        assert!(out.contains("btop"));
        // inline array equivalente
        let inline = "[{ key = \"prefix+alt+t\", type = \"pane\", command = \"htop\" }]";
        let (out2, applied2) =
            apply_changes(&out, &[change("keys.command", Some(inline))]).expect("apply");
        assert_eq!(applied2, 1);
        let doc = out2.parse::<DocumentMut>().expect("TOML válido");
        assert!(doc.as_table().get("keys").unwrap().get("command").is_some());
        assert!(out2.contains("htop"));
    }

    fn raw_fixture_min() -> &'static str {
        "[keys]\n# prefix = \"ctrl+b\"\n"
    }

    #[test]
    fn ruta_invalida_se_rechaza() {
        for bad in ["", "the me.x", "a..b", "x;rm"] {
            let err = apply_changes("", &[change(bad, Some("1"))])
                .expect_err("debe rechazar ruta inválida");
            assert_eq!(err.code, "invalid_params", "ruta: {bad}");
        }
    }

    #[test]
    fn parsea_diagnosticos_reales_del_check() {
        let stdout = "config: issues found\nconfig parse error: TOML parse error at line 4, column 17\n  |\n4 | sidebar_width = \"no-es-numero\"\n  |                 ^^^^^^^^^^^^^^\ninvalid type: string \"no-es-numero\", expected u16\n; using defaults\nunknown config key theme.clave_desconocida; ignoring key\nunknown config section [seccion_inexistente]; ignoring section\n";
        let diags = parse_check_output(stdout, "");
        assert_eq!(diags.len(), 3);
        assert_eq!(diags[0].code, "parse_error");
        assert_eq!(diags[0].severity, "error");
        assert!(diags[0].message.contains("invalid type"));
        assert_eq!(diags[1].code, "unknown_key");
        assert_eq!(diags[1].severity, "warning");
        assert!(diags[1].message.contains("theme.clave_desconocida"));
        assert_eq!(diags[2].code, "unknown_section");
        assert!(diags[2].message.contains("[seccion_inexistente]"));
    }

    #[test]
    fn check_ok_no_genera_diagnosticos() {
        assert!(parse_check_output("config: ok\n", "").is_empty());
    }

    #[test]
    fn stderr_vacio_y_exit_1_sin_lineas_conocidas_da_error_generico() {
        let diags = parse_check_output("config: issues found\n", "");
        assert!(
            diags.is_empty(),
            "sin líneas reconocibles no inventa diagnósticos"
        );
        let diags = parse_check_output("", "algo raro");
        assert_eq!(diags[0].code, "cli_failed");
    }
}
