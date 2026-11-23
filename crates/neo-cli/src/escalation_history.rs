//! Read-only native Escalation Case/Challenge history queries.
//! Durable execution and all model-process ownership remain separate until
//! the whole runtime/lock protocol can be migrated and accepted together.
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn private_root(env_var: &str, category: &str) -> Result<PathBuf, String> {
    let raw = env::var_os(env_var).map(PathBuf::from).unwrap_or_else(|| {
        crate::workspace::home()
            .unwrap_or_default()
            .join(format!(".local/share/neo/escalation/{category}"))
    });
    if !raw.is_absolute() {
        return Err(format!("{env_var} must be an absolute path"));
    }
    Ok(raw)
}
fn root_if_exists(path: &Path, secret: bool) -> Result<bool, String> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.to_string()),
    };
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("Invalid private Escalation library directory".into());
    }
    #[cfg(unix)]
    if secret && meta.permissions().mode() & 0o077 != 0 {
        return Err("Challenge storage directory must be a private real directory (0700)".into());
    }
    #[cfg(not(unix))]
    let _ = secret;
    Ok(true)
}
fn file_json(file: &Path, max: usize) -> Result<Value, String> {
    let meta = fs::symlink_metadata(file).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > max as u64 {
        return Err("Escalation history entry is unsafe or oversized".into());
    }
    serde_json::from_slice(&fs::read(file).map_err(|e| e.to_string())?)
        .map_err(|_| "Invalid Escalation history JSON".into())
}
fn hexdigest64(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'))
}
fn attempt_name(s: &str) -> bool {
    let Some((id, suffix)) = s.split_once('.') else {
        return false;
    };
    id.len() == 36
        && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
        && matches!(suffix, "started.json" | "checkpoint.json" | "finished.json")
}
fn limit_filter(options: &[String]) -> Result<(usize, String), String> {
    let mut search = String::new();
    let mut limit = 30_usize;
    if !options.len().is_multiple_of(2) {
        return Err("usage: neo escalation cases|challenges [--search TEXT] [--limit N]".into());
    }
    for fields in options.as_chunks::<2>().0 {
        match fields[0].as_str() {
            "--search" => search = fields[1].clone(),
            "--limit" => {
                limit = fields[1]
                    .parse::<usize>()
                    .map_err(|_| "Escalation limit must be 1..200")?
            }
            _ => {
                return Err(
                    "usage: neo escalation cases|challenges [--search TEXT] [--limit N]".into(),
                )
            }
        }
    }
    if !(1..=200).contains(&limit) {
        return Err("Escalation limit must be 1..200".into());
    }
    Ok((limit, search.to_lowercase()))
}
fn matching(data: &Value, query: &str) -> bool {
    query.is_empty()
        || serde_json::to_string(data)
            .unwrap_or_default()
            .to_lowercase()
            .contains(query)
}
fn sorted_paths(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut items = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .map(|entry| entry.map(|value| value.path()).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    if items.len() > 100000 {
        return Err("Escalation history directory contains too many entries".into());
    }
    items.sort();
    Ok(items)
}
fn cases(limit: usize, query: &str) -> Result<Value, String> {
    let dir = private_root("NEO_ESCALATION_CASES_DIR", "cases")?;
    if !root_if_exists(&dir, false)? {
        return Ok(json!([]));
    }
    let mut rows = Vec::new();
    for path in sorted_paths(&dir)? {
        let Some(filename) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        let Some(id) = filename.strip_suffix(".json") else {
            continue;
        };
        if !hexdigest64(id) {
            continue;
        }
        let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if !meta.is_file() || meta.file_type().is_symlink() {
            continue;
        }
        let value = file_json(&path, 2 * 1024 * 1024)?;
        if value["version"] != 1
            || !matches!(
                value["outcome"].as_str(),
                Some("resolved" | "failed" | "needs_user" | "taught")
            )
        {
            continue;
        }
        let subset = json!([
            value["scenario"],
            value["strategy"],
            value["outcome"],
            value.pointer("/observation/tools")
        ]);
        if matching(&subset, query) {
            rows.push(value);
        }
    }
    rows.sort_by(|a, b| {
        b["captured_at"]
            .as_str()
            .unwrap_or("")
            .cmp(a["captured_at"].as_str().unwrap_or(""))
    });
    rows.truncate(limit);
    Ok(json!(rows))
}
fn event_rank(v: &Value) -> u8 {
    match v["event"].as_str() {
        Some("started") => 0,
        Some("checkpoint") => 1,
        Some("finished") => 2,
        _ => 3,
    }
}
fn challenges(limit: usize, query: &str) -> Result<Value, String> {
    let dir = private_root("NEO_ESCALATION_CHALLENGES_DIR", "challenges")?;
    if !root_if_exists(&dir, true)? {
        return Ok(json!([]));
    }
    let mut rows = Vec::new();
    for folder in sorted_paths(&dir)? {
        let Some(id) = folder.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if !hexdigest64(id) || !root_if_exists(&folder, true)? {
            continue;
        }
        let challenge_file = folder.join("challenge.json");
        let Ok(meta) = fs::symlink_metadata(&challenge_file) else {
            continue;
        };
        if !meta.is_file() || meta.file_type().is_symlink() {
            continue;
        }
        let challenge = file_json(&challenge_file, 2 * 1024 * 1024)?;
        if challenge["version"] != 1 || challenge["id"] != id || !challenge.is_object() {
            continue;
        }
        let paths = sorted_paths(&folder)?;
        let names = paths
            .iter()
            .filter_map(|p| p.file_name().and_then(|s| s.to_str()).map(str::to_owned))
            .collect::<Vec<_>>();
        let mut events = Vec::new();
        for path in paths {
            let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            if !attempt_name(name) {
                continue;
            }
            let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if !meta.is_file() || meta.file_type().is_symlink() {
                continue;
            }
            let event = file_json(&path, 2 * 1024 * 1024)?;
            if event["challenge_id"] != id {
                continue;
            }
            if event["event"] == "checkpoint"
                && names.contains(&format!(
                    "{}.finished.json",
                    event["attempt_id"].as_str().unwrap_or("")
                ))
            {
                continue;
            }
            events.push(event);
        }
        events.sort_by(|a, b| {
            a["at"]
                .as_str()
                .unwrap_or("")
                .cmp(b["at"].as_str().unwrap_or(""))
                .then_with(|| {
                    a["attempt_id"]
                        .as_str()
                        .unwrap_or("")
                        .cmp(b["attempt_id"].as_str().unwrap_or(""))
                })
                .then_with(|| event_rank(a).cmp(&event_rank(b)))
        });
        let last = events
            .last()
            .and_then(|e| e["at"].as_str())
            .unwrap_or(challenge["created_at"].as_str().unwrap_or(""))
            .to_owned();
        let mut row = challenge;
        row["last_event_at"] = json!(last);
        row["attempts"] = json!(events);
        if matching(&row, query) {
            rows.push(row);
        }
    }
    rows.sort_by(|a, b| {
        b["last_event_at"]
            .as_str()
            .unwrap_or("")
            .cmp(a["last_event_at"].as_str().unwrap_or(""))
            .then_with(|| {
                b["created_at"]
                    .as_str()
                    .unwrap_or("")
                    .cmp(a["created_at"].as_str().unwrap_or(""))
            })
    });
    rows.truncate(limit);
    Ok(json!(rows))
}
pub fn run(args: &[String]) -> Result<Value, String> {
    let (category, rest) = args
        .split_first()
        .ok_or("usage: neo escalation cases|challenges")?;
    let (limit, search) = limit_filter(rest)?;
    match category.as_str() {
        "cases" => cases(limit, &search),
        "challenges" => challenges(limit, &search),
        _ => Err("usage: neo escalation cases|challenges".into()),
    }
}
