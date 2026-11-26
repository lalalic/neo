use std::{env, path::PathBuf};
pub fn relay_cli() -> Result<PathBuf, String> {
    let cli = if let Some(override_path) = env::var_os("NEO_RELAY_EXECUTABLE") {
        let path = PathBuf::from(override_path);
        if !path.is_absolute() {
            return Err("NEO_RELAY_EXECUTABLE must be an absolute path".into());
        }
        path
    } else {
        env::current_exe()
            .map_err(|e| e.to_string())?
            .parent()
            .ok_or("Neo binary directory unavailable")?
            .join("agents-relay-rust")
    };
    if !cli.is_file() {
        return Err(format!(
            "Relay Prompt Parts CLI unavailable at {}. Stage with scripts/stage-neo-with-relay.sh and the matched Relay checkout",
            cli.display()
        ));
    }
    Ok(cli)
}
