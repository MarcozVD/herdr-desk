use std::path::{Path, PathBuf};

pub fn pipe_name(socket_path: &Path) -> String {
    format!(r"\\.\pipe\{}", socket_path.display())
}

/// Nombre de la sesion por defecto de herdr.
pub const DEFAULT_SESSION: &str = "default";

pub fn herdr_appdata() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_default();
    PathBuf::from(base).join("herdr")
}

pub fn default_socket() -> PathBuf {
    herdr_appdata().join("herdr.sock")
}

/// Socket de una sesion con nombre. La sesion `default` NO vive en
/// `sessions\default\`: su socket es el de la raiz (`%APPDATA%\herdr\herdr.sock`),
/// igual que el `socket_path` que devuelve `herdr session list --json`.
pub fn session_socket(name: &str) -> PathBuf {
    if name == DEFAULT_SESSION {
        return default_socket();
    }
    herdr_appdata()
        .join("sessions")
        .join(name)
        .join("herdr.sock")
}

pub fn find_herdr_exe(config_hint: Option<&Path>) -> Option<PathBuf> {
    if let Some(p) = config_hint
        && p.is_file()
    {
        return Some(p.to_path_buf());
    }
    if let Ok(p) = std::env::var("HERDR_BIN_PATH") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }
    if let Some(p) = which_herdr() {
        return Some(p);
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let p = PathBuf::from(local)
            .join("Programs")
            .join("Herdr")
            .join("bin")
            .join("herdr.exe");
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

fn which_herdr() -> Option<PathBuf> {
    let path = std::env::var("PATH").ok()?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join("herdr.exe");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pipe_name_from_socket() {
        let socket = PathBuf::from(r"C:\Users\dev\AppData\Roaming\herdr\herdr.sock");
        assert_eq!(
            pipe_name(&socket),
            r"\\.\pipe\C:\Users\dev\AppData\Roaming\herdr\herdr.sock"
        );
    }

    #[test]
    fn la_sesion_default_usa_el_socket_raiz() {
        assert_eq!(session_socket(DEFAULT_SESSION), default_socket());
        let named = session_socket("hd-test-1");
        assert!(named.ends_with(r"sessions\hd-test-1\herdr.sock"));
    }
}
