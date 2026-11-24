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

fn review_policy(
    prepared: &Prepared,
    run: &Path,
    bound: bool,
) -> Result<(String, usize, Option<String>), String> {
    let no_review = prepared.options.no_review;
    let mode_file = run.join("review-mode.json");
    let mode_exists = fs::symlink_metadata(&mode_file).is_ok();
    if no_review {
        let manifest = run.join("source-manifest.json");
        if !manifest.exists() {
            return Err("private no-review Vlog test requires source-manifest.json".into());
        }
        let data: Value = serde_json::from_slice(&fs::read(&manifest).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let approved = data.pointer("/source_use/approved") == Some(&Value::Bool(true));
        let scope = data
            .pointer("/source_use/scope")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !approved || !scope.to_ascii_lowercase().contains("private") {
            return Err("private no-review Vlog requires owner-approved private source use".into());
        }
    }
    if mode_exists {
        let meta = fs::symlink_metadata(&mode_file).map_err(|e| e.to_string())?;
        if meta.is_symlink() || !meta.is_file() {
            return Err("invalid existing review-mode.json".into());
        }
        let policy: Value =
            serde_json::from_slice(&fs::read(&mode_file).map_err(|e| e.to_string())?)
                .map_err(|_| "invalid existing review-mode.json".to_string())?;
        if policy["schemaVersion"] != 1
            || policy["mode"] != "private-render-test"
            || policy["publicationAllowed"] != false
            || policy["reviewStatus"] != "UNREVIEWED"
        {
            return Err("invalid existing private render test policy".into());
        }
    }
    if mode_exists != no_review {
        if bound {
            return Err("Cannot change existing bound Vlog review policy".into());
        }
        if !no_review {
            return Err("Existing private render test must use --no-review".into());
        }
    }
    let name = prepared.options.project.as_deref().unwrap_or("");
    let stage_file = run.join("review-stages.json");
    let vlog = name == "vlog";
    let allowed = if vlog {
        Some(vec![
            "visioner".into(),
            "director".into(),
            "producer".into(),
        ])
    } else {
        prepared.reviewable.clone()
    };
    let mut requested = Vec::<String>::new();
    if let Some(allowed) = allowed {
        if fs::symlink_metadata(&stage_file).is_ok() {
            let configured: Value =
                serde_json::from_slice(&fs::read(&stage_file).map_err(|e| e.to_string())?)
                    .map_err(|_| "invalid Vlog review-stages.json".to_string())?;
            let message = if vlog {
                "Vlog review-stages.json accepts only boolean visioner/director/producer"
            } else {
                "review-stages.json must contain boolean flags for selected DAG Agents only"
            };
            let object = configured.as_object().ok_or(message)?;
            if object
                .iter()
                .any(|(k, v)| !allowed.contains(k) || !v.is_boolean())
            {
                return Err(message.into());
            }
            requested = allowed
                .iter()
                .filter(|stage| object.get(*stage) == Some(&Value::Bool(true)))
                .cloned()
                .collect();
            if no_review && !requested.is_empty() {
                return Err(
                    "--no-review conflicts with enabled Vlog interactive review stages".into(),
                );
            }
        }
    }
    let directive = if no_review {
        "\nPRIVATE RENDER TEST ONLY: honor review-mode.json. SKIP human Preview and specialist review entirely, never call review/notify, render a real MP4, check playback, mark review UNREVIEWED/NOT_RUN, force Publisher SKIPPED, prohibit publication.\n".to_string()
    } else if requested.is_empty() {
        String::new()
    } else if vlog {
        format!("\nEXPLICIT INTERACTIVE REVIEWS: review-stages.json requires human Preview and authenticated approval for these exact Task stages: {}. Each enabled Agent must call Relay review interactive with its own Task execution identity, enter AWAITING_DECISION, and only complete after a matching approved decision; Request Changes must revise and re-preview. Do NOT claim stage completion based on Preview compilation or notification delivery. No extra Review Task or Final Review.\n",requested.join(", "))
    } else {
        format!("\nMANDATORY STAGE-BY-STAGE HUMAN REVIEWS: Before each of these DAG Agents succeeds, request a managed Neo Mobile Review using its **own real Relay Task execution identity**: {}. For each Stage, first write and validate its real artifact, then run 'node scripts/growth-stage-review.mjs {} AGENT_NAME' to generate the Markcut review path and call 'npx --yes --package agents-relay@latest agents-relay review interactive --path REVIEW_PATH --id JOB_ID --task-id TASK_ID --execution-id EXECUTION_ID'. Refer to docs/growth-stage-review.md. Wait for actual human Approve or Request Changes on that same Task: do not mark SUCCEEDED, create a fake receipt, skip a pending approval or automatically approve any stage. On Request Changes, revise the underlying artifact and send a new review. This approval of creative work NEVER grants external publication permission.\n",requested.join(", "),run.display())
    };
    let policy = if no_review && !mode_exists {
        Some(stringify(&serde_json::json!({
            "schemaVersion":1,"mode":"private-render-test","reviewStatus":"UNREVIEWED",
            "humanReview":"NOT_RUN","specialistReview":"NOT_RUN","publicationAllowed":false
        }))?)
    } else {
        None
    };
    Ok((directive, requested.len(), policy))
}

pub fn stage(prepared: &Prepared, run: &Path) -> Result<RunFiles, String> {
    let mut files = paths(run);
    let binding_exists = fs::symlink_metadata(&files.binding).is_ok();
    let (instruction, review_count, policy_file) = review_policy(prepared, run, binding_exists)?;
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
    let video = prepared.discovery_domain.as_deref() == Some("video")
        || matches!(project_name, "vlog" | "content-distribution");
    let publishing = prepared.selected.declaration["publicationReview"]
        == "publisher-explicit-authorization"
        && project_name == "vlog";
    let creative = prepared.selected.declaration["publicationReview"] == "separate";
    let directive = if let Some((name, _, brief)) = &prepared.source {
        format!("Selected project source: {name}. The Run-local {brief} is the authoritative source brief. The first Agent must follow that brief instead of the default discovery strategy; it must validate genuine source evidence and HOLD when unavailable. A source reference is not a license or permission to publish.")
    } else if prepared.discovery {
        if video {
            "Discovery input: no source URL was supplied. First Agent must independently search public trending videos using the project research brief. A reference video is NOT licensed source media. Do not infer permission to reupload or publish.".into()
        } else {
            "Discovery input: no source URL was supplied. Follow this project AGENTS.md, objective and selected DAG; do not invent unrelated research or media tasks.".into()
        }
    } else {
        String::new()
    };
    let boundary=format!("RUN GIT BOUNDARY: the canonical private Run at {canonical} is the output Git repository. Generated per-run files (including index.html, QA artifacts, and the DAG result) MUST be written inside that exact Run, never into the parent Project repository. Before a Task claims completion, verify the Run files at their absolute paths and the actual Run Git HEAD; a parent-Project-only file or Git commit does not satisfy this Run. Do not bypass sandbox permission checks or fake a successful commit.");
    let publishing_policy="No specialist Final Review or separate Final QA Task. Editor must run Markcut verify and noninteractive source/asset checks (no real viewer required); Producer verifies and renders, with human Preview only on explicit request. Publisher uses WeChat Channels/XHS only with explicit per-video, per-platform and signed-in account authorization; otherwise SKIPPED, and Publisher itself has no review.";
    let publisher_preference = if review_count > 0 {
        "Requested stages must perform the interactive review in review-stages.json."
    } else {
        "Default: no human interactive review."
    };
    let full_publisher_policy = format!("{publisher_preference} {publishing_policy}");
    let objective_policy = if publishing {
        full_publisher_policy.as_str()
    } else if creative {
        "Perform Stage contract validation/self-heal; a separate workflow owns all publication/license/use audits. Do not publish."
    } else if video {
        "Apply project source-use, review and publication gates. Do not infer permission or publish."
    } else {
        "Follow project-specific quality, review and source-use gates. Do not publish or perform external writes without authorization."
    };
    let input_policy = if publishing {
        full_publisher_policy.as_str()
    } else if creative {
        "Do not perform licensing or rights checks in creative Stages; publication review is separate."
    } else if video {
        "Source references do not establish rights or publication permission."
    } else {
        "Follow project-specific quality, review and source-use gates. Do not publish or perform external writes without authorization."
    };
    let objective=format!("Run the {project_name} project workflow for the selected private canonical run.\n\nRead the run input at {} and its source evidence at {}. {directive} {boundary} {objective_policy}\n{instruction}",files.task_input.display(),files.evidence.display());
    let task=format!("Process this selected Neo Project run.\n\n- Project: {project_name}\n- Canonical run: {canonical}\n- Private input evidence: {}\n\nUse the project contract and existing Agent Graph. Preserve existing run files. {directive} {boundary} {input_policy}\n{instruction}",files.evidence.display());
    let mut staged = Vec::<(PathBuf, String)>::new();
    if let Some(text) = policy_file {
        staged.push((run.join("review-mode.json"), text));
    }
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
