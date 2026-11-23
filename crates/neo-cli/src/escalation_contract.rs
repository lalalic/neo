//! Native Escalation input/config/output contract shared by future local
//! model runner and durable Challenge coordination. This module only parses
//! and validates; it never starts inference or mutates a private ledger.
use regex::Regex;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
};

const DEFAULT_MODEL: &str = "unsloth/Qwen3.5-4B-GGUF:Q4_K_M";
const DEFAULT_MLX: &str = "mlx-community/Qwen3.5-4B-MLX-4bit";
#[derive(Debug, Clone)]
pub struct Request {
    pub handoff: String,
    pub on_needs_user: String,
    pub cwd: PathBuf,
    pub correlation_id: Option<String>,
}
fn required_file(path: &str, label: &str) -> Result<String, String> {
    if path == "-" {
        return Err(format!(
            "{label} requires a file path; stdin is not supported"
        ));
    }
    let file = fs::read(path).map_err(|e| format!("{label} could not be read: {path}: {e}"))?;
    if file.len() > 1024 * 1024 {
        return Err(format!("{label} exceeds 1 MiB"));
    }
    let data = String::from_utf8(file).map_err(|_| format!("{label} must be UTF-8"))?;
    if data.trim().is_empty() {
        return Err(format!("{label} is empty: {path}"));
    }
    Ok(data)
}
fn valid_id(s: &str) -> bool {
    let mut chars = s.bytes();
    (6..=160).contains(&s.len())
        && chars.next().is_some_and(|b| b.is_ascii_alphanumeric())
        && chars.all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'/' | b'-'))
        && !s.contains("..")
        && !s.contains("//")
}
pub fn prepare(args: &[String], default_policy: Option<&Path>) -> Result<Request, String> {
    let mut opts = HashMap::<&str, &str>::new();
    if !args.len().is_multiple_of(2) {
        return Err("unknown escalation option; use --handoff-file PATH".into());
    }
    for row in args.as_chunks::<2>().0 {
        let key = row[0].as_str();
        if !matches!(
            key,
            "--handoff-file" | "--on-needs-user-file" | "--cwd" | "--correlation-id"
        ) {
            return Err(format!(
                "unknown escalation option: {key}; use --handoff-file PATH"
            ));
        }
        let value = row[1].as_str();
        if value.starts_with('-') || value.is_empty() {
            return Err(format!("{key} requires a value"));
        }
        opts.insert(key, value);
    }
    let handoff = opts
        .get("--handoff-file")
        .ok_or("escalation requires --handoff-file PATH")?;
    let handoff = required_file(handoff, "--handoff-file")?;
    let policy = if let Some(override_file) = opts.get("--on-needs-user-file") {
        required_file(override_file, "--on-needs-user-file")?
    } else {
        let default_path = if let Some(path) = default_policy {
            path.to_path_buf()
        } else {
            crate::workspace::harness_root()?.join("agents/escalation-needs-user.md")
        };
        required_file(
            default_path
                .to_str()
                .ok_or("Invalid needs-user policy path")?,
            "default needs-user policy",
        )?
    };
    let cwd = opts
        .get("--cwd")
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let correlation_id = opts.get("--correlation-id").map(|s| s.to_string());
    if correlation_id.as_deref().is_some_and(|s| !valid_id(s)) {
        return Err("Invalid --correlation-id (must be an opaque task ID, never a secret)".into());
    }
    Ok(Request {
        handoff,
        on_needs_user: policy,
        cwd,
        correlation_id,
    })
}

#[derive(Debug, Clone)]
pub struct Config {
    pub engine: String,
    pub model: String,
    pub context: u32,
    pub budget_seconds: u32,
    pub max_turns: u32,
    pub startup_ms: u32,
    pub server_command: String,
    pub base_url: Option<String>,
}
fn int_env(
    env: &HashMap<String, String>,
    name: &str,
    default: u32,
    min: u32,
    max: u32,
) -> Result<u32, String> {
    let value = env.get(name).filter(|s| !s.is_empty());
    let value = match value {
        None => default,
        Some(s) => s
            .parse::<u32>()
            .map_err(|_| format!("{name} must be {min}..{max}"))?,
    };
    if value < min || value > max {
        return Err(format!("{name} must be {min}..{max}"));
    }
    Ok(value)
}
pub fn local_endpoint(s: &str) -> bool {
    let Some(port) = s
        .strip_prefix("http://127.0.0.1:")
        .and_then(|s| s.strip_suffix("/v1"))
    else {
        return false;
    };
    !port.is_empty()
        && port.bytes().all(|b| b.is_ascii_digit())
        && port.parse::<u16>().is_ok_and(|n| n > 0)
}
pub fn config_with(env: &HashMap<String, String>) -> Result<Config, String> {
    let engine = env
        .get("NEO_ESCALATION_ENGINE")
        .filter(|s| !s.is_empty())
        .map_or("llama", String::as_str);
    if !matches!(engine, "llama" | "mlx" | "external") {
        return Err("NEO_ESCALATION_ENGINE must be llama, mlx, or external".into());
    }
    let default = if engine == "mlx" {
        DEFAULT_MLX
    } else {
        DEFAULT_MODEL
    };
    let model = env
        .get("NEO_ESCALATION_MODEL")
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or(default.into());
    let context = int_env(env, "NEO_ESCALATION_CONTEXT", 65536, 64000, 262144)?;
    let budget_seconds = int_env(env, "NEO_ESCALATION_BUDGET_SECONDS", 900, 10, 7200)?;
    let max_turns = int_env(env, "NEO_ESCALATION_MAX_TURNS", 24, 1, 500)?;
    let startup_ms = int_env(env, "NEO_ESCALATION_STARTUP_MS", 900000, 1000, 1800000)?;
    let base_url = env.get("NEO_ESCALATION_BASE_URL").cloned();
    if engine == "external" && !base_url.as_deref().is_some_and(local_endpoint) {
        return Err(
            "External local inference requires NEO_ESCALATION_BASE_URL=http://127.0.0.1:PORT/v1"
                .into(),
        );
    }
    let server_command = env
        .get("NEO_ESCALATION_SERVER_COMMAND")
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or(
            if engine == "llama" {
                "llama-server"
            } else {
                "mlx_lm.server"
            }
            .into(),
        );
    Ok(Config {
        engine: engine.into(),
        model,
        context,
        budget_seconds,
        max_turns,
        startup_ms,
        server_command,
        base_url,
    })
}
pub fn config() -> Result<Config, String> {
    config_with(&env::vars().collect())
}
pub fn server_args(config: &Config, port: u16) -> Result<Vec<String>, String> {
    if config.engine == "external" {
        return Err("External inference does not start an owned server".into());
    }
    if port == 0 {
        return Err("Inference port must be nonzero".into());
    }
    let mut args = if config.engine == "llama" {
        if config.model.starts_with('/') && config.model.ends_with(".gguf") {
            vec!["-m".into(), config.model.clone()]
        } else {
            vec!["--hf-repo".into(), config.model.clone()]
        }
    } else {
        vec!["--model".into(), config.model.clone()]
    };
    if config.engine == "llama" {
        args.extend(
            ["--no-mmproj", "--jinja", "--host", "127.0.0.1", "--port"]
                .iter()
                .map(|s| s.to_string()),
        );
        args.push(port.to_string());
        args.extend(
            ["--alias", "neo-escalation", "-c"]
                .iter()
                .map(|s| s.to_string()),
        );
        args.push(config.context.to_string());
        args.extend(
            ["-np", "1", "-ngl", "99", "-ctk", "q8_0", "-ctv", "q8_0"]
                .iter()
                .map(|s| s.to_string()),
        );
    } else {
        args.extend([
            "--host".into(),
            "127.0.0.1".into(),
            "--port".into(),
            port.to_string(),
        ]);
    }
    Ok(args)
}
fn to_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".into(),
        _ => v.to_string(),
    }
}
pub fn normalize(raw: &Value) -> Result<Value, String> {
    let status = raw["status"]
        .as_str()
        .filter(|s| matches!(*s, "resolved" | "needs_user" | "failed"))
        .ok_or("Local result has an invalid status")?;
    let summary = raw["summary"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Local result needs a meaningful summary")?;
    let evidence = if let Some(items) = raw["evidence"].as_array() {
        items
            .iter()
            .filter_map(|item| item.as_str().filter(|s| !s.trim().is_empty()))
            .map(str::to_owned)
            .collect::<Vec<_>>()
    } else if let Some(map) = raw["evidence"].as_object() {
        map.iter()
            .map(|(k, v)| format!("{k}: {}", to_text(v)))
            .collect::<Vec<_>>()
    } else if let Some(text) = raw["evidence"].as_str().filter(|s| !s.trim().is_empty()) {
        vec![text.to_string()]
    } else {
        vec![]
    };
    for field in ["reason", "user_action"] {
        if !raw[field].is_null() && !raw[field].is_string() {
            return Err(format!("Invalid local {field}"));
        }
    }
    let user_action = raw.get("user_action").cloned().unwrap_or(Value::Null);
    let notification = raw.get("notification").cloned().unwrap_or(Value::Null);
    if !notification.is_null()
        && (!notification.is_object()
            || notification["attempted"].as_bool().is_none()
            || !notification
                .get("delivered")
                .is_some_and(|v| v.is_boolean() || v.is_null())
            || !notification
                .get("channel")
                .is_some_and(|v| v.is_string() || v.is_null())
            || !notification
                .get("details")
                .is_some_and(|v| v.is_string() || v.is_null()))
    {
        return Err("Invalid local notification report".into());
    }
    if status == "resolved" && evidence.is_empty() {
        return Err("Resolved local escalation has no evidence".into());
    }
    if status == "needs_user" && !user_action.as_str().is_some_and(|s| !s.trim().is_empty()) {
        return Err("Needs-user local escalation lacks the required user action".into());
    }
    Ok(json!({"status":status,"summary":summary,
        "reason":raw.get("reason").cloned().unwrap_or(Value::Null),
        "user_action":user_action,"evidence":evidence,"notification":notification}))
}
pub fn parse_session(content: &str) -> Result<(Value, Vec<Value>), String> {
    let mut events = Vec::new();
    for line in content.lines().filter(|s| !s.trim().is_empty()) {
        let event: Value =
            serde_json::from_str(line).map_err(|_| "Local agent emitted non-JSON event output")?;
        events.push(event);
    }
    let event=events.iter().rev().find(|e|e["type"]=="result")
        .filter(|e|e["exit_code"]==0 && e["text"].is_string())
        .ok_or("Local agent did not provide a successful terminal result; raw event content suppressed")?;
    let text = event["text"].as_str().unwrap_or("").trim();
    let text = if let Some(m) = Regex::new(r"(?s)```(?:json)?\s*(.*?)\s*```")
        .map_err(|e| e.to_string())?
        .captures(text)
    {
        m.get(1).map(|x| x.as_str()).unwrap_or(text)
    } else {
        text
    };
    let parsed: Value =
        serde_json::from_str(text).map_err(|_| "Local agent returned no parseable JSON result")?;
    if !parsed.is_object() {
        return Err("Local agent result must be a JSON object".into());
    }
    if parsed["status"] == "resolved"
        && !events
            .iter()
            .any(|e| e["type"] == "tool_result" && e["is_error"] != true)
    {
        return Err("Local agent claimed resolved without a successful tool result".into());
    }
    Ok((parsed, events))
}
/// Defense-in-depth masks patterns and exact credentials observed in tool
/// responses without retaining a full tool transcript after the call.
pub fn redact(result: &Value, events: &[Value]) -> Result<Value, String> {
    let assignment=Regex::new(r#"(?i)\b(?:api[-_ ]?key|auth(?:orization)?|access[-_ ]?token|refresh[-_ ]?token|npm[-_ ]?token|password|cookie|secret|credential)\s*(?:[:=]|\bis\b)\s*[\"']?([^\s\"';,]+)"#).map_err(|e|e.to_string())?;
    let mut secrets = Vec::<String>::new();
    let bare = Regex::new(r"^[A-Za-z0-9_+/=.!-]{6,512}$").map_err(|e| e.to_string())?;
    for event in events.iter().filter(|e| e["type"] == "tool_result") {
        for field in ["output", "text", "result", "content"] {
            let raw = event.get(field).filter(|v| !v.is_null());
            let Some(value) = raw else { continue };
            let text = to_text(value);
            if text.len() > 4096 {
                continue;
            }
            let trimmed = text.trim();
            if bare.is_match(trimmed)
                && !matches!(
                    trimmed.to_ascii_lowercase().as_str(),
                    "success" | "failed" | "true" | "false" | "error" | "ok" | "done" | "verified"
                )
            {
                secrets.push(trimmed.into());
            }
            for captures in assignment.captures_iter(&text) {
                let value = captures.get(1).map(|m| m.as_str()).unwrap_or("");
                if value.len() >= 4 {
                    secrets.push(value.into());
                }
            }
        }
    }
    secrets.sort();
    secrets.dedup();
    let masks = [
        r"(?i)\b(?:Bearer|Basic)\s+\S+",
        r"(?i)\b(?:sk[-_]|gh[pousr]_|github_pat_|npm_|xox[baprs]-|pk_live_|rk_live_)[A-Za-z0-9_-]{6,}\b",
        r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b",
        r#"(?i)\b(?:api[-_ ]?key|auth(?:orization)?|access[-_ ]?token|refresh[-_ ]?token|npm[-_ ]?token|password|cookie|secret|credential)\s*(?:[:=]|\bis\b)\s*[\"']?[^\s\"';,]+"#,
        r"\b[A-Za-z0-9+/_=-]{28,}\b",
    ];
    let patterns = masks
        .iter()
        .map(|s| Regex::new(s).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    fn clean(text: &str, secrets: &[String], patterns: &[Regex]) -> String {
        let mut value = text.to_string();
        for secret in secrets {
            value = value.replace(secret, "[REDACTED]");
        }
        for pattern in patterns {
            value = pattern.replace_all(&value, "[REDACTED]").to_string();
        }
        value
    }
    let mut sanitized = result.clone();
    for field in ["summary", "reason", "user_action"] {
        if let Some(value) = result[field].as_str() {
            sanitized[field] = json!(clean(value, &secrets, &patterns));
        }
    }
    if let Some(items) = result["evidence"].as_array() {
        sanitized["evidence"] = json!(items
            .iter()
            .map(|item| item
                .as_str()
                .map(|s| clean(s, &secrets, &patterns))
                .unwrap_or_default())
            .collect::<Vec<_>>());
    }
    if let Some(value) = result
        .pointer("/notification/details")
        .and_then(Value::as_str)
    {
        sanitized["notification"]["details"] = json!(clean(value, &secrets, &patterns));
    }
    Ok(sanitized)
}
