use std::path::PathBuf;

/// Directory of herdr's own config (config.toml), not ours.
pub fn herdr_config_dir() -> PathBuf {
    crate::paths::herdr_appdata()
}

pub fn herdr_config_toml() -> PathBuf {
    herdr_config_dir().join("config.toml")
}

/// herdr-desk GUI settings dir.
pub fn gui_settings_dir() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_default();
    PathBuf::from(base).join("herdr-desk")
}
