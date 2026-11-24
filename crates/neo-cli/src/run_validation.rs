use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub struct SelectedProject {
    pub root: PathBuf,
    pub project: PathBuf,
    pub graph: PathBuf,
    pub declaration: Value,
}
fn inside(root: &Path, candidate: &Path) -> bool {
    candidate.strip_prefix(root).is_ok()
}
fn name_valid(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(),Some(x) if x.is_ascii_alphanumeric())
        && chars.all(|x| x.is_ascii_alphanumeric() || matches!(x, '.' | '_' | '-'))
}
pub fn safe_project(neo_root: &Path, name: &str) -> Result<SelectedProject, String> {
    if !name_valid(name) || matches!(name, "." | "..") {
        return Err("invalid project name".to_string());
    }
    let root = neo_root.canonicalize().map_err(|e| e.to_string())?;
    let marker = root.join(".git");
    if marker.exists()
        && !fs::symlink_metadata(marker)
            .map_err(|e| e.to_string())?
            .is_dir()
    {
        return Err(
            "configured Neo root is a linked Git worktree, not the canonical checkout".into(),
        );
    }
    let project = root.join(name).canonicalize().map_err(|e| e.to_string())?;
    if !inside(&root, &project) || project == root {
        return Err("project resolves outside the configured Neo workspace".into());
    }
    for file in ["AGENTS.md", "README.md", "graph.mmd", "project.run.json"] {
        let path = project.join(file);
        if !path.exists() {
            return Err(format!("project is missing required {file}"));
        }
        let actual = path.canonicalize().map_err(|e| e.to_string())?;
        if !inside(&project, &actual) || !actual.is_file() {
            return Err(format!("project has an invalid {file}"));
        }
    }
    let raw = fs::read_to_string(project.join("project.run.json")).map_err(|e| e.to_string())?;
    let declaration: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if declaration.get("schemaVersion") != Some(&json!(1))
        || !matches!(
            declaration.pointer("/input/type").and_then(Value::as_str),
            Some("url" | "path")
        )
    {
        return Err("invalid project run declaration".into());
    }
    let graph = project
        .join("graph.mmd")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !inside(&project, &graph) {
        return Err("project graph resolves outside the project".into());
    }
    Ok(SelectedProject {
        root,
        project,
        graph,
        declaration,
    })
}
fn dated_name_format(name: &str) -> bool {
    let raw = name.as_bytes();
    if raw.len() < 10 || raw[4] != b'-' || raw[7] != b'-' {
        return false;
    }
    if raw[..10]
        .iter()
        .enumerate()
        .any(|(i, x)| i != 4 && i != 7 && !x.is_ascii_digit())
    {
        return false;
    }
    if raw.len() > 10
        && (raw[10] != b'-'
            || raw.len() == 11
            || !raw[11].is_ascii_alphanumeric()
            || !raw[11..]
                .iter()
                .all(|x| x.is_ascii_alphanumeric() || matches!(x, b'.' | b'_' | b'-')))
    {
        return false;
    }
    true
}
fn calendar_date_valid(name: &str) -> bool {
    let year = name[..4].parse::<u32>().unwrap_or(0);
    let month = name[5..7].parse::<u32>().unwrap_or(0);
    let day = name[8..10].parse::<u32>().unwrap_or(0);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let limit = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        _ => 0,
    };
    day >= 1 && day <= limit
}

pub fn validate_run_path(input: &Path, selected: &SelectedProject) -> Result<PathBuf, String> {
    let declared = &selected.declaration["input"];
    let canonical_run = declared["type"] == "path"
        && declared["path"]["base"] == "runs"
        && declared["path"]["datedRunDirectory"] == true;
    let resume_url = declared["type"] == "url" && declared["resumePath"] == true;
    if !canonical_run && !resume_url {
        return Err("project does not accept canonical run path input".into());
    }
    if !input.is_absolute() {
        return Err("--path must be absolute".into());
    }
    if input
        .components()
        .any(|part| part == std::path::Component::ParentDir)
    {
        return Err("--path must not contain traversal segments".into());
    }
    let runs = selected.project.join("runs");
    let (runs_real, target) = match (runs.canonicalize(), input.canonicalize()) {
        (Ok(a), Ok(b)) => (a, b),
        _ => return Err("run path does not exist".into()),
    };
    if !inside(&selected.project, &runs_real) || !inside(&runs_real, &target) || target == runs_real
    {
        return Err("run path must resolve inside this project runs directory".into());
    }
    if !fs::symlink_metadata(&target)
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err("--path must name a run directory".into());
    }
    let run_name = target
        .file_name()
        .map(|x| x.to_string_lossy().to_string())
        .unwrap_or_default();
    if !dated_name_format(&run_name) {
        return Err("--path must name a dated canonical run directory".into());
    }
    if !calendar_date_valid(&run_name) {
        return Err("--path must start with a valid calendar date".into());
    }
    let parent = target.parent().ok_or("invalid run parent")?;
    if parent
        .strip_prefix(&runs_real)
        .map_err(|e| e.to_string())?
        .components()
        .count()
        > 1
    {
        return Err("run path is nested beyond the canonical series layout".into());
    }
    Ok(target)
}
