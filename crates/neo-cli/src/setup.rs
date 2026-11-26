//! Host-local optional engineering dependencies. No project scan or MCP setup.
use crate::{process_guard, workspace};
use serde_json::{json, Value};
use std::{env, fs, path::Path, process::Command, time::Duration};

const AST_GREP: (&str, &str, &str) = ("ast-grep", "@ast-grep/cli", "0.51.3");

fn exec(command: &mut Command, timeout: u64) -> Result<String, String> {
    let output =
        process_guard::capture_with_input(command, None, Duration::from_secs(timeout), 64 * 1024)?;
    if !output.status.success() {
        return Err(format!(
            "exit {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
                .chars()
                .take(400)
                .collect::<String>()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}

fn ensure_tool(home: &Path, tool: (&str, &str, &str)) -> Result<String, String> {
    let (name, package, version) = tool;
    let prefix = home.join(".local");
    let bin = prefix.join("bin").join(name);
    let expected = |text: &str| text == version || text == format!("{name} {version}");
    let installed = || exec(Command::new(&bin).arg("--version"), 15);
    if !installed().is_ok_and(|text| expected(&text)) {
        // Never overwrite an unrelated executable or symlink.
        if fs::symlink_metadata(&bin).is_ok() {
            let target = fs::canonicalize(&bin).map_err(|e| e.to_string())?;
            let owned = fs::canonicalize(prefix.join("lib/node_modules").join(package))
                .map_err(|_| format!("unmanaged executable: {}", bin.display()))?;
            if !target.starts_with(owned) {
                return Err(format!("unmanaged executable: {}", bin.display()));
            }
        }
        let mut npm = Command::new("npm");
        npm.args(["install", "--global", "--no-audit", "--no-fund", "--prefix"])
            .arg(&prefix)
            .arg(format!("{package}@{version}"));
        exec(&mut npm, 120)?;
    }
    let actual = installed()?;
    if !expected(&actual) {
        return Err(format!("unexpected version: {actual}"));
    }
    Ok(version.into())
}

pub fn run(args: &[String]) -> Result<Value, String> {
    if args != ["code-tools"] {
        return Err("usage: neo setup code-tools".into());
    }
    let home = workspace::home()?;
    // Serialize concurrent app and manual setup invocations on this host.
    let state = home.join(".local/state/neo");
    fs::create_dir_all(&state).map_err(|e| e.to_string())?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(state.join("code-tools.lock"))
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Err("code tools setup is already running or lock is unavailable".into());
        }
    }
    // Include the same user-local/Homebrew locations as the native app.
    let mut paths = vec![
        home.join(".local/bin"),
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
    ];
    paths.extend(env::split_paths(&env::var_os("PATH").unwrap_or_default()));
    paths.extend([
        Path::new("/usr/bin").to_path_buf(),
        Path::new("/bin").to_path_buf(),
    ]);
    env::set_var("PATH", env::join_paths(paths).map_err(|e| e.to_string())?);
    let result = match ensure_tool(&home, AST_GREP) {
        Ok(version) => json!({"ok":true,"version":version}),
        Err(error) => json!({"ok":false,"error":error}),
    };
    Ok(json!({"ok":result["ok"],"tools":{"ast-grep":result}}))
}
