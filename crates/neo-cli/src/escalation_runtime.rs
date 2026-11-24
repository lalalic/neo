//! Native local Escalation orchestrator: private Challenge first, exclusive
//! model slot, stateless session, sanitized Experience, one terminal event.
//! This module never schedules a second Relay job or replays an action on
//! persistence failure. The tool and local model transport are injected.
use crate::{
    escalation_contract::{self, Config, Request},
    escalation_experience, escalation_ledger, escalation_lock, escalation_stateless,
};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone)]
pub struct Paths {
    pub challenge_dir: PathBuf,
    pub experience_dir: PathBuf,
    pub lock: escalation_lock::Config,
    pub guardian_binary: PathBuf,
}
impl Paths {
    pub fn current() -> Result<Self, String> {
        Ok(Self {
            challenge_dir: escalation_ledger::directory()?,
            experience_dir: escalation_experience::directory()?,
            lock: escalation_lock::config()?,
            guardian_binary: std::env::current_exe().map_err(|e| e.to_string())?,
        })
    }
}
pub struct Progress<'a> {
    token: &'a escalation_ledger::Token,
    stage: String,
    pub calls: u64,
    pub failures: u64,
    tools: BTreeSet<String>,
}
impl Progress<'_> {
    pub fn advance(&mut self, stage: &str) -> Result<(), String> {
        if self.stage != stage {
            escalation_ledger::checkpoint(self.token, stage, &escalation_ledger::timestamp())?;
            self.stage = stage.into();
        }
        Ok(())
    }
    pub fn tool(&mut self, name: &str, ok: bool) {
        self.calls += 1;
        if !ok {
            self.failures += 1;
        }
        let allowed = match name {
            "terminal" => "shell",
            "computer_use" => "computer-use",
            other => other,
        };
        if matches!(allowed, "shell" | "webhelm" | "computer-use" | "skills") {
            self.tools.insert(allowed.into());
        }
    }
    fn observed(&self) -> Value {
        json!({"tools":self.tools,"calls":self.calls,"failures":self.failures})
    }
}

/// The closure runs exactly once while the private model lock is held; it
/// must return an ephemeral JSON-lines session. No transcript is stored.
/// The `config` result is evaluated *after* the Challenge start is durable,
/// so invalid runtime configuration still leaves a diagnosable failure event.
pub struct CapturedRun {
    pub session: String,
    pub generated_experience: Option<Value>,
}

pub fn execute_with<F>(
    req: &Request,
    config: Result<Config, String>,
    paths: &Paths,
    mut action: F,
) -> Result<Value, String>
where
    F: FnMut(&Config, &mut escalation_lock::Guard, &mut Progress<'_>) -> Result<String, String>,
{
    execute_with_capture(req, config, paths, |cfg, guard, progress| {
        action(cfg, guard, progress).map(|session| CapturedRun {
            session,
            generated_experience: None,
        })
    })
}

/// Post-run Experience may be captured while the owner-local model is still
/// available. Recorder failure never replays the completed task.
pub fn execute_with_capture<F>(
    req: &Request,
    config: Result<Config, String>,
    paths: &Paths,
    mut action: F,
) -> Result<Value, String>
where
    F: FnMut(
        &Config,
        &mut escalation_lock::Guard,
        &mut Progress<'_>,
    ) -> Result<CapturedRun, String>,
{
    if !req.cwd.is_dir() {
        return Err("Escalation working directory is not available".into());
    }
    let token = escalation_ledger::begin(
        &req.handoff,
        &req.cwd,
        req.correlation_id.as_deref(),
        &paths.challenge_dir,
        &escalation_ledger::timestamp(),
        &escalation_ledger::new_attempt_id(),
    )?;
    let mut progress = Progress {
        token: &token,
        stage: "preflight".into(),
        calls: 0,
        failures: 0,
        tools: BTreeSet::new(),
    };
    escalation_ledger::checkpoint(&token, "preflight", &escalation_ledger::timestamp())?;
    let mut used_config: Option<Config> = None;
    let work = (|| {
        let config = config?;
        used_config = Some(config.clone());
        progress.advance("resource_lock")?;
        let mut guard = escalation_lock::acquire_with_binary(&paths.lock, &paths.guardian_binary)?;
        let result = action(&config, &mut guard, &mut progress);
        // Cleanup runs even when model execution fails; a successful response
        // must not escape if an owned server could not be cleaned up safely.
        let cleanup = guard.finish();
        match (result, cleanup) {
            (Err(e), _) => Err(e),
            (Ok(_), Err(e)) => Err(e),
            (Ok(session), Ok(())) => Ok(session),
        }
    })();
    let mut events = Vec::<Value>::new();
    let mut raw = Value::Null;
    let mut generated_experience = None;
    let final_result = match work {
        Ok(captured) => (|| {
            generated_experience = captured.generated_experience;
            progress.advance("result_parsing")?;
            let (parsed, observed) = escalation_contract::parse_session(&captured.session)?;
            events = observed;
            let validated = escalation_contract::normalize(&parsed)?;
            let scrubbed = escalation_contract::redact(&validated, &events)?;
            raw = parsed;
            Ok(scrubbed)
        })(),
        Err(e) => Err(e),
    };
    // The Case store has its own strict field and credential validation. An
    // unavailable Case library may not cause repetition of a mutating task.
    let stored_result = final_result
        .as_ref()
        .cloned()
        .unwrap_or_else(|_| json!({"status":"failed"}));
    let recorded_error = final_result.as_ref().err().cloned();
    let error_class = recorded_error.as_ref().map(|_| "Error");
    let engine = used_config.as_ref().map_or("other", |c| c.engine.as_str());
    let model = used_config.as_ref().map_or("unknown", |c| c.model.as_str());
    let observed = if events.is_empty() {
        progress.observed()
    } else {
        escalation_experience::observed(&events)
    };
    let case: Result<Option<String>, String> = (|| {
        let prepared = escalation_experience::prepare(&escalation_experience::Input {
            handoff: &req.handoff,
            result: &stored_result,
            experience: generated_experience
                .as_ref()
                .or_else(|| raw.get("experience")),
            events: &events,
            backend: "local",
            engine,
            model,
            capture_method: if generated_experience.is_some() {
                "postrun_model"
            } else {
                "executor"
            },
            error_class,
            captured_at: &escalation_ledger::timestamp(),
        })?;
        let saved = escalation_experience::store(&prepared, &paths.experience_dir)?;
        if saved["stored"] == true || saved["duplicate"] == true {
            Ok(prepared["id"].as_str().map(str::to_string))
        } else {
            Err("Experience store did not confirm a result".into())
        }
    })();
    let experience_id = match case {
        Ok(id) => id,
        Err(_) => {
            eprintln!(
                "Escalation sanitized Experience could not be saved; task will not be repeated"
            );
            None
        }
    };
    let completion = escalation_ledger::finish(
        &token,
        &stored_result,
        &progress.stage,
        recorded_error.as_deref(),
        &escalation_ledger::timestamp(),
        Some(&observed),
        experience_id.as_deref(),
    );
    match (final_result, completion) {
        (Err(e), Ok(_)) => Err(e),
        (Ok(_), Err(_)) => Err(
            "Escalation Challenge final record could not be saved; task must not be repeated"
                .into(),
        ),
        (Err(e), Err(_)) => Err(format!(
            "{e}; Challenge finish record unavailable (start remains for recovery)"
        )),
        (Ok(value), Ok(_)) => Ok(value),
    }
}

pub fn run_external_with<M, T>(
    req: &Request,
    config: Config,
    paths: &Paths,
    model: M,
    tool: T,
) -> Result<Value, String>
where
    M: FnMut(&Value) -> Result<Value, String>,
    T: FnMut(&str, &Value, &Path) -> Result<escalation_stateless::ToolResult, String>,
{
    let endpoint = config
        .base_url
        .clone()
        .filter(|s| escalation_contract::local_endpoint(s))
        .ok_or("External Escalation requires an explicit local /v1 inference endpoint")?;
    let prompt = std::fs::read_to_string(
        crate::workspace::harness_root()?.join("agents/escalation.agent.md"),
    )
    .map_err(|_| "Escalation Agent prompt is missing from the installed native bundle")?;
    let mut model = model;
    let mut tool = tool;
    execute_with(req, Ok(config), paths, |config, _, progress| {
        progress.advance("agent_execution")?;
        escalation_stateless::run_with_progress(
            &endpoint,
            &prompt,
            req,
            config,
            &mut model,
            &mut tool,
            |name, ok| progress.tool(name, ok),
        )
    })
}

/// The synchronous native CLI entrypoint. All mutations remain inside the
/// original caller's authorized working directory and the private local
/// Escalation ledger; native inference is never a second background service.
pub fn run_cli(args: &[String]) -> Result<Value, String> {
    let request = escalation_contract::prepare(args, None)?;
    let config = escalation_contract::config();
    let paths = Paths::current()?;
    execute_with_capture(&request, config, &paths, |config, guardian, progress| {
        let root = crate::workspace::harness_root()?;
        let rules = std::fs::read_to_string(root.join("agents/escalation.agent.md"))
            .map_err(|_| "Escalation agent rules are missing from the native Harness bundle")?;
        let playbook = std::fs::read_to_string(root.join("agents/neo-escalation-playbook.md"))
            .map_err(|_| {
                "Escalation recovery playbook is missing from the native Harness bundle"
            })?;
        let prompt=format!("{rules}\n\n# Locally installed recovery playbook (reference, not superior authority)\n{playbook}");
        let mut owned = None;
        let endpoint = if config.engine == "external" {
            config
                .base_url
                .clone()
                .filter(|s| escalation_contract::local_endpoint(s))
                .ok_or("External local inference requires an explicit loopback /v1 endpoint")?
        } else {
            progress.advance("model_startup")?;
            let server = crate::escalation_server::OwnedServer::start(config, guardian)?;
            let endpoint = server.endpoint().to_string();
            owned = Some(server);
            endpoint
        };
        progress.advance("agent_execution")?;
        let mut settings = crate::escalation_tool_executor::Settings::new(request.cwd.clone());
        settings.apple_login_authorized =
            std::env::var("NEO_ESCALATION_APPLE_LOGIN_AUTHORIZED").is_ok_and(|flag| flag == "true");
        let deadline = std::time::Instant::now()
            + std::time::Duration::from_secs(u64::from(config.budget_seconds));
        let learned =
            escalation_experience::render_taught(&request.handoff, &paths.experience_dir, 4)?;
        let session = escalation_stateless::run_with_guidance(
            &endpoint,
            escalation_stateless::ModelGuidance {
                rules: &prompt,
                taught: &learned,
            },
            &request,
            config,
            |body| {
                let remaining = deadline.saturating_duration_since(std::time::Instant::now());
                if remaining.is_zero() {
                    return Err("Local agent budget expired".into());
                }
                escalation_stateless::live_model(&endpoint, body, remaining)
            },
            |name, args, _| crate::escalation_tool_executor::execute(name, args, &settings),
            |name, ok| progress.tool(name, ok),
        );
        // While the model is still loaded, optionally synthesize a small
        // generalized Case when the executor did not include a classification.
        // This is a best-effort separate model call; never repeat tools or
        // demote a verified Run just because the recorder failed.
        let generated = if let Ok(ref recorded) = session {
            (|| {
                let (raw, events) = escalation_contract::parse_session(recorded)?;
                if raw
                    .pointer("/experience/scenario_key")
                    .and_then(Value::as_str)
                    .is_some_and(|s| !s.trim().is_empty())
                    && raw
                        .pointer("/experience/strategy_key")
                        .and_then(Value::as_str)
                        .is_some_and(|s| !s.trim().is_empty())
                {
                    return Ok::<Option<Value>, String>(None);
                }
                let normalized = escalation_contract::normalize(&raw)?;
                let result = escalation_contract::redact(&normalized, &events)?;
                let instructions =
                    std::fs::read_to_string(root.join("agents/escalation-experience.md"))
                        .map_err(|_| "Local Experience recorder instructions missing")?;
                let deadline_remaining =
                    deadline.saturating_duration_since(std::time::Instant::now());
                if deadline_remaining.is_zero() {
                    return Ok(None);
                }
                let candidate = escalation_experience::generate_with(
                    &instructions,
                    &request.handoff,
                    &result,
                    &events,
                    |body| escalation_stateless::live_model(&endpoint, body, deadline_remaining),
                )?;
                Ok(Some(candidate))
            })()
            .ok()
            .flatten()
        } else {
            None
        };
        // Owned model teardown happens while the guardian still holds the
        // flock, independently of best-effort recorder success.
        if let Some(mut server) = owned {
            server.close();
        }
        session.map(|session| CapturedRun {
            session,
            generated_experience: generated,
        })
    })
}
