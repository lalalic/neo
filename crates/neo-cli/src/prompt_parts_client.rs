use std::{
    env,
    path::{Path, PathBuf},
};

fn executable(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    metadata.is_file()
}

/// Relay owns its executable and resource package. Resolve its installed CLI
/// rather than selecting a binary relative to the Neo bundle. An explicit
/// absolute override is useful for isolated integration tests.
pub fn relay_cli() -> Result<PathBuf, String> {
    if let Some(override_path) = env::var_os("NEO_RELAY_EXECUTABLE") {
        let path = PathBuf::from(override_path);
        if !path.is_absolute() {
            return Err("NEO_RELAY_EXECUTABLE must be an absolute path".into());
        }
        return if executable(&path) {
            Ok(path)
        } else {
            Err(format!(
                "Relay Prompt Parts CLI unavailable or not executable at {}",
                path.display()
            ))
        };
    }
    if let Some(path) = env::var_os("PATH") {
        for dir in env::split_paths(&path).filter(|dir| dir.is_absolute()) {
            let candidate = dir.join("agents-relay");
            if executable(&candidate) {
                return Ok(candidate);
            }
        }
    }
    Err("Relay Prompt Parts CLI unavailable: install Agents Relay and expose agents-relay on PATH, or set NEO_RELAY_EXECUTABLE to its absolute executable path".into())
}
