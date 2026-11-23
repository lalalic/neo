//! Native durable private Escalation Challenge/Attempt writer. The original
//! unredacted handoff is persisted only in a current-user-private directory,
//! never the Harness asset tree. Atomic create-if-absent uses hard links,
//! and transient checkpoints are replaced only for unfinished attempts.
use chrono::Utc;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Token {
    pub dir: PathBuf,
    pub challenge_id: String,
    pub attempt_id: String,
}
const STAGES: &[&str] = &[
    "preflight",
    "resource_lock",
    "setup",
    "model_startup",
    "agent_execution",
    "tool_execution",
    "model_inference",
    "result_parsing",
    "experience_capture",
    "cleanup",
    "completed",
];
fn hexdigest(data: &[u8]) -> String {
    Sha256::digest(data)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn hex64(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'))
}
fn private_dir(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        let mut options = fs::DirBuilder::new();
        options.recursive(true).mode(0o700);
        options.create(path).map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("Challenge storage directory must be a private real directory (0700)".into());
    }
    #[cfg(unix)]
    if meta.permissions().mode() & 0o077 != 0 {
        return Err("Challenge storage directory must be a private real directory (0700)".into());
    }
    Ok(())
}
fn new_temp_file(folder: &Path, document: &Value) -> Result<PathBuf, String> {
    let scratch = folder.join(format!(".{}.tmp", Uuid::new_v4()));
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    opts.mode(0o600);
    let mut file = opts.open(&scratch).map_err(|e| e.to_string())?;
    if let Err(e) = (|| {
        let text = serde_json::to_string_pretty(document).map_err(|e| e.to_string())? + "\n";
        file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())
    })() {
        let _ = fs::remove_file(&scratch);
        return Err(e);
    }
    Ok(scratch)
}
fn immutable(path: &Path, value: &Value) -> Result<bool, String> {
    let parent = path.parent().ok_or("missing Challenge storage parent")?;
    private_dir(parent)?;
    if fs::symlink_metadata(path).is_ok() {
        return Ok(false);
    }
    let scratch = new_temp_file(parent, value)?;
    let result = fs::hard_link(&scratch, path);
    let _ = fs::remove_file(scratch);
    match result {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}
fn replace_checkpoint(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing checkpoint parent")?;
    private_dir(parent)?;
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("Unsafe existing Challenge checkpoint symlink".into());
    }
    let scratch = new_temp_file(parent, value)?;
    let result = fs::rename(&scratch, path).map_err(|e| e.to_string());
    if result.is_err() {
        let _ = fs::remove_file(&scratch);
    }
    result
}
fn read_private(path: &Path) -> Result<Value, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 2 * 1024 * 1024 {
        return Err("Unsafe or oversized Escalation Challenge record".into());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|_| "Invalid Challenge record JSON".into())
}
fn field(lines: &[String], names: &[&str]) -> String {
    for line in lines {
        if let Some((name, value)) = line.split_once(':').or_else(|| line.split_once('：')) {
            if name.len() <= 38 && names.contains(&name.trim().to_ascii_lowercase().as_str()) {
                return value.trim().to_string();
            }
        }
    }
    String::new()
}
fn summary(handoff: &str) -> Value {
    let lines = handoff
        .lines()
        .map(|line| {
            line.trim()
                .trim_start_matches(['-', '*', '#', '>', ' ', '\t'])
                .trim()
        })
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let goal = field(
        &lines,
        &[
            "goal",
            "objective",
            "task",
            "request",
            "目标",
            "任务",
            "目的",
            "要求",
        ],
    );
    let goal = if !goal.is_empty() {
        goal
    } else {
        lines.first().cloned().unwrap_or_default()
    };
    let blocker = field(
        &lines,
        &[
            "blocker",
            "blocked",
            "problem",
            "error",
            "issue",
            "challenge",
            "障碍",
            "阻塞",
            "失败",
            "问题",
            "错误",
            "卡点",
        ],
    );
    let blocker = if !blocker.is_empty() {
        blocker
    } else {
        lines
            .iter()
            .find(|line| {
                *line != &goal
                    && [
                        "blocked",
                        "missing",
                        "failed",
                        "can't",
                        "cannot",
                        "denied",
                        "unavailable",
                        "阻塞",
                        "失败",
                        "缺少",
                        "无法",
                        "报错",
                    ]
                    .iter()
                    .any(|word| line.to_lowercase().contains(word))
            })
            .cloned()
            .unwrap_or_default()
    };
    json!({"goal":goal,"blocker":blocker,
        "progress":field(&lines,&["progress","current state","already tried","attempted","现状","进展","已尝试","已完成"]),
        "success_criteria":field(&lines,&["success criteria","acceptance","expected result","verify","verification","完成标准","验收","预期结果","验证"])})
}
fn correlation_valid(s: &str) -> bool {
    let mut chars = s.bytes();
    (6..=160).contains(&s.len())
        && chars.next().is_some_and(|b| b.is_ascii_alphanumeric())
        && chars.all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'/' | b'-'))
        && !s.contains("..")
        && !s.contains("//")
}
pub fn directory() -> Result<PathBuf, String> {
    let path = env::var_os("NEO_ESCALATION_CHALLENGES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            crate::workspace::home()
                .unwrap_or_default()
                .join(".local/share/neo/escalation/challenges")
        });
    if !path.is_absolute() {
        return Err("NEO_ESCALATION_CHALLENGES_DIR must be an absolute path".into());
    }
    Ok(path)
}

/// begin() is idempotent for Challenge identity, but always creates a
/// *new* UUID Attempt. A changed Handoff is copied into this retry's
/// immutable start event, preserving the original Challenge text.
pub fn begin(
    handoff: &str,
    cwd: &Path,
    correlation: Option<&str>,
    dir: &Path,
    now: &str,
    attempt: &str,
) -> Result<Token, String> {
    if handoff.trim().is_empty() {
        return Err("Challenge requires a handoff".into());
    }
    if correlation.is_some_and(|s| !correlation_valid(s)) {
        return Err("Invalid --correlation-id (must be an opaque task ID, never a secret)".into());
    }
    if Uuid::parse_str(attempt).is_err() {
        return Err("Invalid attempt ID".into());
    }
    if !dir.is_absolute() {
        return Err("NEO_ESCALATION_CHALLENGES_DIR must be an absolute path".into());
    }
    let fingerprint = hexdigest(handoff.as_bytes());
    let key = correlation.unwrap_or(&fingerprint);
    let id = hexdigest(format!("neo-escalation-challenge-v1\0{key}").as_bytes());
    private_dir(dir)?;
    let folder = dir.join(&id);
    private_dir(&folder)?;
    let mut record =
        json!({"version":1,"id":id,"created_at":now,"cwd":cwd.to_string_lossy(),"handoff":handoff});
    if let Some(cid) = correlation {
        record["correlation_id"] = json!(cid);
    }
    let summary = summary(handoff);
    for field in ["goal", "blocker", "progress", "success_criteria"] {
        record[field] = summary[field].clone();
    }
    let path = folder.join("challenge.json");
    let created = immutable(&path, &record)?;
    let original = if created {
        handoff.to_string()
    } else {
        let existing = read_private(&path)?;
        if existing["version"] != 1
            || existing["id"] != id
            || !existing["handoff"]
                .as_str()
                .is_some_and(|s| !s.trim().is_empty())
            || existing.get("correlation_id").and_then(Value::as_str) != correlation
        {
            return Err("Existing Challenge identity or handoff has been altered".into());
        }
        existing["handoff"].as_str().unwrap_or_default().to_string()
    };
    let mut started =
        json!({"version":1,"challenge_id":id,"attempt_id":attempt,"event":"started","at":now});
    if original != handoff {
        started["handoff"] = json!(handoff);
    }
    if !immutable(&folder.join(format!("{attempt}.started.json")), &started)? {
        return Err("Attempt start event already exists".into());
    }
    Ok(Token {
        dir: dir.to_owned(),
        challenge_id: id,
        attempt_id: attempt.into(),
    })
}
fn validate(token: &Token) -> Result<PathBuf, String> {
    if !hex64(&token.challenge_id) || Uuid::parse_str(&token.attempt_id).is_err() {
        return Err("Invalid challenge token".into());
    }
    let folder = token.dir.join(&token.challenge_id);
    private_dir(&token.dir)?;
    private_dir(&folder)?;
    let started = folder.join(format!("{}.started.json", token.attempt_id));
    let event =
        read_private(&started).map_err(|_| "Missing or unsafe challenge attempt start event")?;
    if event["version"] != 1
        || event["event"] != "started"
        || event["challenge_id"] != token.challenge_id
        || event["attempt_id"] != token.attempt_id
    {
        return Err("Challenge Attempt start evidence does not match its identity".into());
    }
    Ok(folder)
}
pub fn checkpoint(token: &Token, stage: &str, at: &str) -> Result<Value, String> {
    let folder = validate(token)?;
    if !STAGES.contains(&stage) {
        return Err("Invalid challenge stage".into());
    }
    if folder
        .join(format!("{}.finished.json", token.attempt_id))
        .exists()
    {
        return Err("Completed attempt cannot be checkpointed".into());
    }
    let event = json!({"event":"checkpoint","at":at,"stage":stage,"challenge_id":token.challenge_id,"attempt_id":token.attempt_id});
    replace_checkpoint(
        &folder.join(format!("{}.checkpoint.json", token.attempt_id)),
        &event,
    )?;
    Ok(event)
}
fn failure_info(message: &str, phase: &str) -> Value {
    use regex::Regex;
    let classifications = [
        (
            r"model server.*(?:launch|exited|startup)|inference server startup|server.*start.*timed out",
            "model_startup",
            "server_start_failed",
        ),
        (
            r"Local inference (?:request failed|HTTP [0-9]+|returned no assistant)",
            "model_inference",
            "model_request_failed",
        ),
        (
            r"Local inference decision|decision gate|Local decision",
            "model_inference",
            "decision_failed",
        ),
        (
            r"budget expired|maximum tool-calling turns",
            "agent_execution",
            "agent_budget_exhausted",
        ),
        (
            r"returned no parseable JSON|emitted non-JSON|result must be a JSON|invalid status|needs a meaningful summary|did not provide a successful terminal result",
            "result_parsing",
            "invalid_agent_result",
        ),
        (
            r"claimed resolved without|Resolved local escalation has no evidence",
            "result_parsing",
            "verification_missing",
        ),
        (
            r"Local agent exited|Hermes dependency|Hermes installed",
            "agent_execution",
            "agent_process_failed",
        ),
        (
            r"lock|resource busy|exclusive model slot",
            "resource_lock",
            "resource_lock_failed",
        ),
        (r"permission|EACCES|EPERM", "dynamic", "permission_denied"),
    ];
    for (pattern, stage, code) in classifications {
        let full = format!("(?i){pattern}");
        if Regex::new(&full).is_ok_and(|re| re.is_match(message)) {
            let stage = if stage == "dynamic" { phase } else { stage };
            return json!({"stage":stage,"code":code,"error_class":"Error","message":message});
        }
    }
    let stage = if STAGES.contains(&phase) {
        phase
    } else {
        "agent_execution"
    };
    json!({"stage":stage,"code":"unclassified_runtime_error","error_class":"Error","message":message})
}

pub fn finish(
    token: &Token,
    result: &Value,
    phase: &str,
    error: Option<&str>,
    at: &str,
    observed: Option<&Value>,
    experience_id: Option<&str>,
) -> Result<Value, String> {
    let folder = validate(token)?;
    let status = if error.is_some() {
        "failed"
    } else {
        result["status"].as_str().unwrap_or("")
    };
    if !matches!(status, "resolved" | "failed" | "needs_user") {
        return Err("Invalid challenge outcome".into());
    }
    let mut event = json!({"version":1,"challenge_id":token.challenge_id,"attempt_id":token.attempt_id,
        "event":"finished","at":at,"outcome":status});
    for (target, key) in [("summary", "summary"), ("reason", "reason")] {
        if let Some(s) = result[key].as_str().filter(|s| !s.is_empty()) {
            event[target] = json!(s);
        }
    }
    if let Some(evidence) = result["evidence"].as_array().filter(|a| !a.is_empty()) {
        event["verification"] = json!(evidence);
    }
    if status == "needs_user" {
        for key in ["user_action", "notification"] {
            if result.get(key).is_some_and(|v| !v.is_null()) {
                event[key] = result[key].clone();
            }
        }
    }
    if let Some(detail) = error {
        event["failure"] = failure_info(detail, phase);
    } else if status == "failed" {
        event["failure"] = json!({"stage":if STAGES.contains(&phase){phase}else{"completed"},"code":"agent_reported_failure"});
    }
    if let Some(obs) = observed {
        if obs["calls"].as_u64().unwrap_or(0) > 0
            || obs["failures"].as_u64().unwrap_or(0) > 0
            || obs["tools"].as_array().is_some_and(|v| !v.is_empty())
        {
            event["observed"] = obs.clone();
        }
    }
    if let Some(id) = experience_id.filter(|s| hex64(s)) {
        event["experience_id"] = json!(id);
    }
    let path = folder.join(format!("{}.finished.json", token.attempt_id));
    if !immutable(&path, &event)? {
        return Err("Challenge Attempt is already finished".into());
    }
    let checkpoint = folder.join(format!("{}.checkpoint.json", token.attempt_id));
    match fs::remove_file(checkpoint) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    Ok(event)
}
pub fn new_attempt_id() -> String {
    Uuid::new_v4().to_string()
}
pub fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
