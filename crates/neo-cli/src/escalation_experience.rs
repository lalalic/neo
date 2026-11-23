//! Summarized, redacted Escalation Experience records. Never store full
//! handoffs, tool args/output, model transcripts, or credentials in Case JSON.
use regex::Regex;
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

fn sha(raw: &str) -> String {
    Sha256::digest(raw.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn rx(regex: &str) -> Regex {
    Regex::new(regex).expect("constant Experience sanitizer regex")
}
fn valid_key_text(input: &str) -> bool {
    !(input.contains('@')
        || input.contains("/Users/")
        || input.contains("/private/")
        || rx(r"(?i)https?://|\bsk-[a-z0-9_-]{8,}").is_match(input))
}
pub fn category_key(input: &str, fallback: &str) -> String {
    if !valid_key_text(input) {
        return fallback.into();
    }
    let lower = input.trim().to_ascii_lowercase();
    let mut text = rx(r"[^a-z0-9._ -]+").replace_all(&lower, "").to_string();
    text = rx(r"[\s-]+").replace_all(&text, "_").to_string();
    text = rx(r"_+").replace_all(&text, "_").to_string();
    text = rx(r"\.+").replace_all(&text, ".").to_string();
    text = text.trim_matches(|c| matches!(c, '_' | '.')).to_string();
    if !(3..=84).contains(&text.len())
        || rx(r"[a-f0-9]{20,}").is_match(&text)
        || text.split(['.', '_']).any(|part| part.len() > 36)
    {
        return fallback.into();
    }
    text
}
pub fn sanitize(input: &str, max: usize) -> String {
    let mut value = input.to_string();
    let patterns = [
        (r#"(?i)(?:https?://|www\.)[^\s"'<>]+"#, "[url]"),
        (r"(?i)[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", "[email]"),
        (r"(?i)\b(?:Bearer|Basic)\s+[a-z0-9._~+/-]+", "[credential]"),
        (
            r"(?i)\b(?:sk|pk|rk|ghp|gho|glpat|xoxb|xoxp)-[a-z0-9_-]{8,}\b",
            "[credential]",
        ),
        (
            r"(?i)\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|password|cookie|secret)\s*[:=]\s*[^\s,;]+",
            "[credential]",
        ),
        (
            r"\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b",
            "[credential]",
        ),
        (
            r#"(?:/Users/|/private/|/tmp/|~/|[A-Za-z]:\\)[^\s"'<>;,]+"#,
            "[path]",
        ),
        (r"\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b", "[ip]"),
        (r"(?i)\b(?:[a-f0-9]{8}-){1,}[a-f0-9]{12}\b", "[identifier]"),
        (
            r"(?i)\b(?:otp|one[- ]time[- ]code|verification[- ]code|passcode)\s*(?:[:=]|is)?\s*[0-9]{4,8}\b",
            "[one-time-code]",
        ),
        (r"\b[0-9]{6,}\b", "[identifier]"),
    ];
    for (pattern, to) in patterns {
        value = rx(pattern).replace_all(&value, to).to_string();
    }
    let long = rx(r"\b[a-zA-Z0-9_-]{18,}\b");
    value = long
        .replace_all(&value, |caps: &regex::Captures<'_>| {
            match caps.get(0).map(|m| m.as_str()).unwrap_or("") {
                "createIsolatedWorld" | "account_name_text_field" | "password_text_field" => {
                    caps[0].to_string()
                }
                _ => "[identifier]".into(),
            }
        })
        .to_string();
    value = rx(r"[\r\n\t]+").replace_all(&value, " ").to_string();
    value = rx(r"\s+").replace_all(&value, " ").trim().to_string();
    value.chars().take(max).collect()
}
pub fn observed(events: &[Value]) -> Value {
    let mut tools = std::collections::BTreeSet::<String>::new();
    let (mut calls, mut failures) = (0_u32, 0_u32);
    let commands = rx(r"\b(webhelm|wechat-bro|imsg)\b");
    let computer = rx(r"\bneo\s+computer-use\b");
    for event in events {
        if event["type"] == "tool_result" {
            if event["is_error"] == true {
                failures += 1;
            }
            continue;
        }
        if event["type"] != "tool_use" {
            continue;
        }
        calls += 1;
        let name = event["name"].as_str().unwrap_or("").to_lowercase();
        let command = event
            .pointer("/input/command")
            .and_then(Value::as_str)
            .unwrap_or("");
        if matches!(name.as_str(), "terminal" | "execute_code") {
            tools.insert("shell".into());
        }
        if matches!(name.as_str(), "skills" | "webhelm") {
            tools.insert(name.clone());
        }
        if matches!(name.as_str(), "computer_use" | "computer-use") {
            tools.insert("computer-use".into());
        }
        for hit in commands.find_iter(command) {
            let mapped = if hit.as_str() == "imsg" {
                "imessage"
            } else {
                hit.as_str()
            };
            tools.insert(mapped.into());
        }
        if computer.is_match(command) {
            tools.insert("computer-use".into());
        }
    }
    json!({"tools":tools.into_iter().collect::<Vec<_>>(),"calls":calls,"failures":failures})
}

pub struct Input<'a> {
    pub handoff: &'a str,
    pub result: &'a Value,
    pub experience: Option<&'a Value>,
    pub events: &'a [Value],
    pub backend: &'a str,
    pub engine: &'a str,
    pub model: &'a str,
    pub capture_method: &'a str,
    pub error_class: Option<&'a str>,
    pub captured_at: &'a str,
}
pub fn prepare(input: &Input<'_>) -> Result<Value, String> {
    let status = input.result["status"].as_str().unwrap_or("");
    if !matches!(status, "resolved" | "failed" | "needs_user") {
        return Err("Experience outcome must be resolved, failed or needs_user".into());
    }
    let agent = input.experience.unwrap_or(&Value::Null);
    let category = agent["category"]
        .as_str()
        .filter(|s| {
            matches!(
                *s,
                "authentication"
                    | "permissions"
                    | "browser"
                    | "desktop"
                    | "shell"
                    | "network"
                    | "tooling"
                    | "human"
                    | "runtime"
                    | "other"
            )
        })
        .unwrap_or("other");
    let scenario = category_key(agent["scenario_key"].as_str().unwrap_or(""), "");
    let strategy = category_key(agent["strategy_key"].as_str().unwrap_or(""), "");
    let scenario_key = if scenario.is_empty() {
        format!("unclassified.{}", &sha(input.handoff)[..16])
    } else {
        scenario
    };
    let strategy_key = if strategy.is_empty() {
        input.error_class.map_or_else(
            || "unclassified".into(),
            |e| format!("runtime.{}", category_key(e, "error")),
        )
    } else {
        strategy
    };
    let source = if agent["scenario_key"]
        .as_str()
        .is_some_and(|s| !category_key(s, "").is_empty())
        && agent["strategy_key"]
            .as_str()
            .is_some_and(|s| !category_key(s, "").is_empty())
    {
        if input.capture_method == "postrun_model" {
            "postrun_model"
        } else {
            "agent"
        }
    } else {
        "fallback"
    };
    let id = sha(
        &serde_json::to_string(&json!([scenario_key, status, strategy_key]))
            .map_err(|e| e.to_string())?,
    );
    let mut steps = agent["steps"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .take(7)
                .map(|v| v.as_str().map(|s| sanitize(s, 165)).unwrap_or_default())
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    steps.truncate(7);
    let last = input
        .model
        .rsplit('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");
    let mut failure = sanitize(agent["failure_reason"].as_str().unwrap_or(""), 180);
    if failure.is_empty() {
        if let Some(class) = input.error_class {
            failure = format!("Runtime error class: {}", sanitize(class, 45));
        }
    }
    let record = json!({"version":1,"id":id,"captured_at":input.captured_at,
        "source":source,"scenario":{"key":scenario_key,"category":category,
            "symptom":sanitize(agent["symptom"].as_str().unwrap_or(""),220)},
        "outcome":status,
        "strategy":{"key":strategy_key,"steps":steps,
            "verification":sanitize(agent["verification"].as_str().unwrap_or(""),200),
            "failure_reason":failure,
            "lesson":sanitize(agent["lesson"].as_str().unwrap_or(""),200)},
        "observation":observed(input.events),
        "runtime":{"backend":category_key(input.backend,"local"),
            "engine":category_key(input.engine,"unknown"),
            "model_family":category_key(last,"unknown")},
        "training_reviewed":false});
    Ok(record)
}

fn private_dir(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true).mode(0o700);
        builder.create(path).map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("Experience storage must be a real directory".into());
    }
    #[cfg(unix)]
    if meta.permissions().mode() & 0o077 != 0 {
        return Err("Experience directory permissions must be 0700".into());
    }
    Ok(())
}
fn hex64(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|c| c.is_ascii_digit() || matches!(c, b'a'..=b'f'))
}
fn only_keys(value: &Value, allowed: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|o| o.keys().all(|k| allowed.contains(&k.as_str())))
}
fn is_sanitized(value: &Value, max: usize) -> bool {
    value
        .as_str()
        .is_some_and(|s| s.chars().count() <= max && sanitize(s, max) == s)
}
fn validated_prepared_record(record: &Value) -> Result<(), String> {
    if !only_keys(
        record,
        &[
            "version",
            "id",
            "captured_at",
            "source",
            "scenario",
            "outcome",
            "strategy",
            "observation",
            "runtime",
            "training_reviewed",
        ],
    ) || record["training_reviewed"] != false
    {
        return Err("Experience must be a prepared, unreviewed and redacted record".into());
    }
    if !matches!(
        record["source"].as_str(),
        Some("agent" | "postrun_model" | "fallback")
    ) {
        return Err("Experience has an unsupported source".into());
    }
    if !record["captured_at"]
        .as_str()
        .is_some_and(|s| chrono::DateTime::parse_from_rfc3339(s).is_ok())
    {
        return Err("Experience captured_at must be a validated timestamp".into());
    }
    let scenario = &record["scenario"];
    let strategy = &record["strategy"];
    let runtime = &record["runtime"];
    let observed = &record["observation"];
    if !only_keys(scenario, &["key", "category", "symptom"])
        || !only_keys(
            strategy,
            &["key", "steps", "verification", "failure_reason", "lesson"],
        )
        || !only_keys(runtime, &["backend", "engine", "model_family"])
        || !only_keys(observed, &["tools", "calls", "failures"])
    {
        return Err("Experience contains unexpected fields or raw tool metadata".into());
    }
    let source_key = scenario["key"].as_str().unwrap_or("");
    let strategy_key = strategy["key"].as_str().unwrap_or("");
    if source_key.is_empty()
        || strategy_key.is_empty()
        || category_key(source_key, "") != source_key
        || category_key(strategy_key, "") != strategy_key
    {
        return Err("Experience classification keys are unsafe".into());
    }
    if !matches!(
        scenario["category"].as_str(),
        Some(
            "authentication"
                | "permissions"
                | "browser"
                | "desktop"
                | "shell"
                | "network"
                | "tooling"
                | "human"
                | "runtime"
                | "other"
        )
    ) {
        return Err("Experience category is not allowed".into());
    }
    if !is_sanitized(&scenario["symptom"], 220)
        || !is_sanitized(&strategy["verification"], 200)
        || !is_sanitized(&strategy["failure_reason"], 180)
        || !is_sanitized(&strategy["lesson"], 200)
    {
        return Err("Experience text is not safely sanitized".into());
    }
    if !strategy["steps"]
        .as_array()
        .is_some_and(|a| a.len() <= 7 && a.iter().all(|v| is_sanitized(v, 165)))
    {
        return Err("Experience steps are not sanitized or exceed the limit".into());
    }
    for field in ["backend", "engine", "model_family"] {
        let value = runtime[field].as_str().unwrap_or("");
        if value.is_empty() || category_key(value, "") != value {
            return Err("Experience runtime metadata is unsafe".into());
        }
    }
    let allowed = [
        "shell",
        "webhelm",
        "computer-use",
        "wechat-bro",
        "imessage",
        "skills",
    ];
    if !observed["tools"].as_array().is_some_and(|a| {
        a.len() <= allowed.len()
            && a.iter()
                .all(|v| v.as_str().is_some_and(|s| allowed.contains(&s)))
    }) || observed["calls"].as_u64().is_none()
        || observed["failures"].as_u64().is_none()
    {
        return Err("Experience observation must contain only tool names and counts".into());
    }
    let expected =
        sha(
            &serde_json::to_string(&json!([source_key, record["outcome"], strategy_key]))
                .map_err(|e| e.to_string())?,
        );
    if record["id"] != expected {
        return Err("Experience identifier does not match its classification".into());
    }
    Ok(())
}

pub fn store(record: &Value, dir: &Path) -> Result<Value, String> {
    let id = record.get("id").and_then(Value::as_str).unwrap_or("");
    validated_prepared_record(record)?;
    if !hex64(id)
        || record["version"] != 1
        || !matches!(
            record["outcome"].as_str(),
            Some("resolved" | "failed" | "needs_user")
        )
    {
        return Err("Invalid experience identifier or outcome".into());
    }
    if !dir.is_absolute() {
        return Err("NEO_ESCALATION_CASES_DIR must be an absolute local path".into());
    }
    private_dir(dir)?;
    let output = dir.join(format!("{id}.json"));
    if fs::symlink_metadata(&output).is_ok() {
        let meta = fs::symlink_metadata(&output).map_err(|e| e.to_string())?;
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err("Unsafe existing Experience file".into());
        }
        return Ok(json!({"stored":false,"duplicate":true,"id":id}));
    }
    let scratch = dir.join(format!(".{id}.{}.tmp", Uuid::new_v4()));
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    opts.mode(0o600);
    let mut file = opts.open(&scratch).map_err(|e| e.to_string())?;
    let result = (|| {
        let text = serde_json::to_string_pretty(record).map_err(|e| e.to_string())? + "\n";
        file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        match fs::hard_link(&scratch, &output) {
            Ok(()) => Ok(json!({"stored":true,"duplicate":false,"id":id})),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                Ok(json!({"stored":false,"duplicate":true,"id":id}))
            }
            Err(e) => Err(e.to_string()),
        }
    })();
    let _ = fs::remove_file(scratch);
    result
}
pub fn directory() -> Result<PathBuf, String> {
    let path = env::var_os("NEO_ESCALATION_CASES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            crate::workspace::home()
                .unwrap_or_default()
                .join(".local/share/neo/escalation/cases")
        });
    if !path.is_absolute() {
        return Err("NEO_ESCALATION_CASES_DIR must be an absolute local path".into());
    }
    Ok(path)
}
