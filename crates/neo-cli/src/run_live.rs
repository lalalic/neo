//! Native single-Run submission to the existing authoritative Agents Relay.
//! Does not implement Relay scheduling or duplicate its persistent state.
use crate::{
    run_dry::{self, Prepared},
    run_files::{self, RunFiles},
    run_git,
};
use chrono::Utc;
use serde::Serialize;
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    env, fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Binding<'a> {
    schema_version: u8,
    project: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    dag: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<&'a str>,
    run_path: &'a str,
    job_id: &'a str,
    task_id: &'a str,
    repository: &'a str,
    evidence: &'a str,
    objective: &'a str,
    task_input: &'a str,
    output: &'a str,
}
fn read_capped<R: Read>(mut reader: R) -> Result<(Vec<u8>, bool), String> {
    let mut data = Vec::new();
    let mut overflow = false;
    let mut chunk = [0u8; 8192];
    loop {
        let n = reader.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        if data.len() + n > 4 * 1024 * 1024 {
            overflow = true;
        } else {
            data.extend_from_slice(&chunk[..n]);
        }
    }
    Ok((data, overflow))
}
fn relay(args: &[String]) -> Result<Value, String> {
    if env::var_os("NEO_RELAY_CLI").is_some() {
        return Err(
            "NEO_RELAY_CLI (Node.js shim) is unsupported in Rust Harness; use NEO_RELAY_EXECUTABLE"
                .into(),
        );
    }
    let binary = env::var("NEO_RELAY_EXECUTABLE").unwrap_or_else(|_| "agents-relay".into());
    let mut command = Command::new(&binary);
    command.args(args);
    if let Ok(port) = env::var("NEO_RELAY_CONTROL_PORT") {
        let parsed = port
            .parse::<u16>()
            .map_err(|_| "NEO_RELAY_CONTROL_PORT must be a valid nonzero port".to_string())?;
        if parsed == 0 {
            return Err("NEO_RELAY_CONTROL_PORT must be a valid nonzero port".into());
        }
        command.arg("--port").arg(port);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child=command.spawn().map_err(|e|format!("Agents Relay command failed (spawn error: {e}); run artifacts and recovery binding are preserved"))?;
    let stdout = child.stdout.take().ok_or("Relay stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("Relay stderr unavailable")?;
    let out = thread::spawn(move || read_capped(stdout));
    let err = thread::spawn(move || read_capped(stderr));
    let now = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if now.elapsed() < Duration::from_secs(120) => {
                thread::sleep(Duration::from_millis(40))
            }
            Ok(None) => {
                timed_out = true;
                let _ = child.kill();
                break child.wait().map_err(|e| e.to_string())?;
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Agents Relay command failed (wait error: {error}); run artifacts and recovery binding are preserved"));
            }
        }
    };
    let (stdout, out_too_large) = out.join().map_err(|_| "Relay stdout reader failed")??;
    let (_stderr, err_too_large) = err.join().map_err(|_| "Relay stderr reader failed")??;
    if timed_out || out_too_large || err_too_large || !status.success() {
        return Err(format!(
            "Agents Relay command failed ({}); run artifacts and recovery binding are preserved",
            if timed_out {
                "timeout".into()
            } else if out_too_large || err_too_large {
                "output limit".into()
            } else {
                status
                    .code()
                    .map_or_else(|| "signal".into(), |x| x.to_string())
            }
        ));
    }
    serde_json::from_slice(&stdout).map_err(|_| {
        "Agents Relay returned invalid JSON; run artifacts and recovery binding are preserved"
            .into()
    })
}

fn relay_args(slice: &[&str]) -> Vec<String> {
    slice.iter().map(|s| s.to_string()).collect()
}
fn identifier(v: &Value, label: &str, strict: bool) -> Result<String, String> {
    let nested = v
        .get("job")
        .and_then(|j| j.get("id"))
        .unwrap_or(&Value::Null);
    let value = v.get("id").or_else(|| v.get("job")).unwrap_or(nested);
    let value = if value.is_object() { nested } else { value };
    let text = if let Some(s) = value.as_str() {
        s.to_string()
    } else if let Some(n) = value.as_u64() {
        n.to_string()
    } else {
        String::new()
    };
    let digit = text.bytes().all(|c| c.is_ascii_digit())
        && text.starts_with(|c: char| ('1'..='9').contains(&c));
    let general = !text.is_empty()
        && text
            .bytes()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric())
        && text
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'));
    if if strict { !digit } else { !general } {
        return Err(format!(
            "Agents Relay {label} response did not include a valid id"
        ));
    }
    Ok(text)
}
/// The OS releases this exclusive lock when the owning CLI exits/crashes.
/// No lease, timeout state, lockfile, or database lock authority is created.
#[cfg(unix)]
struct RunDirectoryLock(std::fs::File);
#[cfg(unix)]
impl RunDirectoryLock {
    fn acquire(path: &Path) -> Result<Self, String> {
        use std::os::fd::AsRawFd;
        let file = std::fs::File::open(path)
            .map_err(|e| format!("Cannot lock private Run directory: {e}"))?;
        loop {
            let status = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
            if status == 0 {
                return Ok(Self(file));
            }
            let error = std::io::Error::last_os_error();
            if error.kind() != std::io::ErrorKind::Interrupted {
                return Err(format!(
                    "Cannot acquire exclusive Run process lock: {error}"
                ));
            }
        }
    }
}
#[cfg(unix)]
impl Drop for RunDirectoryLock {
    fn drop(&mut self) {
        use std::os::fd::AsRawFd;
        let _ = unsafe { libc::flock(self.0.as_raw_fd(), libc::LOCK_UN) };
    }
}

fn run_path(prepared: &Prepared) -> Result<PathBuf, String> {
    if let Some(dir) = &prepared.run_dir {
        return Ok(dir.clone());
    }
    let base = prepared.selected.project.join("runs");
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let root = base.canonicalize().map_err(|e| e.to_string())?;
    if !root.starts_with(&prepared.selected.project) {
        return Err("project runs directory resolves outside the project".into());
    }
    let prefix = if prepared.discovery {
        "discovery"
    } else {
        "source"
    };
    for _ in 0..4 {
        let id = Uuid::new_v4().simple().to_string();
        let path = root.join(format!(
            "{}-{}-{}",
            Utc::now().format("%Y-%m-%d"),
            prefix,
            &id[..8]
        ));
        match fs::create_dir(&path) {
            Ok(()) => {
                #[cfg(unix)]
                fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
                    .map_err(|e| e.to_string())?;
                return path.canonicalize().map_err(|e| e.to_string());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("cannot allocate unique private Run directory".into())
}
fn task_rows(value: &Value) -> Vec<Value> {
    let list = if value.is_array() {
        value.as_array()
    } else {
        value.get("tasks").and_then(Value::as_array)
    };
    list.cloned().unwrap_or_default()
}
fn file_text(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}
enum RunAction {
    Response(Value),
    Foreground {
        response: Value,
        job: String,
        task: String,
        project: String,
        workspace: PathBuf,
    },
}

fn relay_foreground(project: &str, job: &str, task: &str, workspace: &Path) -> Result<(), String> {
    if env::var_os("NEO_RELAY_CLI").is_some() {
        return Err("NEO_RELAY_CLI (Node.js shim) is unsupported in Rust Harness".into());
    }
    let binary = env::var("NEO_RELAY_EXECUTABLE").unwrap_or_else(|_| "agents-relay".into());
    let mut command = Command::new(binary);
    command.args([
        "job",
        "run",
        "--repo",
        project,
        "--id",
        job,
        "--task-id",
        task,
        "--workspace-root",
        workspace.to_str().ok_or("invalid workspace path")?,
        "--foreground",
    ]);
    if let Ok(port) = env::var("NEO_RELAY_CONTROL_PORT") {
        let value = port
            .parse::<u16>()
            .map_err(|_| "NEO_RELAY_CONTROL_PORT must be a valid nonzero port".to_string())?;
        if value == 0 {
            return Err("NEO_RELAY_CONTROL_PORT must be a valid nonzero port".into());
        }
        command.arg("--port").arg(port);
    }
    let status=command.stdin(Stdio::inherit()).stdout(Stdio::inherit()).stderr(Stdio::inherit())
        .status().map_err(|e|format!("Agents Relay foreground execution failed: {e}; durable Job and Run binding are preserved"))?;
    if !status.success() {
        return Err(format!("Agents Relay foreground execution exited ({}); durable Job and Run binding are preserved",
            status.code().map_or_else(||"signal".into(),|c|c.to_string())));
    }
    Ok(())
}

fn bound(
    prepared: &Prepared,
    run: &Path,
    files: &RunFiles,
    job: &str,
    task: &str,
) -> Result<RunAction, String> {
    let project = prepared.options.project.as_deref().unwrap_or_default();
    let job_object = relay(&relay_args(&[
        "job", "show", "--repo", project, "--id", job,
    ]))?;
    if job_object["repository"] != project
        || job_object["projectRoot"] != prepared.selected.project.to_string_lossy().as_ref()
    {
        return Err("existing Relay Job repository or projectRoot does not match this independent Git repository".into());
    }
    let rows = relay(&relay_args(&[
        "task", "list", "--repo", project, "--id", job,
    ]))?;
    let found = task_rows(&rows)
        .into_iter()
        .find(|v| {
            v.get("id").or_else(|| v.get("taskId")).is_some_and(|x| {
                x.as_str() == Some(task) || x.as_u64().is_some_and(|n| n.to_string() == task)
            })
        })
        .ok_or("Atomic Coordinator Task missing from Relay Job")?;
    if found["input"] != file_text(&files.task_input)?
        || found["agentGraph"] != file_text(&prepared.graph)?
        || found["output"]["kind"] != "file"
        || found["output"]["path"] != files.output.to_string_lossy().as_ref()
    {
        return Err(
            "existing Relay Task does not match this canonical Run input, output, and Agent Graph"
                .into(),
        );
    }
    let mut state = job_object["state"].as_str().unwrap_or("").to_string();
    if prepared.options.foreground && matches!(state.as_str(), "DRAFT" | "ACTIVE") {
        let mut response = json!({"project":project,"runPath":run.to_string_lossy(),"jobId":job,"taskId":task,"status":state,"foreground":true});
        if let Some(dag) = &prepared.dag {
            response["dag"] = json!(dag);
        }
        if let Some(source) = prepared
            .source
            .as_ref()
            .map(|v| v.0.as_str())
            .or_else(|| files.saved.as_ref().and_then(|v| v["source"].as_str()))
        {
            response["source"] = json!(source);
        }
        return Ok(RunAction::Foreground {
            response,
            job: job.into(),
            task: task.into(),
            project: project.into(),
            workspace: prepared.selected.root.clone(),
        });
    }
    if state == "DRAFT" {
        let schedule = relay(&relay_args(&[
            "job",
            "run",
            "--repo",
            project,
            "--id",
            job,
            "--task-id",
            task,
            "--workspace-root",
            prepared
                .selected
                .root
                .to_str()
                .ok_or("invalid workspace path")?,
        ]))?;
        if schedule["scheduled"] != true || schedule["state"] != "ACTIVE" {
            return Err("Relay Coordinator activation not acknowledged".into());
        }
        state = "ACTIVE".into();
    }
    if state != "ACTIVE" && state != "COMPLETED" {
        return Err(format!("Bound Job is not active or completed: {state}"));
    }
    let mut output = json!({"project":project,"runPath":run.to_string_lossy(),"jobId":job,"taskId":task,"status":state});
    if let Some(dag) = &prepared.dag {
        output["dag"] = json!(dag);
    }
    if let Some(source) = prepared
        .source
        .as_ref()
        .map(|v| v.0.as_str())
        .or_else(|| files.saved.as_ref().and_then(|v| v["source"].as_str()))
    {
        output["source"] = json!(source);
    }
    if state == "COMPLETED" {
        output["reused"] = json!(true);
    }
    Ok(RunAction::Response(output))
}
fn job_title(project: &str, run: &Path) -> String {
    let p = project
        .split(['-', '_'])
        .map(|word| {
            if word == "vlog" {
                "Vlog".to_string()
            } else {
                let mut c = word.chars();
                c.next()
                    .map(|first| first.to_uppercase().collect::<String>() + c.as_str())
                    .unwrap_or_default()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    let n = run
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .replace(['-', '_'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    format!("{p} · {n}").chars().take(120).collect()
}
fn validate_saved_source(run: &Path, files: &RunFiles) -> Result<(), String> {
    let Some(saved) = files.saved.as_ref() else {
        return Ok(());
    };
    let Some(source) = saved.get("source").and_then(Value::as_str) else {
        return Ok(());
    };
    let evidence: Value =
        serde_json::from_slice(&fs::read(&files.evidence).map_err(|e| e.to_string())?)
            .map_err(|_| "bound Run has unreadable source evidence".to_string())?;
    let brief = evidence
        .get("sourceBrief")
        .and_then(Value::as_str)
        .unwrap_or("");
    let name = brief.strip_suffix(".json").unwrap_or("");
    let valid = !name.is_empty()
        && name.bytes().next().is_some_and(|b| b.is_ascii_lowercase())
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if evidence["source"] != source || !valid {
        return Err("bound Run source evidence does not match source binding".into());
    }
    let file = run.join(brief);
    let metadata = fs::symlink_metadata(&file)
        .map_err(|_| "bound Run source brief is missing or insecure".to_string())?;
    #[cfg(unix)]
    let insecure = {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o077 != 0
    };
    #[cfg(not(unix))]
    let insecure = false;
    if !metadata.is_file() || metadata.file_type().is_symlink() || insecure {
        return Err("bound Run source brief is missing or insecure".into());
    }
    Ok(())
}

fn new_job(prepared: &Prepared, run: &Path, files: &RunFiles) -> Result<RunAction, String> {
    let project = prepared
        .options
        .project
        .as_deref()
        .ok_or("project missing")?;
    let title = prepared
        .options
        .title
        .clone()
        .unwrap_or_else(|| job_title(project, run));
    let manifest = prepared.selected.project.join("project.run.json");
    let values = [
        "job".to_string(),
        "create".into(),
        "--repo".into(),
        project.into(),
        "--project-root".into(),
        prepared.selected.project.to_string_lossy().to_string(),
        "--title".into(),
        title,
        "--objective-file".into(),
        files.objective.to_string_lossy().to_string(),
        "--preflight=true".into(),
        "--project-run-manifest".into(),
        manifest.to_string_lossy().to_string(),
        "--coordinator-graph-file".into(),
        prepared.graph.to_string_lossy().to_string(),
        "--coordinator-input-file".into(),
        files.task_input.to_string_lossy().to_string(),
        "--coordinator-output-path".into(),
        files.output.to_string_lossy().to_string(),
        "--coordinator-project-root".into(),
        prepared.selected.project.to_string_lossy().to_string(),
        "--coordinator-workspace-root".into(),
        prepared.selected.root.to_string_lossy().to_string(),
    ];
    let mut values = values.to_vec();
    if prepared.options.no_review {
        values.push("--no-review".into());
    }
    let created = relay(&values)?;
    let job_id = identifier(&created, "Job create", true)?;
    let task_id = created["taskId"].as_str().unwrap_or("");
    if task_id.parse::<u64>().is_err()
        || !task_id
            .bytes()
            .next()
            .is_some_and(|c| c.is_ascii_digit() && c != b'0')
        || created["state"] != "DRAFT"
    {
        return Err(
            "Relay did not atomically create a DRAFT Coordinator Job with a numeric Task ID".into(),
        );
    }
    let run_str = run.to_str().ok_or("invalid Run path")?;
    let binding = Binding {
        schema_version: 1,
        project,
        dag: prepared.dag.as_deref(),
        source: prepared.source.as_ref().map(|s| s.0.as_str()),
        run_path: run_str,
        job_id: &job_id,
        task_id,
        repository: project,
        evidence: files.evidence.to_str().ok_or("invalid Run evidence")?,
        objective: files.objective.to_str().ok_or("invalid Run objective")?,
        task_input: files.task_input.to_str().ok_or("invalid Run input")?,
        output: files.output.to_str().ok_or("invalid Run output")?,
    };
    let text = serde_json::to_string_pretty(&binding).map_err(|e| e.to_string())? + "\n";
    run_files::private_write(&files.binding, text.as_bytes())?;
    bound(prepared, run, files, &job_id, task_id)
}

fn run_locked(prepared: &Prepared) -> Result<RunAction, String> {
    // Stage-specific policy is fully validated by the Run initializer before
    // any Relay submission; never silently bypass interactive approval.
    let run = run_path(prepared)?;
    #[cfg(unix)]
    let _run_process_lock = RunDirectoryLock::acquire(&run)?;
    let files = run_files::stage(prepared, &run)?;
    run_git::ensure(&run, prepared)?;
    validate_saved_source(&run, &files)?;
    if let Some(saved) = &files.saved {
        let repo = prepared.options.project.as_deref().unwrap_or_default();
        if saved["repository"] != repo {
            return Err("existing Run binding belongs to another Relay repository".into());
        }
        let id = if let Some(raw) = saved["jobId"].as_str() {
            raw.to_string()
        } else if let Some(raw) = saved["jobId"].as_u64() {
            raw.to_string()
        } else {
            return Err("existing Run binding has invalid Job id".into());
        };
        if id.is_empty()
            || !id.bytes().next().is_some_and(|x| x.is_ascii_alphanumeric())
            || !id
                .bytes()
                .all(|x| x.is_ascii_alphanumeric() || matches!(x, b'.' | b'_' | b'-'))
        {
            return Err("existing Run binding has invalid Job id".into());
        }
        let job = relay(&relay_args(&["job", "show", "--repo", repo, "--id", &id]))?;
        if identifier(&job, "verified Job", false)? != id {
            return Err("existing Relay Job identity changed".into());
        }
        let task = saved["taskId"]
            .as_str()
            .ok_or("existing Run binding task ID is invalid")?;
        return bound(prepared, &run, &files, &id, task);
    }
    new_job(prepared, &run, &files)
}

pub const PROJECT_RUN_HELP: &str = include_str!("../assets/project-run-help.txt");

pub fn run(args: &[String]) -> Result<Option<Value>, String> {
    if args
        .iter()
        .any(|arg| matches!(arg.as_str(), "--help" | "-h"))
    {
        let options = run_dry::parse(args)?;
        if options.help {
            print!("{PROJECT_RUN_HELP}");
            return Ok(None);
        }
    }
    let prepared = run_dry::prepare(args)?;
    if prepared.options.dry_run {
        return Ok(Some(prepared.preview));
    }
    // A bound Run is a resume. For a new Job the creator must *explicitly*
    // attest that Spec Kit Specify/Clarify and independent Preflight Review
    // are complete. Never fabricate the flag from local Run validation.
    let reattaching = prepared.options.path.is_some()
        && prepared
            .run_dir
            .as_ref()
            .is_some_and(|path| path.join(".neo-project-run.json").exists());
    if !reattaching && !prepared.options.preflight {
        return Err("ERROR [JOB_PREFLIGHT_REQUIRED]: Job creation requires --preflight=true. Complete Spec Kit Specify/Clarify and independent Preflight Review first. No Job was created.".into());
    }
    // run_locked holds the OS Run-directory lock only during binding/verification.
    // Never hold it during a potentially long-running foreground subscription.
    let action = run_locked(&prepared)?;
    match action {
        RunAction::Response(value) => Ok(Some(value)),
        RunAction::Foreground {
            response,
            job,
            task,
            project,
            workspace,
        } => {
            println!(
                "{}",
                serde_json::to_string(&response).map_err(|e| e.to_string())?
            );
            std::io::stdout().flush().map_err(|e| e.to_string())?;
            relay_foreground(&project, &job, &task, &workspace)?;
            Ok(None)
        }
    }
}
