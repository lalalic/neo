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

/// Owner-taught records use a distinct, stable identity. A human-confirmed
/// procedure is guidance, not proof that the execution was verified.
pub fn prepare_taught(
    candidate: &Value,
    engine: &str,
    model: &str,
    now: &str,
) -> Result<Value, String> {
    if !candidate.is_object() {
        return Err("Invalid taught lesson".into());
    }
    let scenario = category_key(candidate["scenario_key"].as_str().unwrap_or(""), "");
    let strategy = category_key(candidate["strategy_key"].as_str().unwrap_or(""), "");
    if scenario.is_empty() || strategy.is_empty() {
        return Err("Teaching requires safe stable scenario and strategy keys".into());
    }
    let completed = json!({"status":"resolved"});
    let base = prepare(&Input {
        handoff: "owner-taught lesson",
        result: &completed,
        experience: Some(candidate),
        events: &[],
        backend: "local",
        engine,
        model,
        capture_method: "executor",
        error_class: None,
        captured_at: now,
    })?;
    if !base["strategy"]["steps"]
        .as_array()
        .is_some_and(|items| !items.is_empty())
        || base["strategy"]["lesson"].as_str().unwrap_or("").is_empty()
        || base["scenario"]["symptom"]
            .as_str()
            .unwrap_or("")
            .is_empty()
    {
        return Err("Teaching requires symptom, at least one step, and principle".into());
    }
    let mut record = base;
    record["scenario"]["symptom"] =
        json!(sanitize(candidate["symptom"].as_str().unwrap_or(""), 400));
    let steps = candidate["steps"]
        .as_array()
        .ok_or("Teaching requires steps")?
        .iter()
        .take(12)
        .filter_map(Value::as_str)
        .map(|text| sanitize(text, 450))
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>();
    if steps.is_empty() {
        return Err("Teaching requires at least one safe step".into());
    }
    record["strategy"]["steps"] = json!(steps);
    record["strategy"]["verification"] = json!(sanitize(
        candidate["verification"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("Not verified; owner described procedure"),
        400
    ));
    record["strategy"]["lesson"] = json!(sanitize(candidate["lesson"].as_str().unwrap_or(""), 550));
    record["id"] = json!(sha(&serde_json::to_string(&json!([
        scenario, "taught", strategy
    ]))
    .map_err(|e| e.to_string())?));
    record["source"] = json!("owner_taught");
    record["outcome"] = json!("taught");
    record["owner_confirmed"] = json!(true);
    record["observation"] = json!({"tools":[],"calls":0,"failures":0});
    record["training_reviewed"] = json!(false);
    Ok(record)
}
fn validate_taught(record: &Value) -> Result<(), String> {
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
            "owner_confirmed",
            "tool_verified",
            "verification_evidence",
        ],
    ) || record["source"] != "owner_taught"
        || record["outcome"] != "taught"
        || record["owner_confirmed"] != true
        || record["version"] != 1
        || record["training_reviewed"] != false
    {
        return Err("Only confirmed owner-taught lessons can be saved".into());
    }
    let scenario = record
        .pointer("/scenario/key")
        .and_then(Value::as_str)
        .unwrap_or("");
    let strategy = record
        .pointer("/strategy/key")
        .and_then(Value::as_str)
        .unwrap_or("");
    let expected = sha(
        &serde_json::to_string(&json!([scenario, "taught", strategy]))
            .map_err(|e| e.to_string())?,
    );
    if !hex64(record["id"].as_str().unwrap_or(""))
        || record["id"] != expected
        || category_key(scenario, "") != scenario
        || category_key(strategy, "") != strategy
    {
        return Err("Teaching record has an invalid classification identity".into());
    }
    if !only_keys(&record["scenario"], &["key", "category", "symptom"])
        || !only_keys(
            &record["strategy"],
            &["key", "steps", "verification", "failure_reason", "lesson"],
        )
        || !only_keys(&record["observation"], &["tools", "calls", "failures"])
        || !only_keys(&record["runtime"], &["backend", "engine", "model_family"])
    {
        return Err("Teaching record contains unexpected raw tool or transcript metadata".into());
    }
    if !is_sanitized(&record["scenario"]["symptom"], 400)
        || !is_sanitized(&record["strategy"]["verification"], 400)
        || !is_sanitized(&record["strategy"]["lesson"], 550)
        || !is_sanitized(&record["strategy"]["failure_reason"], 180)
        || !record["strategy"]["steps"].as_array().is_some_and(|steps| {
            !steps.is_empty() && steps.len() <= 12 && steps.iter().all(|v| is_sanitized(v, 450))
        })
    {
        return Err("Teaching text was not safely sanitized".into());
    }
    if !record["observation"]["tools"].as_array().is_some()
        || record["observation"]["calls"].as_u64().is_none()
        || record["observation"]["failures"].as_u64().is_none()
    {
        return Err("Teaching observation must contain tool names and counters".into());
    }
    if record.get("verification_evidence").is_some()
        && !is_sanitized(&record["verification_evidence"], 240)
    {
        return Err("Teaching tool verification evidence was not sanitized".into());
    }
    if record.get("tool_verified").is_some_and(|v| !v.is_boolean()) {
        return Err("Teaching tool verification flag must be a boolean".into());
    }
    if !record["captured_at"]
        .as_str()
        .is_some_and(|s| chrono::DateTime::parse_from_rfc3339(s).is_ok())
    {
        return Err("Teaching record needs a valid timestamp".into());
    }
    Ok(())
}
/// Create-if-absent for the first owner-confirmed lesson; subsequent owner
/// revisions replace *only another taught lesson*, never observed executions.
pub fn store_taught(record: &Value, dir: &Path) -> Result<Value, String> {
    validate_taught(record)?;
    if !dir.is_absolute() {
        return Err("Owner-taught Experience path must be absolute".into());
    }
    private_dir(dir)?;
    let id = record["id"].as_str().unwrap_or_default();
    let output = dir.join(format!("{id}.json"));
    let existing = match fs::symlink_metadata(&output) {
        Ok(meta) => {
            if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 2 * 1024 * 1024 {
                return Err("Unsafe existing lesson path".into());
            }
            let saved: Value =
                serde_json::from_slice(&fs::read(&output).map_err(|e| e.to_string())?)
                    .map_err(|_| "Existing lesson record is not valid JSON")?;
            if saved["source"] != "owner_taught" || saved["outcome"] != "taught" {
                return Err("Cannot overwrite observed Escalation evidence".into());
            }
            true
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(e) => return Err(e.to_string()),
    };
    if !existing {
        return write_taught(record, dir, &output, false);
    }
    write_taught(record, dir, &output, true)
}
fn write_taught(
    record: &Value,
    dir: &Path,
    output: &Path,
    replacing: bool,
) -> Result<Value, String> {
    let id = record["id"].as_str().unwrap_or_default();
    let scratch = dir.join(format!(".{id}.{}.tmp", Uuid::new_v4()));
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    opts.mode(0o600);
    let mut file = opts.open(&scratch).map_err(|e| e.to_string())?;
    let result = (|| {
        let bytes = serde_json::to_string_pretty(record).map_err(|e| e.to_string())? + "\n";
        file.write_all(bytes.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        if replacing {
            fs::rename(&scratch, output).map_err(|e| e.to_string())?;
        } else {
            fs::hard_link(&scratch, output).map_err(|e| e.to_string())?;
        }
        Ok(json!({"stored":true,"updated":replacing,"id":id}))
    })();
    let _ = fs::remove_file(scratch);
    result
}

fn tokens(text: &str) -> std::collections::BTreeSet<String> {
    let words = rx(r"(?i)[a-z][a-z0-9_-]{2,}|[\p{Han}]{2,}");
    let stop = [
        "with", "from", "have", "that", "this", "when", "after", "before", "should", "error",
        "failed", "using", "into", "need", "your", "user", "then", "what", "can", "怎么", "什么",
        "这个", "那个", "需要", "失败", "完成", "进行", "可以", "如何",
    ];
    let mut found = std::collections::BTreeSet::<String>::new();
    for item in words.find_iter(&text.to_lowercase()) {
        let word = item.as_str();
        if word
            .chars()
            .all(|c| (0x4e00..=0x9fff).contains(&(c as u32)))
        {
            let chars = word.chars().collect::<Vec<_>>();
            for pair in chars.windows(2) {
                let term = pair.iter().collect::<String>();
                if !stop.contains(&term.as_str()) {
                    found.insert(term);
                }
            }
        } else if !stop.contains(&word) {
            found.insert(word.into());
        }
    }
    found
}
/// Relevant owner-taught lessons are untrusted suggestions, not elevated
/// system authority or already verified outcomes.
pub fn render_taught(handoff: &str, dir: &Path, limit: usize) -> Result<String, String> {
    let terms = tokens(handoff);
    if terms.is_empty() || !dir.exists() {
        return Ok(String::new());
    }
    let meta = fs::symlink_metadata(dir).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("Unsafe Experience history directory".into());
    }
    let mut items = Vec::<(usize, String, Value)>::new();
    let paths = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if paths.len() > 100000 {
        return Err("Too many Experience records".into());
    }
    for entry in paths {
        let path = entry.path();
        if !path
            .file_name()
            .and_then(|v| v.to_str())
            .is_some_and(|s| s.len() == 69 && s.ends_with(".json"))
        {
            continue;
        }
        let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 2 * 1024 * 1024 {
            continue;
        }
        let Ok(value) =
            serde_json::from_slice::<Value>(&fs::read(&path).map_err(|e| e.to_string())?)
        else {
            continue;
        };
        if value["source"] != "owner_taught"
            || value["owner_confirmed"] != true
            || validate_taught(&value).is_err()
        {
            continue;
        }
        let scenario = value["scenario"]["key"]
            .as_str()
            .unwrap_or("")
            .replace(['.', '_'], " ");
        let strategy = value["strategy"]["key"]
            .as_str()
            .unwrap_or("")
            .replace(['.', '_'], " ");
        let mut surface = format!(
            "{} {} {} {} {}",
            scenario,
            value["scenario"]["symptom"].as_str().unwrap_or(""),
            strategy,
            value["strategy"]["lesson"].as_str().unwrap_or(""),
            value["strategy"]["steps"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" ")
        );
        surface.make_ascii_lowercase();
        let overlap = terms.intersection(&tokens(&surface)).count();
        if overlap >= 2 {
            items.push((
                overlap,
                value["captured_at"].as_str().unwrap_or("").into(),
                value,
            ));
        }
    }
    items.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    let mut blocks = Vec::<String>::new();
    for (_, _, record) in items.into_iter().take(limit.min(4)) {
        let mut lines = vec![
            format!(
                "Scenario: {}",
                record["scenario"]["symptom"].as_str().unwrap_or("")
            ),
            format!(
                "Strategy: {}",
                record["strategy"]["key"].as_str().unwrap_or("")
            ),
        ];
        for (i, step) in record["strategy"]["steps"]
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .enumerate()
        {
            lines.push(format!("{}. {}", i + 1, step.as_str().unwrap_or("")));
        }
        lines.push(format!(
            "Verify: {}",
            record["strategy"]["verification"].as_str().unwrap_or("")
        ));
        lines.push(format!(
            "Lesson: {}",
            record["strategy"]["lesson"].as_str().unwrap_or("")
        ));
        blocks.push(lines.join("\n"));
    }
    Ok(blocks.join("\n\n").chars().take(4500).collect())
}

/// Optional post-run local model summary. The recorder sees only a sanitized
/// scenario/outcome and observed tool names and counts: never a raw transcript,
/// tool command arguments, or the original Handoff in plaintext.
pub fn generate_with<M>(
    prompt: &str,
    handoff: &str,
    result: &Value,
    events: &[Value],
    mut model: M,
) -> Result<Value, String>
where
    M: FnMut(&Value) -> Result<Value, String>,
{
    if prompt.trim().is_empty() {
        return Err("Experience recorder instructions missing".into());
    }
    let stats = observed(events);
    let context = json!({"sanitized_scenario":sanitize(handoff,1100),
        "outcome":result["status"],
        "result_summary":sanitize(result["summary"].as_str().unwrap_or(""),250),
        "result_reason":sanitize(result["reason"].as_str().unwrap_or(""),220),
        "observed_tools":stats["tools"],"tool_calls":stats["calls"],"tool_errors":stats["failures"]});
    let request = json!({"model":"neo-escalation","messages":[
        {"role":"system","content":prompt},
        {"role":"user","content":context.to_string()}],
        "temperature":0,"max_tokens":950,"response_format":{"type":"json_object"},
        "chat_template_kwargs":{"enable_thinking":false}});
    let response = model(&request)?;
    let text = response
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or("Local Experience recorder produced no JSON text")?;
    let candidate: Value = serde_json::from_str(text.trim())
        .map_err(|_| "Local Experience recorder returned malformed JSON")?;
    if !candidate.is_object() {
        return Err("Local Experience candidate is not an object".into());
    }
    Ok(candidate)
}
