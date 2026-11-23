//! Strict non-mutating preview of a Project Run. Live Run creation, binding,
//! Git commits and Relay submission are intentionally not implemented here.
use crate::run_validation::{safe_project, validate_run_path, SelectedProject};
use chrono::Utc;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};
use url::Url;

#[derive(Default)]
pub struct Options {
    pub project: Option<String>,
    pub url: Option<String>,
    pub path: Option<String>,
    pub title: Option<String>,
    pub dag: Option<String>,
    pub source: Option<String>,
    pub dry_run: bool,
    pub foreground: bool,
    pub no_review: bool,
}
fn valid_identifier(s: &str) -> bool {
    let mut chars = s.chars();
    matches!(chars.next(),Some(c) if c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}
fn inside(base: &Path, target: &Path) -> bool {
    target.strip_prefix(base).is_ok()
}
fn parse(args: &[String]) -> Result<Options, String> {
    let mut opt = Options::default();
    let mut flags = HashSet::new();
    let mut i = 0;
    while i < args.len() {
        let raw = &args[i];
        if raw == "--dry-run" || raw == "--foreground" || raw == "--no-review" {
            if !flags.insert(raw.as_str()) {
                return Err(format!("{raw} may be specified only once"));
            }
            match raw.as_str() {
                "--dry-run" => opt.dry_run = true,
                "--foreground" => opt.foreground = true,
                _ => opt.no_review = true,
            }
            i += 1;
            continue;
        }
        let (key, v) = raw.split_once('=').unwrap_or((raw.as_str(), ""));
        if !matches!(
            key,
            "--url" | "--path" | "--project" | "--title" | "--dag" | "--source"
        ) {
            return Err(format!("unknown project run option: {raw}"));
        }
        if !flags.insert(key) {
            return Err(format!("{key} may be specified only once"));
        }
        let val = if raw.contains('=') {
            v.to_string()
        } else {
            i += 1;
            args.get(i).cloned().unwrap_or_default()
        };
        if val.is_empty() || val.starts_with("--") {
            return Err(format!("{key} requires a value"));
        }
        match key {
            "--url" => opt.url = Some(val),
            "--path" => opt.path = Some(val),
            "--project" => opt.project = Some(val),
            "--title" => opt.title = Some(val),
            "--dag" => opt.dag = Some(val),
            "--source" => opt.source = Some(val),
            _ => unreachable!(),
        }
        i += 1;
    }
    if opt.project.is_none() {
        return Err("project run requires --project NAME".into());
    }
    if opt.url.is_some() && opt.path.is_some() {
        return Err("project run accepts only one of --url URL or --path PATH".into());
    }
    if opt.source.is_some() && (opt.url.is_some() || opt.path.is_some()) {
        return Err(
            "--source selects a new discovery Run and cannot be combined with --url or --path"
                .into(),
        );
    }
    if opt.foreground && opt.dry_run {
        return Err("--foreground cannot be combined with --dry-run".into());
    }
    if opt.no_review && (opt.project.as_deref() != Some("vlog") || opt.path.is_none()) {
        return Err("--no-review is only supported for a private canonical Vlog run".into());
    }
    if let Some(title) = opt.title.take() {
        let trimmed = title.trim();
        if trimmed.is_empty()
            || trimmed.encode_utf16().count() > 120
            || trimmed.chars().any(|c| c.is_control())
        {
            return Err("--title requires 1–120 printable characters".into());
        }
        opt.title = Some(trimmed.to_string());
    }
    Ok(opt)
}
fn git_root(dir: &Path) -> Option<PathBuf> {
    let o = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .ok()?;
    if !o.status.success() {
        return None;
    }
    let text = String::from_utf8(o.stdout).ok()?;
    PathBuf::from(text.trim()).canonicalize().ok()
}
fn require_run_git_config(sel: &SelectedProject) -> Result<(), String> {
    let Some(versioning) = sel.declaration.get("versioning").filter(|v| !v.is_null()) else {
        return Ok(());
    };
    if versioning["mode"] != "local-git" || versioning["template"] != "run-template" {
        return Err("Run Git: versioning requires local-git and run-template".into());
    }
    let template = sel.project.join("run-template/.gitignore");
    let meta = fs::symlink_metadata(&template)
        .map_err(|_| "Run Git: project run-template/.gitignore is missing or unsafe".to_string())?;
    let real = template
        .canonicalize()
        .map_err(|_| "Run Git: project run-template/.gitignore is missing or unsafe".to_string())?;
    if meta.file_type().is_symlink() || !meta.is_file() || !inside(&sel.project, &real) {
        return Err("Run Git: project run-template/.gitignore is missing or unsafe".into());
    }
    let rules = fs::read_to_string(&template).map_err(|e| e.to_string())?;
    if rules.trim().is_empty() {
        return Err("Run Git: empty run-template/.gitignore".into());
    }
    Ok(())
}
fn validate_url(raw: &str, sel: &SelectedProject) -> Result<(), String> {
    let bytes = raw.as_bytes();
    if raw.chars().any(|c| c <= ' ' || c == '\u{7f}')
        || bytes.iter().enumerate().any(|(i, b)| {
            *b == b'%'
                && (i + 2 >= bytes.len()
                    || !bytes[i + 1].is_ascii_hexdigit()
                    || !bytes[i + 2].is_ascii_hexdigit())
        })
    {
        return Err(
            "URL contains invalid whitespace, control characters, or percent encoding".into(),
        );
    }
    let url = Url::parse(raw).map_err(|_| "invalid URL".to_string())?;
    if sel.declaration["input"]["type"] != "url" {
        return Err("project does not accept URL input".into());
    }
    let schemes = sel.declaration["input"]["schemes"].as_array();
    if !schemes.is_some_and(|a| a.iter().any(|s| s == "https")) || url.scheme() != "https" {
        return Err("URL must use HTTPS".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URL credentials are not allowed".into());
    }
    if url.host_str().is_none() {
        return Err("URL requires a hostname".into());
    }
    Ok(())
}
fn recover_unbound_source(
    sel: &SelectedProject,
    run: Option<&Path>,
) -> Result<Option<(String, String, String)>, String> {
    let Some(run) = run else { return Ok(None) };
    if run.join(".neo-project-run.json").exists() {
        return Ok(None);
    }
    let path = run.join("source-reference.json");
    if !path.exists() {
        return Ok(None);
    }
    let source: Value = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
        .map_err(|_| "unbound run has unreadable source-reference.json".to_string())?;
    if !source.is_object() {
        return Err("invalid unbound source-reference.json".into());
    }
    let Some(source_id) = source.get("source") else {
        return Ok(None);
    };
    let name = source_id.as_str().unwrap_or("");
    let selected = source_preset(sel, name)?;
    if source["kind"] != "discovery" || source["sourceBrief"] != selected.2 {
        return Err("unbound source Run evidence disagrees with project source declaration".into());
    }
    Ok(Some(selected))
}

fn selected_graph(
    sel: &SelectedProject,
    requested: Option<&str>,
    run: Option<&Path>,
) -> Result<(Option<String>, PathBuf), String> {
    let mut stored = None;
    if let Some(run) = run {
        let binding = run.join(".neo-project-run.json");
        if binding.exists() {
            let saved: Value = serde_json::from_slice(&fs::read(binding).map_err(|_| {
                "existing run binding is unreadable; preserving run for review".to_string()
            })?)
            .map_err(|_| {
                "existing run binding is unreadable; preserving run for review".to_string()
            })?;
            stored = saved
                .get("dag")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| {
                    sel.declaration
                        .get("defaultDag")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                });
        }
    }
    if stored
        .as_deref()
        .is_some_and(|v| requested.is_some_and(|req| v != req))
    {
        return Err("existing Run is bound to a different DAG".into());
    }
    let dag = requested.map(str::to_string).or(stored).or_else(|| {
        sel.declaration
            .get("defaultDag")
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    let Some(name) = dag else {
        return Ok((None, sel.graph.clone()));
    };
    let options = sel.declaration.get("graphs").and_then(Value::as_object);
    let file = options.and_then(|o| o.get(&name)).and_then(Value::as_str);
    if !valid_identifier(&name) || options.is_none() || file.is_none() {
        return Err(format!("unknown or unconfigured project DAG: {name}"));
    }
    let file = file.unwrap();
    let valid_file = file == "graph.mmd"
        || file
            .strip_prefix("graph-")
            .and_then(|rest| rest.strip_suffix(".mmd"))
            .is_some_and(valid_graph_suffix);
    if !valid_file {
        return Err("invalid project DAG filename".into());
    }
    let graph = sel
        .project
        .join(file)
        .canonicalize()
        .map_err(|_| format!("project DAG file does not exist: {file}"))?;
    if !inside(&sel.project, &graph) || !graph.is_file() {
        return Err("project DAG escapes project directory".into());
    }
    Ok((Some(name), graph))
}
fn valid_graph_suffix(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}
fn source_preset(sel: &SelectedProject, name: &str) -> Result<(String, String, String), String> {
    if !valid_identifier(name) {
        return Err("invalid --source identifier".into());
    }
    let Some(entry) = sel
        .declaration
        .get("sources")
        .and_then(Value::as_object)
        .and_then(|m| m.get(name))
    else {
        return Err(format!("unknown or unconfigured project source: {name}"));
    };
    let dag = entry["dag"].as_str().unwrap_or("");
    let config = entry["config"].as_str().unwrap_or("");
    let run_file = entry["runFile"].as_str().unwrap_or("");
    let reserved = [
        "source-reference.json",
        "review-stages.json",
        "review-mode.json",
        "source-manifest.json",
        "fixture-policy.json",
        "campaign.json",
        "neo-project-run.result.json",
    ];
    let config_valid = config.starts_with("config/")
        && config.ends_with(".json")
        && config[7..]
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'/' | b'-'))
        && !config.split('/').any(|s| s == ".." || s == ".")
        && config
            .as_bytes()
            .get(7)
            .is_some_and(|c| c.is_ascii_alphanumeric());
    if !entry.is_object()
        || !valid_identifier(dag)
        || !config_valid
        || !run_file.ends_with(".json")
        || !valid_identifier(run_file.trim_end_matches(".json"))
        || reserved.contains(&run_file)
    {
        return Err(format!("invalid project source declaration: {name}"));
    }
    let actual = sel
        .project
        .join(config)
        .canonicalize()
        .map_err(|_| format!("project source config not found: {config}"))?;
    if !inside(&sel.project, &actual) || !actual.is_file() {
        return Err(format!("project source config escapes project: {config}"));
    }
    let raw = fs::read(&actual).map_err(|e| e.to_string())?;
    if raw.len() > 128 * 1024 {
        return Err("project source config is too large".into());
    }
    let value: Value =
        serde_json::from_slice(&raw).map_err(|e| format!("invalid project source config: {e}"))?;
    if !value.is_object() || value["schemaVersion"] != 1 {
        return Err("project source config must be a JSON object with schemaVersion 1".into());
    }
    Ok((name.to_string(), dag.to_string(), run_file.to_string()))
}
fn check_reviewable(sel: &SelectedProject, dag: Option<&str>, graph: &Path) -> Result<(), String> {
    let reviewable = sel
        .declaration
        .get("reviewableDags")
        .and_then(Value::as_object)
        .and_then(|map| dag.and_then(|d| map.get(d)));
    let Some(value) = reviewable else {
        return Ok(());
    };
    let Some(stages) = value.as_array() else {
        return Err("invalid reviewableDags entry for selected Graph".into());
    };
    let content = fs::read_to_string(graph).map_err(|e| e.to_string())?;
    let mut seen = HashSet::new();
    if stages.is_empty()
        || stages.iter().any(|s| {
            let Some(name) = s.as_str() else {
                return true;
            };
            !valid_identifier(name)
                || !seen.insert(name)
                || !content.contains(&format!("[agent:{name}]"))
        })
    {
        return Err("invalid reviewableDags entry for selected Graph".into());
    }
    Ok(())
}
fn preflight(sel: &SelectedProject) -> Result<(), String> {
    let Some(script) = sel.declaration.pointer("/preflight/script") else {
        return Ok(());
    };
    let Some(relative) = script.as_str() else {
        return Err("invalid project preflight script".into());
    };
    let valid = relative
        .strip_prefix("scripts/")
        .and_then(|s| s.strip_suffix(".mjs"))
        .is_some_and(|base| {
            !base.is_empty()
                && base
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'))
        });
    if !valid {
        return Err("invalid project preflight script".into());
    }
    let path = sel
        .project
        .join(relative)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !inside(&sel.project, &path) || !path.is_file() {
        return Err("invalid project preflight script path".into());
    }
    Err("project preflight script execution is not yet supported by native dry-run preview".into())
}
pub struct Prepared {
    pub options: Options,
    pub selected: SelectedProject,
    pub graph: PathBuf,
    pub dag: Option<String>,
    pub source: Option<(String, String, String)>,
    pub run_dir: Option<PathBuf>,
    pub discovery: bool,
    pub discovery_domain: Option<String>,
    pub reviewable: Option<Vec<String>>,
    pub preview: Value,
}

pub fn prepare(args: &[String]) -> Result<Prepared, String> {
    let options = parse(args)?;
    let project_name = options.project.as_deref().unwrap();
    let w = crate::workspace::load()?;
    let selected = safe_project(&w.neo_root, project_name)?;
    if git_root(&selected.project).as_deref() != Some(&selected.project) {
        return Err("NEO_ROOT projects must be independent Git repositories".into());
    }
    let repo_id = env::var("NEO_RELAY_REPOSITORY").unwrap_or_else(|_| project_name.to_string());
    if repo_id != project_name {
        return Err("Relay repository identity must match local Git project name".into());
    }
    require_run_git_config(&selected)?;
    if let Some(url) = options.url.as_deref() {
        validate_url(url, &selected)?;
    }
    let run_dir = options
        .path
        .as_ref()
        .map(|path| validate_run_path(Path::new(path), &selected))
        .transpose()?;
    let source = if let Some(name) = options.source.as_deref() {
        Some(source_preset(&selected, name)?)
    } else {
        recover_unbound_source(&selected, run_dir.as_deref())?
    };
    let source_dag = source.as_ref().map(|s| s.1.as_str());
    let (dag, graph) = selected_graph(
        &selected,
        options.dag.as_deref().or(source_dag),
        run_dir.as_deref(),
    )?;
    if let Some((name, from, _)) = &source {
        if dag.as_deref() != Some(from.as_str()) {
            return Err(format!(
                "source {name} is declared for DAG {from}, not {}",
                dag.as_deref().unwrap_or("null")
            ));
        }
    }
    check_reviewable(&selected, dag.as_deref(), &graph)?;
    let dag_input = selected
        .declaration
        .get("dagInputs")
        .and_then(Value::as_object)
        .and_then(|m| dag.as_deref().and_then(|k| m.get(k)));
    let discovery_allowed = dag_input.is_some_and(|v| v["type"] == "discovery");
    if let Some(value) = dag_input {
        if value
            .get("domain")
            .is_some_and(|d| d != "video" && d != "general")
        {
            return Err("unsupported named DAG discovery domain".into());
        }
        if !value.is_object() || !discovery_allowed {
            return Err("unsupported named DAG input configuration".into());
        }
    }
    let is_url = options.url.is_some();
    let is_path = options.path.is_some();
    let discovery = !is_url && !is_path;
    if discovery && !discovery_allowed {
        return Err("project run requires --url URL or --path PATH unless the selected DAG declares discovery input".into());
    }
    if source.is_some() && !discovery_allowed {
        return Err("project source requires a discovery-enabled DAG".into());
    }
    if is_path && selected.declaration["input"]["type"] == "url" {
        let run_dir = run_dir.as_ref().unwrap();
        if !run_dir.join(".neo-project-run.json").exists()
            && (selected.declaration["input"]["preparedPath"] != true
                || (!discovery_allowed
                    && (!run_dir.join("campaign.json").exists()
                        || !run_dir.join("evidence/original-source.json").exists())))
        {
            return Err("URL project --path accepts only an existing bound Run, unless preparedPath is enabled with canonical source evidence".into());
        }
    }
    preflight(&selected)?;
    let preview = run_dir.clone().unwrap_or_else(|| {
        selected.project.join("runs").join(format!(
            "{}-{}-<unique>",
            Utc::now().format("%Y-%m-%d"),
            if discovery { "discovery" } else { "source" }
        ))
    });
    let mut result = json!({
        "project":project_name,"runPath":preview.to_string_lossy(),
        "inputType":if discovery{"discovery"}else if is_url{"url"}else{"path"},"dryRun":true,
    });
    if let Some(name) = &dag {
        result["dag"] = json!(name);
    }
    if let Some((name, _, run_file)) = &source {
        result["source"] = json!(name);
        result["sourceBrief"] = json!(run_file);
    }
    let discovery_domain = dag_input
        .and_then(|v| v.get("domain"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let prepared_discovery = is_path
        && discovery_allowed
        && run_dir.as_ref().is_some_and(|p| {
            !p.join(".neo-project-run.json").exists() && !p.join("campaign.json").exists()
        });
    let reviewable = selected
        .declaration
        .get("reviewableDags")
        .and_then(Value::as_object)
        .and_then(|m| dag.as_deref().and_then(|name| m.get(name)))
        .and_then(Value::as_array)
        .map(|stages| {
            stages
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        });
    Ok(Prepared {
        options,
        selected,
        graph,
        dag,
        source,
        run_dir,
        discovery: discovery || prepared_discovery,
        discovery_domain,
        reviewable,
        preview: result,
    })
}

pub fn run(args: &[String]) -> Result<Value, String> {
    if !args.iter().any(|arg| arg == "--dry-run") {
        return Err(
            "project run is not yet supported in neo-rs (only --dry-run preview is implemented)"
                .into(),
        );
    }
    Ok(prepare(args)?.preview)
}
