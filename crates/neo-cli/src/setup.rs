//! Host-local optional engineering dependencies. No project scan or MCP setup.
use crate::{process_guard, workspace};
use serde_json::{json, Value};
use std::{env, fs, io::Write, path::Path, process::Command, time::Duration};

const CODEGRAPH: (&str, &str, &str) = ("codegraph", "@colbymchenry/codegraph", "1.6.4");
const AST_GREP: (&str, &str, &str) = ("ast-grep", "@ast-grep/cli", "0.51.3");
const RULE: &str = "- CodeGraph: Prefer CodeGraph when available for structural exploration and call/impact analysis. Use the actual Git worktree root, lazily initialize with `codegraph init --yes --local-only ROOT`, sync with `codegraph sync --quiet ROOT` after edits and use `--path ROOT` for queries. Use ast-grep when available for syntax patterns and rg for literals/fallback. If PATH lacks either tool, use its executable under ~/.local/bin. Bound outputs; verify source and git diff.";

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
    if name == "codegraph" {
        exec(Command::new(&bin).args(["telemetry", "off"]), 15)?;
    }
    Ok(version.into())
}

fn reconcile_rule(home: &Path) -> Result<(), String> {
    let dir = home.join(".agents");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("AGENTS.md");
    let path = if fs::symlink_metadata(&path).is_ok() {
        fs::canonicalize(&path).map_err(|e| e.to_string())?
    } else {
        path
    };
    let old = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.to_string()),
    };
    let matches = old
        .lines()
        .filter(|line| line.starts_with("- CodeGraph:"))
        .count();
    if matches > 1 {
        return Err("duplicate CodeGraph rules; preserve existing file".into());
    }
    let mut updated = String::new();
    let mut inserted = false;
    for line in old.split_inclusive('\n') {
        if line.starts_with("- CodeGraph:") {
            updated.push_str(RULE);
            updated.push('\n');
            inserted = true;
        } else {
            updated.push_str(line);
            if !inserted && matches == 0 && line.trim_end() == "# Engineering Rules" {
                if !line.ends_with('\n') {
                    updated.push('\n');
                }
                updated.push_str(RULE);
                updated.push('\n');
                inserted = true;
            }
        }
    }
    if !inserted {
        if !updated.is_empty() && !updated.ends_with('\n') {
            updated.push('\n');
        }
        updated.push_str("\n# Engineering Rules\n");
        updated.push_str(RULE);
        updated.push('\n');
    }
    if updated == old {
        return Ok(());
    }
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().ok_or("invalid rules parent")?)
        .map_err(|e| e.to_string())?;
    if let Ok(meta) = fs::metadata(&path) {
        temp.as_file()
            .set_permissions(meta.permissions())
            .map_err(|e| e.to_string())?;
    }
    temp.write_all(updated.as_bytes())
        .map_err(|e| e.to_string())?;
    temp.persist(&path).map_err(|e| e.to_string())?;
    Ok(())
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
    let mut tools = serde_json::Map::new();
    for tool in [CODEGRAPH, AST_GREP] {
        tools.insert(
            tool.0.into(),
            match ensure_tool(&home, tool) {
                Ok(version) => json!({"ok":true,"version":version}),
                Err(error) => json!({"ok":false,"error":error}),
            },
        );
    }
    let rules = reconcile_rule(&home);
    let ok = tools.values().all(|tool| tool["ok"] == true) && rules.is_ok();
    Ok(json!({"ok":ok,"tools":tools,"rules":match rules {
        Ok(()) => json!({"ok":true}),
        Err(error) => json!({"ok":false,"error":error}),
    }}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rule_is_idempotent_and_preserves_other_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".agents/AGENTS.md");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            "# Engineering Rules\n- keep this\n- CodeGraph: old\n# Next\n",
        )
        .unwrap();
        reconcile_rule(dir.path()).unwrap();
        let first = fs::read_to_string(&path).unwrap();
        assert_eq!(
            first,
            format!("# Engineering Rules\n- keep this\n{RULE}\n# Next\n")
        );
        reconcile_rule(dir.path()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), first);
        assert!(!dir.path().join(".codex").exists());
    }
    #[test]
    fn fresh_home_and_duplicate_rules() {
        let dir = tempfile::tempdir().unwrap();
        reconcile_rule(dir.path()).unwrap();
        let path = dir.path().join(".agents/AGENTS.md");
        assert!(fs::read_to_string(&path).unwrap().contains(RULE));
        let duplicate = "- CodeGraph: a\n- CodeGraph: b\n";
        fs::write(&path, duplicate).unwrap();
        assert!(reconcile_rule(dir.path()).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), duplicate);
    }
}
