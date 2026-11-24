use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Debug, Serialize)]
struct Setup {
    bootstrap: String,
}
#[derive(Debug, Serialize)]
struct Lifecycle {
    entrypoint: String,
}
#[derive(Debug, Serialize)]
struct Project {
    xchat_project: String,
    name: String,
    local_path: String,
    git_root: String,
    repo: String,
    origin: Option<String>,
    neo_project: bool,
    context_files: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    setup: Option<Setup>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lifecycle: Option<Lifecycle>,
}
fn git(path: &Path, args: &[&str]) -> Option<String> {
    let result = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .ok()?;
    if !result.status.success() {
        return None;
    }
    String::from_utf8(result.stdout)
        .ok()
        .map(|s| s.trim().to_string())
}
fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(),Some(c) if c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}
fn list() -> Result<Vec<Project>, String> {
    let workspace = crate::workspace::load()?;
    let root = workspace.neo_root;
    let home = crate::workspace::home()?;
    let mut candidates = fs::read_dir(&root)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    candidates.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());
    let mut result = Vec::new();
    for entry in candidates {
        let path = entry.path();
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let Ok(ft) = entry.file_type() else { continue };
        if !valid_name(&name) || ft.is_symlink() || !ft.is_dir() || !path.join(".git").exists() {
            continue;
        }
        let Some(actual) = path.canonicalize().ok() else {
            continue;
        };
        let Some(git_root) = git(&path, &["rev-parse", "--show-toplevel"]) else {
            continue;
        };
        if PathBuf::from(git_root).canonicalize().ok().as_ref() != Some(&actual) {
            continue;
        }
        if ["AGENTS.md", "README.md", "graph.mmd"]
            .iter()
            .any(|f| !path.join(f).is_file())
        {
            continue;
        }
        let mut contexts = Vec::new();
        for source in [
            home.join(".agents/AGENTS.md"),
            root.join("AGENTS.md"),
            path.join("AGENTS.md"),
            path.join("README.md"),
        ] {
            if source.is_file() {
                contexts.push(source.to_string_lossy().to_string());
            }
        }
        let as_string = actual.to_string_lossy().to_string();
        result.push(Project {
            xchat_project: name.clone(),
            name: name.clone(),
            local_path: as_string.clone(),
            git_root: as_string,
            repo: name,
            origin: git(&path, &["remote", "get-url", "origin"]),
            neo_project: true,
            context_files: contexts,
            setup: None,
            lifecycle: None,
        });
    }
    Ok(result)
}
fn detail(mut row: Project) -> Project {
    let path = Path::new(&row.local_path);
    let bootstrap = path.join("setup/bootstrap.md");
    if bootstrap.is_file() && fs::metadata(&bootstrap).is_ok_and(|m| m.len() > 0) {
        row.setup = Some(Setup {
            bootstrap: bootstrap.to_string_lossy().to_string(),
        });
    }
    let lifecycle = path.join("neo-project");
    #[cfg(unix)]
    let executable = {
        use std::os::unix::fs::PermissionsExt;
        lifecycle.is_file()
            && fs::metadata(&lifecycle).is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
    };
    #[cfg(not(unix))]
    let executable = false;
    if executable {
        row.lifecycle = Some(Lifecycle {
            entrypoint: lifecycle.to_string_lossy().to_string(),
        });
    }
    row
}

pub fn run(args: &[String]) -> Result<String, String> {
    let usage="usage: neo project list | resolve NAME | setup-agent NAME | tts (--text TEXT | --text-file PATH) --output ABSOLUTE.m4a | run (--url URL | --path PATH) --project NAME [--dry-run]";
    let (command, options) = args.split_first().ok_or(usage.to_string())?;
    let rows = list()?;
    let output = match command.as_str() {
        "list" if options.is_empty() => {
            serde_json::to_string_pretty(&rows).map_err(|e| e.to_string())?
        }
        "resolve" if options.len() == 1 && !options[0].starts_with('-') => {
            let query = options[0].trim();
            if !valid_name(query) {
                return Err(format!(
                    "invalid Neo Project name: {:?}; use a direct NEO_ROOT child name",
                    options[0]
                ));
            }
            let Some(row) = rows
                .into_iter()
                .find(|row| row.name.eq_ignore_ascii_case(query))
            else {
                return Err(format!("Neo Project not found in NEO_ROOT: {}", options[0]));
            };
            serde_json::to_string_pretty(&detail(row)).map_err(|e| e.to_string())?
        }
        _ => return Err(usage.to_string()),
    };
    Ok(output)
}
