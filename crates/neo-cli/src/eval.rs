//! Native Neo Project Eval CLI. Relay owns Worker prompt construction; Rust
//! owns selection, case checks, reporting and Codex invocation. JavaScript
//! evaluation cases retain their explicit project-owned test runner.
use crate::{process_guard, workspace};
use regex::Regex;
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    collections::{BTreeSet, HashSet},
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use uuid::Uuid;
const HELP:&str="Usage: neo eval run --project NAME [--case ID | --dag [--smoke]] [--model MODEL] [--profile CODEX_PROFILE] [--reasoning high] [--dry-run]\n       neo eval list --project NAME [--dag]\n       neo eval audit\n       neo eval report --job-id ID [--task-id ID [--execution-id UUID]] [--project NAME] [--repo REPO] [--mode generate|latest]\n\nCases live at <project>/.evals/cases.json; each run saves evidence under <project>/.evals/reports/.\n";
#[derive(Default)]
struct Flags {
    project: Option<String>,
    case: Option<String>,
    model: Option<String>,
    profile: Option<String>,
    reasoning: Option<String>,
    adapter: Option<String>,
    dag: bool,
    smoke: bool,
    dry_run: bool,
}
fn regex(p: &str) -> Regex {
    Regex::new(p).expect("constant Eval regex")
}
fn options(args: &[String]) -> Result<Flags, String> {
    let mut o = Flags::default();
    let mut seen = HashSet::<String>::new();
    let mut i = 0;
    while i < args.len() {
        let key = args[i].as_str();
        if !seen.insert(key.to_string()) {
            return Err(format!("Repeated eval option: {key}"));
        }
        match key {
            "--dag" => o.dag = true,
            "--smoke" => o.smoke = true,
            "--dry-run" => o.dry_run = true,
            "--project" | "--case" | "--model" | "--profile" | "--reasoning" | "--adapter" => {
                let value = args
                    .get(i + 1)
                    .filter(|v| !v.is_empty() && !v.starts_with("--"))
                    .ok_or_else(|| format!("{key} requires a value"))?
                    .clone();
                match key {
                    "--project" => o.project = Some(value),
                    "--case" => o.case = Some(value),
                    "--model" => o.model = Some(value),
                    "--profile" => o.profile = Some(value),
                    "--reasoning" => o.reasoning = Some(value),
                    _ => o.adapter = Some(value),
                }
                i += 1;
            }
            _ => return Err(format!("Unknown eval option: {key}")),
        }
        i += 1;
    }
    if o.dag && o.case.is_some() {
        return Err("--dag cannot be combined with --case".into());
    }
    if o.smoke && !o.dag {
        return Err("--smoke requires --dag".into());
    }
    if o.reasoning
        .as_deref()
        .is_some_and(|s| !matches!(s, "low" | "medium" | "high" | "xhigh"))
    {
        return Err("Invalid Codex reasoning effort".into());
    }
    if o.profile
        .as_deref()
        .is_some_and(|s| !regex("^[a-zA-Z0-9_-]+$").is_match(s))
    {
        return Err("Invalid Codex profile".into());
    }
    if o.profile.is_some() && o.model.is_none() {
        return Err("Explicit Codex profile requires --model".into());
    }
    if o.adapter.as_deref().is_some_and(|s| s != "codex") {
        return Err("Only the locally authenticated Codex adapter is supported".into());
    }
    Ok(o)
}
fn capture(exe: &str, args: &[&str], cwd: &Path, timeout: u64) -> Result<String, String> {
    let mut cmd = Command::new(exe);
    cmd.args(args).current_dir(cwd);
    let result = process_guard::capture(&mut cmd, Duration::from_secs(timeout), 6 * 1024 * 1024)?;
    if !result.status.success() {
        return Err(format!(
            "{exe} command failed: {}",
            result.status.code().unwrap_or(-1)
        ));
    }
    String::from_utf8(result.stdout).map_err(|_| "Invalid UTF-8 CLI response".into())
}
fn project(opts: &Flags) -> Result<(String, PathBuf, PathBuf), String> {
    let ws = workspace::load()?;
    let name = if let Some(value) = &opts.project {
        value.clone()
    } else {
        let current = env::current_dir()
            .map_err(|e| e.to_string())?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if current.parent() != Some(ws.neo_root.as_path()) {
            return Err(
                "Specify --project NAME (or run inside an independent NEO_ROOT Project)".into(),
            );
        }
        current
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_string()
    };
    if !regex(r"^[A-Za-z0-9][A-Za-z0-9._-]*$").is_match(&name) {
        return Err(
            "Specify --project NAME (or run inside an independent NEO_ROOT Project)".into(),
        );
    }
    let dir = ws.neo_root.join(&name);
    if !dir.join(".git").exists() || !dir.join("AGENTS.md").is_file() {
        return Err(format!("Unknown Neo Project: {name}"));
    }
    let dir = dir
        .canonicalize()
        .map_err(|_| "Project directory unavailable")?;
    if dir.parent() != Some(ws.neo_root.as_path()) {
        return Err("Neo Eval requires an independent Git project directly under NEO_ROOT".into());
    }
    if capture("git", &["rev-parse", "--show-toplevel"], &dir, 10)?.trim() != dir.to_string_lossy()
    {
        return Err("Neo Eval requires an independent project Git repository".into());
    }
    Ok((name, dir, ws.harness_root))
}
fn cases(project: &Path, name: &str) -> Result<Vec<Value>, String> {
    let file = project.join(".evals/cases.json");
    if !file.exists() {
        return Err(format!("NOT_EVALUATED: {name} has no .evals/cases.json"));
    }
    let meta = fs::symlink_metadata(&file).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 2 * 1024 * 1024 {
        return Err("Unsafe Eval cases manifest".into());
    }
    let rows: Value = serde_json::from_slice(&fs::read(file).map_err(|e| e.to_string())?)
        .map_err(|_| "Invalid Eval cases JSON")?;
    let rows = rows
        .as_array()
        .filter(|v| !v.is_empty())
        .ok_or("Project eval cases must be a nonempty array")?;
    let mut names = HashSet::new();
    for row in rows {
        let id = row["id"].as_str().ok_or("Invalid case identity")?;
        if !names.insert(id) {
            return Err("Duplicate eval case IDs".into());
        }
    }
    Ok(rows.to_vec())
}
fn role_name(role: &str) -> bool {
    regex(r"^[a-z0-9-]+$").is_match(role)
}
fn graph_roles(project: &Path) -> Result<Vec<String>, String> {
    let source = fs::read_to_string(project.join("graph.mmd"))
        .map_err(|_| "Project DAG eval requires graph.mmd")?;
    if source.len() > 256 * 1024 {
        return Err("Project DAG exceeds limits".into());
    }
    let labels = regex(r"(?i)\bagent\s*:\s*([a-z][a-z0-9-]+)");
    let mut seen = HashSet::<String>::new();
    let mut roles = Vec::new();
    for line in source.lines() {
        if line.trim_start().starts_with("%%") {
            continue;
        }
        for matched in labels.captures_iter(line) {
            let role = matched[1].to_lowercase();
            if seen.insert(role.clone()) {
                roles.push(role);
            }
        }
    }
    if roles.is_empty() {
        return Err(
            "Project DAG contains no Agent roles; use authoritative Relay graph for execution"
                .into(),
        );
    }
    Ok(roles)
}
fn safe_project_file(path: &str, root: &Path) -> Result<PathBuf, String> {
    let requested = if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        root.join(path)
    };
    let canonical = requested
        .canonicalize()
        .map_err(|_| format!("Missing/unsafe project file: {path}"))?;
    if canonical == root || !canonical.starts_with(root) {
        return Err(format!("Missing/unsafe project file: {path}"));
    }
    if !canonical.is_file() {
        return Err(format!("Missing/unsafe project file: {path}"));
    }
    Ok(canonical)
}
fn validate(case: &Value, project: &Path, harness: &Path) -> Result<String, String> {
    let id = case["id"].as_str().unwrap_or("");
    let role = case["role"].as_str().unwrap_or("");
    if !regex(r"^[-\w]+$").is_match(id)
        || !role_name(role)
        || case["capability"].as_str().unwrap_or("").is_empty()
    {
        return Err("Invalid case identity".into());
    }
    if !project.join(format!("agents/{role}.agent.md")).exists()
        && !harness.join(format!("agents/{role}.agent.md")).exists()
    {
        return Err(format!("Missing agent role: {role}"));
    }
    let typ = case["type"].as_str().unwrap_or("decision");
    match typ {
        "decision" => {
            let choices = case["choices"]
                .as_array()
                .filter(|x| x.len() >= 2)
                .ok_or_else(|| format!("Invalid decision case: {id}"))?;
            if case["task"].as_str().unwrap_or("").is_empty()
                || !choices.contains(&case["expectedDecision"])
            {
                return Err(format!("Invalid decision case: {id}"));
            }
            if let Some(paths) = case["references"].as_array() {
                for path in paths {
                    safe_project_file(path.as_str().ok_or("Invalid reference")?, project)?;
                }
            }
        }
        "node-tests" => {
            let files = case["testFiles"]
                .as_array()
                .filter(|f| !f.is_empty())
                .ok_or_else(|| format!("Missing node test files: {id}"))?;
            for file in files {
                let raw = file.as_str().ok_or("Invalid Node test file path")?;
                let path = safe_project_file(raw, project)?;
                let parent = project.join("test");
                if path.parent() != Some(parent.as_path())
                    || !path
                        .file_name()
                        .and_then(|v| v.to_str())
                        .is_some_and(|s| regex(r"^[^./][\w.-]*\.test\.mjs$").is_match(s))
                {
                    return Err(format!("Test file must be project test/*.test.mjs: {raw}"));
                }
            }
        }
        _ => return Err(format!("Unsupported case type: {typ}")),
    }
    Ok(typ.into())
}
fn selection<'a>(opts: &Flags, rows: &'a [Value], roles: Option<&Vec<String>>) -> Vec<&'a Value> {
    if let Some(id) = &opts.case {
        return rows
            .iter()
            .filter(|r| r["id"].as_str() == Some(id))
            .collect();
    }
    if let Some(roles) = roles {
        if opts.smoke {
            return roles
                .iter()
                .filter_map(|role| {
                    rows.iter().find(|r| {
                        r["role"].as_str() == Some(role.as_str())
                            && r["type"].as_str().unwrap_or("decision") == "decision"
                    })
                })
                .collect();
        }
        return rows
            .iter()
            .filter(|r| {
                roles
                    .iter()
                    .any(|role| r["role"].as_str() == Some(role.as_str()))
            })
            .collect();
    }
    rows.iter().collect()
}
fn report_root(project: &Path) -> Result<PathBuf, String> {
    let path = project.join(".evals/reports");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    let name = format!(
        "{}-{}",
        chrono::Utc::now().to_rfc3339().replace(':', "-"),
        &Uuid::new_v4().simple().to_string()[..8]
    );
    let root = path.join(name);
    fs::create_dir(&root).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    Ok(root)
}
fn write_report(path: &Path, text: &str) -> Result<(), String> {
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt;
    let mut options = fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(path).map_err(|e| e.to_string())?;
    use std::io::Write;
    file.write_all(text.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())
}
fn write_json(path: &Path, v: &Value) -> Result<(), String> {
    write_report(
        path,
        &serde_json::to_string_pretty(v).map_err(|e| e.to_string())?,
    )
}
fn builder(case: &Value, project: &Path, workspace: &Path, folder: &Path) -> Result<Value, String> {
    let role = case["role"].as_str().unwrap_or("");
    let id = case["id"].as_str().unwrap_or("");
    let choices = case["choices"]
        .as_array()
        .ok_or("Case choices missing")?
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>()
        .join(", ");
    let refs = case["references"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    let text=format!("[Neo Project Eval Case: {id}; capability: {}]\nEvaluate the following simulated Task. Do not carry out real actions. Respond ONLY with\nJSON {{\"decision\":\"one of the choices\",\"actions\":[\"concrete intended actions\"],\"reason\":\"grounded rationale\"}}.\nChoose exactly one decision from: {choices}.\nScenario: {}\n{}",
        case["capability"].as_str().unwrap_or(""),case["task"].as_str().unwrap_or(""),
        if refs.is_empty(){String::new()}else{format!("Relevant project contract references (read only if needed): {refs}")});
    let input = folder.join(format!("{id}.builder-input.json"));
    let output = folder.join(format!("{id}.builder-output.json"));
    write_json(
        &input,
        &json!({"projectPath":project,"agentName":role,"caseId":id,"taskInput":text}),
    )?;
    let mut cmd = Command::new(crate::prompt_parts_client::relay_cli()?);
    cmd.args(["prompt", "--eval-file"])
        .arg(&input)
        .args(["--adapter", "codex", "--prepare-harness", "--output"])
        .arg(&output)
        .current_dir(project)
        .env("AGENTS_RELAY_WORKSPACE_ROOT", workspace)
        .env(
            "AGENTS_RELAY_PROMPT_REFERENCE_DIR",
            folder.join("snapshots"),
        );
    let response = process_guard::capture(&mut cmd, Duration::from_secs(30), 4 * 1024 * 1024)?;
    if !response.status.success() {
        return Err(format!(
            "Relay PromptBuilder failed for {id}: {}",
            String::from_utf8_lossy(&response.stderr).trim()
        ));
    }
    let built: Value =
        serde_json::from_slice(&fs::read(output).map_err(|_| "Relay Builder output unavailable")?)
            .map_err(|_| "Relay Builder output invalid JSON")?;
    if built["builder"] != "managedWorkerInput"
        || built["mode"] != "isolated-evaluation"
        || built["agentName"] != role
        || built["adapter"] != "codex"
        || built["productionPrompt"]["system"]
            .as_str()
            .is_none_or(|v| v.is_empty())
        || built["productionPrompt"]["user"]
            .as_str()
            .is_none_or(|v| !v.contains("EVENT SOURCE (exact):"))
        || !built["productionPrompt"]["references"].is_array()
        || built["evaluationPrompt"]["system"]
            .as_str()
            .is_none_or(|v| !v.contains("Isolated Evaluation Safety Contract"))
        || built["evaluationPrompt"]["user"]
            .as_str()
            .is_none_or(|v| !v.contains("[Isolated prompt evaluation mode]"))
        || !built["evaluationPrompt"]["references"].is_array()
    {
        return Err(format!(
            "Relay Builder returned incomplete or mismatched layered prompt for {id}"
        ));
    }
    native_transport_flags(&built)?;
    Ok(built)
}
// Read only the native transport chosen by Relay's Harness Builder.
// Never reconstruct system/developer authority from the User Prompt.
fn native_transport_flags(built: &Value) -> Result<Vec<String>, String> {
    let transport = &built["evaluationTransport"];
    if !matches!(
        transport["nativeGlobal"].as_str(),
        Some("AlreadyConfigured" | "LinkCreated" | "EmptyFileBackedUp")
    ) {
        return Err("Relay Harness Builder did not verify native Codex Global AGENTS.md".into());
    }
    if transport["harness"] != "codex" {
        return Err("Eval requires the native Codex Harness transport".into());
    }
    let flags = transport["flags"]
        .as_array()
        .ok_or("Codex transport lacks flags")?;
    if flags.len() != 4
        || flags[0] != "-c"
        || flags[1] != "project_doc_max_bytes=0"
        || flags[2] != "-c"
    {
        return Err("Unexpected native Codex transport flags".into());
    }
    let declaration = flags[3]
        .as_str()
        .and_then(|v| v.strip_prefix("developer_instructions="))
        .ok_or("Codex transport has no developer instructions")?;
    let declared: String =
        serde_json::from_str(declaration).map_err(|_| "Invalid developer instruction JSON")?;
    if built["evaluationPrompt"]["system"] != declared {
        return Err(
            "Transport developer instructions do not match the evaluated effective Agent".into(),
        );
    }
    flags
        .iter()
        .map(|f| {
            f.as_str()
                .map(str::to_owned)
                .ok_or_else(|| "Invalid transport argument".into())
        })
        .collect()
}
fn codex(
    project: &Path,
    prompt: &str,
    transport_flags: &[String],
    opts: &Flags,
    response: &Path,
) -> Result<(i32, String), String> {
    let mut command = Command::new("codex");
    command
        .args([
            "exec",
            "--sandbox",
            "read-only",
            "--skip-git-repo-check",
            "-C",
        ])
        .arg(project)
        .args(transport_flags);
    if let Some(profile) = &opts.profile {
        command.args(["-p", profile]);
    }
    if let Some(model) = &opts.model {
        command.args(["--model", model]);
    }
    if let Some(effort) = &opts.reasoning {
        command.args(["-c", &format!("model_reasoning_effort={effort}")]);
    }
    command
        .arg("--output-last-message")
        .arg(response)
        .arg("-")
        .current_dir(project);
    let capture = process_guard::capture_with_input(
        &mut command,
        Some(prompt.as_bytes()),
        Duration::from_secs(180),
        4 * 1024 * 1024,
    )?;
    let result = if response.exists() {
        fs::read_to_string(response).map_err(|e| e.to_string())?
    } else {
        String::from_utf8_lossy(&capture.stdout).to_string()
    };
    Ok((capture.status.code().unwrap_or(-1), result))
}
fn evaluate(opts: &Flags, list: bool) -> Result<i32, String> {
    let (name, project, harness) = project(opts)?;
    let workspace = project.parent().ok_or("Invalid Project location")?;
    let rows = cases(&project, &name)?;
    let roles = if opts.dag {
        Some(graph_roles(&project)?)
    } else {
        None
    };
    if let Some(roles) = &roles {
        let missing = roles
            .iter()
            .filter(|role| {
                !rows.iter().any(|c| {
                    c["role"].as_str() == Some(role)
                        && c["type"].as_str().unwrap_or("decision") == "decision"
                })
            })
            .cloned()
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(format!(
                "NOT_EVALUATED: DAG Agent(s) missing decision eval: {}",
                missing.join(", ")
            ));
        }
    }
    let selected = selection(opts, &rows, roles.as_ref());
    if selected.is_empty() {
        return Err(format!(
            "Unknown eval case: {}",
            opts.case.as_deref().unwrap_or("none")
        ));
    }
    for case in &selected {
        validate(case, &project, &harness)?;
    }
    if list {
        let results = selected
            .into_iter()
            .map(|c| {
                json!({"id":c["id"],"role":c["role"],
            "type":c["type"].as_str().unwrap_or("decision"),"capability":c["capability"]})
            })
            .collect::<Vec<_>>();
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({"project":name,"dagRoles":roles,"cases":results}))
                .map_err(|e| e.to_string())?
        );
        return Ok(0);
    }
    let folder = report_root(&project)?;
    let mut results = Vec::<Value>::new();
    let mut failures = 0;
    for case in selected {
        let id = case["id"].as_str().unwrap_or("");
        let role = case["role"].as_str().unwrap_or("");
        let typ = case["type"].as_str().unwrap_or("decision");
        if typ == "node-tests" {
            if opts.dry_run {
                results.push(json!({"id":id,"role":role,"type":typ,"status":"DRY_RUN","testFiles":case["testFiles"]}));
                continue;
            }
            // A project explicitly declares JS `.test.mjs` artifacts. Node is
            // a workload test runner here, never the Neo CLI implementation.
            let mut cmd = Command::new("node");
            cmd.arg("--test");
            for file in case["testFiles"]
                .as_array()
                .ok_or("Node test files missing")?
            {
                cmd.arg(file.as_str().ok_or("Invalid test filename")?);
            }
            cmd.current_dir(&project);
            let result =
                process_guard::capture(&mut cmd, Duration::from_secs(240), 16 * 1024 * 1024)?;
            let mut log = String::from_utf8_lossy(&result.stdout).to_string();
            log.push_str(&String::from_utf8_lossy(&result.stderr));
            write_report(&folder.join(format!("{id}.tests.log")), &log)?;
            let passed = result.status.success();
            if !passed {
                failures += 1;
            }
            results.push(json!({"id":id,"role":role,"type":typ,"status":if passed{"PASS"}else{"FAIL"},
                "exitCode":result.status.code(),"error":Value::Null,"testFiles":case["testFiles"],"log":format!("{id}.tests.log")}));
            continue;
        }
        let built = builder(case, &project, workspace, &folder)?;
        let prompt = built["evaluationPrompt"]["user"]
            .as_str()
            .ok_or("Relay returned no evaluation User Prompt")?;
        let transport = native_transport_flags(&built)?;
        write_report(
            &folder.join(format!("{id}.prompt.json")),
            &serde_json::to_string_pretty(&built["evaluationPrompt"]).map_err(|e| e.to_string())?,
        )?;
        write_report(
            &folder.join(format!("{id}.production.prompt.json")),
            &serde_json::to_string_pretty(&built["productionPrompt"]).map_err(|e| e.to_string())?,
        )?;
        if opts.dry_run {
            results.push(json!({"id":id,"role":role,"type":typ,"status":"DRY_RUN",
                "promptCharacters":prompt.chars().count(),"builder":built["builder"],
                "productionPromptCharacters":built["productionPrompt"]["system"].as_str().unwrap_or("").chars().count()
                   + built["productionPrompt"]["user"].as_str().unwrap_or("").chars().count()}));
            continue;
        }
        let response = folder.join(format!("{id}.response.txt"));
        let (code, text) = codex(&project, prompt, &transport, opts, &response)?;
        let trimmed = text
            .trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();
        let parsed = serde_json::from_str::<Value>(trimmed).unwrap_or(Value::Null);
        let expected = case["expectedDecision"].as_str().unwrap_or("");
        let text = if parsed.is_object() {
            parsed.to_string()
        } else {
            text.clone()
        };
        let lower = text.to_lowercase();
        let required = case["required"].as_array().is_none_or(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .all(|v| lower.contains(&v.to_lowercase()))
        });
        let forbidden = case["forbidden"].as_array().is_none_or(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .all(|v| !lower.contains(&v.to_lowercase()))
        });
        let pass = code == 0 && parsed["decision"] == expected && required && forbidden;
        if !pass {
            failures += 1;
        }
        results.push(json!({"id":id,"role":role,"type":typ,"builder":built["builder"],
            "status":if pass{"PASS"}else{"FAIL"},"expected":expected,"actual":parsed["decision"].as_str(),
            "exitCode":code,"required":required,"forbidden":forbidden,"error":Value::Null,
            "output":text.chars().take(1600).collect::<String>()}));
    }
    let roles_selected = results
        .iter()
        .filter_map(|r| r["role"].as_str())
        .collect::<BTreeSet<_>>();
    let report = json!({"project":name,"dagRoles":roles,"dagCoverage":roles.as_ref().map(|r|json!({"total":r.len(),"selectedRoles":roles_selected})),
        "adapter":"codex","promptSource":"agents-relay/managedWorkerInput","model":opts.model.as_deref().unwrap_or("codex default"),
        "profile":opts.profile,"reasoning":opts.reasoning,"mode":if opts.dry_run{"dry-run"}else{"mixed"},
        "count":results.len(),"executed":if opts.dry_run{0}else{results.len()},
        "passed":results.iter().filter(|v|v["status"]=="PASS").count(),"failed":failures,"results":results});
    let destination = folder.join("report.json");
    write_json(&destination, &report)?;
    println!("{}",serde_json::to_string_pretty(&json!({"project":name,"dagRoles":roles,"mode":report["mode"],
        "executed":report["executed"],"passed":report["passed"],"failed":failures,"report":destination})).map_err(|e|e.to_string())?);
    Ok(if failures == 0 { 0 } else { 1 })
}
fn audit() -> Result<i32, String> {
    let workspace = workspace::load()?;
    let root = &workspace.neo_root;
    let mut projects = fs::read_dir(root)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    projects.sort_by_key(|p| p.file_name());
    let mut count = 0;
    let mut roles = 0;
    let mut covered = 0;
    let mut missing = Vec::<String>::new();
    let mut manifests = Vec::<String>::new();
    let mut dag = serde_json::Map::<String, Value>::new();
    let mut missing_dag = Vec::<String>::new();
    for entry in projects {
        let path = entry.path();
        if !path.is_dir()
            || !path.join(".git").exists()
            || !path.join("AGENTS.md").exists()
            || !path.join("README.md").exists()
            || !path.join("graph.mmd").exists()
        {
            continue;
        }
        if path.canonicalize().ok().as_deref() != Some(path.as_path()) {
            continue;
        }
        if capture("git", &["rev-parse", "--show-toplevel"], &path, 10)
            .ok()
            .map(|s| s.trim().to_string())
            .as_deref()
            != path.to_str()
        {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        count += 1;
        let cases = if path.join(".evals/cases.json").exists() {
            cases(&path, &name)?
        } else {
            manifests.push(name.clone());
            Vec::new()
        };
        let local = path.join("agents");
        let mut locals = Vec::<String>::new();
        if local.is_dir() {
            for item in fs::read_dir(local).map_err(|e| e.to_string())? {
                let path = item.map_err(|e| e.to_string())?.path();
                if let Some(role) = path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .and_then(|s| s.strip_suffix(".agent.md"))
                {
                    locals.push(role.to_string());
                }
            }
        }
        locals.sort();
        let summary = locals
            .iter()
            .map(|role| {
                let hits = cases
                    .iter()
                    .filter(|c| c["role"].as_str() == Some(role))
                    .count();
                roles += 1;
                if hits > 0 {
                    covered += 1;
                } else {
                    missing.push(format!("{name}/{role}"));
                }
                format!("{role}={hits}")
            })
            .collect::<Vec<_>>();
        println!(
            "{name}: {}; cases {}",
            if summary.is_empty() {
                "NO_LOCAL_WORKER_ROLES (NOT_EVALUATED)".into()
            } else {
                format!("roles {}", summary.join(", "))
            },
            cases.len()
        );
        let dag_roles = graph_roles(&path)?;
        let decisions = dag_roles
            .iter()
            .map(|role| {
                let hits = cases
                    .iter()
                    .filter(|c| {
                        c["role"].as_str() == Some(role)
                            && c["type"].as_str().unwrap_or("decision") == "decision"
                    })
                    .count();
                if hits == 0 {
                    missing_dag.push(format!("{name}/{role}"));
                }
                json!({"role":role,"caseCount":hits})
            })
            .collect::<Vec<_>>();
        dag.insert(name,json!({"agents":decisions,"missingDecisionCases":dag_roles.into_iter().filter(|r|
            !cases.iter().any(|c|c["role"].as_str()==Some(r)&&c["type"].as_str().unwrap_or("decision")=="decision")).collect::<Vec<_>>()}));
    }
    println!("{}",serde_json::to_string_pretty(&json!({"projects":count,"roles":roles,"rolesWithCases":covered,
        "rolesWithoutCases":missing,"projectsMissingEvalManifest":manifests,"dagCoverage":dag,"missingDagDecisionCases":missing_dag})).map_err(|e|e.to_string())?);
    Ok(
        if missing.is_empty() && manifests.is_empty() && missing_dag.is_empty() {
            0
        } else {
            1
        },
    )
}
pub fn run(args: &[String]) -> Result<i32, String> {
    let (sub, params) = args
        .split_first()
        .map_or(("run", args), |(s, rest)| (s.as_str(), rest));
    if matches!(sub, "--help" | "-h") && params.is_empty() {
        print!("{HELP}");
        return Ok(0);
    }
    match sub {
        "report" => crate::eval_report::run(params),
        "compare" => crate::eval_report::compare::run(params),
        "run" => evaluate(&options(params)?, false),
        "list" => evaluate(&options(params)?, true),
        "audit" if params.is_empty() => audit(),
        _ => Err("usage: neo eval run|list|audit|report|compare [options]".into()),
    }
}
