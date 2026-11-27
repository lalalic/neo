//! Private Run input staging. Each file is checked before writes and is
//! published with an atomic hard link; existing user content is never replaced.
use crate::run_dry::Prepared;
use serde::Serialize;
use serde_json::Value;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct RunFiles {
    pub evidence: PathBuf,
    pub objective: PathBuf,
    pub task_input: PathBuf,
    pub output: PathBuf,
    pub binding: PathBuf,
    pub saved: Option<Value>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Evidence<'a> {
    schema_version: u8,
    project: &'a str,
    kind: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_url: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_run_path: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_brief: Option<&'a str>,
}

pub fn paths(run: &Path) -> RunFiles {
    RunFiles {
        evidence: run.join("source-reference.json"),
        objective: run.join("neo-project-run.objective.md"),
        task_input: run.join("neo-project-run.input.md"),
        output: run.join("neo-project-run.result.json"),
        binding: run.join(".neo-project-run.json"),
        saved: None,
    }
}

pub fn private_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if path.exists() || fs::symlink_metadata(path).is_ok() {
        return Err(format!(
            "refusing to replace existing run file: {}",
            path.file_name().unwrap_or_default().to_string_lossy()
        ));
    }
    let parent = path.parent().ok_or("run file lacks parent")?;
    let file_name = path
        .file_name()
        .ok_or("run file lacks filename")?
        .to_string_lossy();
    let temporary = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        #[cfg(unix)]
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::hard_link(&temporary, path).map_err(|e| {
            format!(
                "refusing to replace existing run file: {}: {e}",
                path.display()
            )
        })?;
        Ok(())
    })();
    let _ = fs::remove_file(&temporary);
    result
}

fn verify_file(path: &Path, expected: &[u8]) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    let insecure = meta.permissions().mode() & 0o077 != 0;
    #[cfg(not(unix))]
    let insecure = false;
    if !meta.is_file()
        || meta.file_type().is_symlink()
        || insecure
        || fs::read(path).map_err(|e| e.to_string())? != expected
    {
        return Err(format!(
            "run already contains different or insecure {}; refusing to overwrite",
            path.file_name().unwrap_or_default().to_string_lossy()
        ));
    }
    Ok(())
}
fn stringify<T: Serialize>(value: &T) -> Result<String, String> {
    Ok(serde_json::to_string_pretty(value).map_err(|e| e.to_string())? + "\n")
}

pub fn stage(prepared: &Prepared, run: &Path) -> Result<RunFiles, String> {
    let mut files = paths(run);
    let binding_exists = fs::symlink_metadata(&files.binding).is_ok();
    let project_name = prepared
        .options
        .project
        .as_deref()
        .ok_or("project missing")?;
    let canonical = run.to_str().ok_or("invalid Run path")?;
    if binding_exists {
        #[cfg(unix)]
        if fs::metadata(&files.binding)
            .map_err(|e| e.to_string())?
            .permissions()
            .mode()
            & 0o077
            != 0
        {
            return Err("existing run binding is not private; preserving run for review".into());
        }
        let meta = fs::symlink_metadata(&files.binding).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() || !meta.is_file() {
            return Err("existing run binding is unreadable; preserving run for review".into());
        }
        let saved: Value = serde_json::from_slice(
            &fs::read(&files.binding).map_err(|e| e.to_string())?,
        )
        .map_err(|_| "existing run binding is unreadable; preserving run for review".to_string())?;
        let job = saved
            .get("jobId")
            .and_then(|v| {
                v.as_str()
                    .map(str::to_owned)
                    .or_else(|| v.as_i64().map(|x| x.to_string()))
            })
            .unwrap_or_default();
        let task = saved.get("taskId").and_then(Value::as_str).unwrap_or("");
        let valid_id = |s: &str| {
            !s.is_empty()
                && s.bytes().next().is_some_and(|c| c.is_ascii_alphanumeric())
                && s.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'))
        };
        let valid_task = task == "coordinator"
            || task
                .parse::<u64>()
                .is_ok_and(|x| x > 0 && task == x.to_string());
        let matched = saved["schemaVersion"] == 1
            && saved["project"] == project_name
            && saved["runPath"] == canonical
            && valid_id(&job)
            && valid_task
            && saved["evidence"] == files.evidence.to_string_lossy().as_ref()
            && saved["objective"] == files.objective.to_string_lossy().as_ref()
            && saved["taskInput"] == files.task_input.to_string_lossy().as_ref()
            && saved["output"] == files.output.to_string_lossy().as_ref();
        if !matched {
            return Err("existing run binding does not match this request".into());
        }
        files.saved = Some(saved);
        return Ok(files);
    }
    if fs::symlink_metadata(&files.output).is_ok() {
        return Err("run already has an unbound Coordinator result; refusing to overwrite".into());
    }
    let evidence = Evidence {
        schema_version: 1,
        project: project_name,
        kind: if prepared.discovery {
            "discovery"
        } else if prepared.options.url.is_some() {
            "url-reference"
        } else {
            "canonical-run"
        },
        source_url: prepared.options.url.as_deref(),
        source_run_path: if !prepared.discovery && prepared.options.url.is_none() {
            Some(canonical)
        } else {
            None
        },
        source: prepared.source.as_ref().map(|s| s.0.as_str()),
        source_brief: prepared.source.as_ref().map(|s| s.2.as_str()),
    };
    let directive = if let Some((name, _, brief)) = &prepared.source {
        format!("Selected project source: {name}. The Run-local {brief} is the authoritative source brief. Follow the owning Project's source procedure; report a blocker if required evidence is unavailable.")
    } else if prepared.discovery {
        "Discovery input: no source URL was supplied. Follow the selected Graph and owning Project's source discovery contract.".into()
    } else {
        String::new()
    };
    let boundary=format!("RUN GIT BOUNDARY: the canonical private Run at {canonical} is the output Git repository. Write all generated per-run artifacts there, never in the parent Project repository. Before completion verify actual artifacts and Run Git HEAD according to the Project contract; never fabricate successful work or approval.");
    let objective_policy = "Follow the owning Project's quality, source-use, and review contracts. Source references and review approvals do not authorize external writes or publication; require explicit authorization for those actions.";
    let input_policy = objective_policy;
    let objective=format!("Run the {project_name} project workflow for the selected private canonical run.\n\nRead the run input at {} and its source evidence at {}. {directive} {boundary} {objective_policy}\n",files.task_input.display(),files.evidence.display());
    let task=format!("Process this selected Neo Project run.\n\n- Project: {project_name}\n- Canonical run: {canonical}\n- Private input evidence: {}\n\nUse the project contract and existing Agent Graph. Preserve existing run files. {directive} {boundary} {input_policy}\n",files.evidence.display());
    let mut staged = Vec::<(PathBuf, String)>::new();
    if let Some((_, _, brief_file)) = &prepared.source {
        let source_name = prepared
            .source
            .as_ref()
            .map(|s| s.0.as_str())
            .ok_or("source missing")?;
        let location = prepared.selected.declaration["sources"][source_name]["config"]
            .as_str()
            .ok_or("source config missing")?;
        let brief: Value = serde_json::from_slice(
            &fs::read(prepared.selected.project.join(location)).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        staged.push((run.join(brief_file), stringify(&brief)?));
    }
    staged.extend([
        (files.evidence.clone(), stringify(&evidence)?),
        (files.objective.clone(), objective),
        (files.task_input.clone(), task),
    ]);
    for (path, content) in &staged {
        if fs::symlink_metadata(path).is_ok() {
            verify_file(path, content.as_bytes())?;
        }
    }
    for (path, content) in &staged {
        if fs::symlink_metadata(path).is_err() {
            private_write(path, content.as_bytes())?;
        }
    }
    Ok(files)
}
