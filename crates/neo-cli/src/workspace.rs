use serde_json::{json, Value};
use std::{env, fs, path::PathBuf};

#[derive(Debug)]
pub struct Workspace {
    pub neo_root: PathBuf,
    pub harness_root: PathBuf,
}

pub fn home() -> Result<PathBuf, String> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set".to_string())
}

/// Harness assets are versioned with the executable, not stored under the
/// caller's configurable Neo Projects root.
pub fn harness_root() -> Result<PathBuf, String> {
    if let Some(explicit) = env::var_os("NEO_HARNESS_ROOT") {
        let root = PathBuf::from(explicit);
        if !root.is_absolute() || !root.is_dir() {
            return Err(format!(
                "NEO_HARNESS_ROOT must be an accessible absolute directory: {}",
                root.display()
            ));
        }
        return Ok(root);
    }
    let exe = env::current_exe().map_err(|e| e.to_string())?;
    for ancestor in exe.ancestors().skip(1) {
        if ancestor.join("agents").is_dir() && ancestor.join("skills").is_dir() {
            return Ok(ancestor.to_path_buf());
        }
    }
    Err("Harness assets unavailable; set NEO_HARNESS_ROOT to the installed assets root".into())
}

/// Preserve strict v1 config validation and existing, real Project root. No
/// migration or creation is allowed during read-only CLI commands.
pub fn load() -> Result<Workspace, String> {
    let home = home()?;
    let config_path = env::var_os("NEO_WORKSPACE_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config/neo/workspace.json"));

    let config: Value = match fs::read_to_string(&config_path) {
        Ok(data) => serde_json::from_str(&data)
            .map_err(|e| format!("Cannot read Neo configuration: {e}"))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            json!({"schemaVersion": 1, "neoRoot": home.join("Workspace").to_string_lossy()})
        }
        Err(e) => return Err(format!("Cannot read Neo configuration: {e}")),
    };
    let object = config
        .as_object()
        .ok_or_else(|| format!("Invalid Neo configuration at {}", config_path.display()))?;
    if object.len() != 2
        || object.get("schemaVersion") != Some(&json!(1))
        || !object.contains_key("neoRoot")
    {
        return Err(format!(
            "Invalid Neo configuration at {}",
            config_path.display()
        ));
    }
    let configured_root = object
        .get("neoRoot")
        .and_then(Value::as_str)
        .ok_or_else(|| "NEO_ROOT must be an absolute path".to_string())?;
    let requested = env::var("NEO_ROOT").unwrap_or_else(|_| configured_root.to_string());
    let root = PathBuf::from(&requested);
    if !root.is_absolute() {
        return Err("NEO_ROOT must be an absolute path".into());
    }
    if !root.is_dir() {
        return Err(format!(
            "NEO_ROOT is not an accessible directory: {}",
            root.display()
        ));
    }
    Ok(Workspace {
        neo_root: root.canonicalize().map_err(|_| {
            format!(
                "NEO_ROOT is not an accessible directory: {}",
                root.display()
            )
        })?,
        harness_root: harness_root()?,
    })
}

pub fn validate_workspace_config() -> Result<(), String> {
    load().map(|_| ())
}

pub fn show(args: &[String]) -> Result<String, String> {
    if args != ["show"] {
        return Err("usage: neo workspace show".into());
    }
    let workspace = load()?;
    let value = json!({
        "neoRoot":workspace.neo_root.to_string_lossy(),
        "harnessRoot":workspace.harness_root.to_string_lossy(),
    });
    serde_json::to_string_pretty(&value).map_err(|e| e.to_string())
}
