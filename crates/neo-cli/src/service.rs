//! Native Neo Harness service CLI is an inventory/control facade only.
//! PM2 and native NeoY launchd remain the exclusive service lifecycle owners.
use crate::process_guard;
use serde_json::{json, Value};
use std::{process::Command, time::Duration};

const USAGE: &str = "usage: neo service list | status NAME | start|stop|restart NAME --apply";
const NATIVE_LABEL: &str = "com.neox.neoy.keepalive";
fn invoke(name: &str, args: &[&str]) -> Result<(i32, String, String), String> {
    let mut cmd = Command::new(name);
    cmd.args(args);
    let result = process_guard::capture(&mut cmd, Duration::from_secs(20), 16 * 1024 * 1024)
        .map_err(|e| format!("Cannot run {name}: {e}"))?;
    Ok((
        result.status.code().unwrap_or(1),
        String::from_utf8_lossy(&result.stdout).to_string(),
        String::from_utf8_lossy(&result.stderr).to_string(),
    ))
}
fn pid(text: &str) -> Option<u64> {
    text.lines().find_map(|line| {
        line.trim_start()
            .strip_prefix("pid = ")
            .and_then(|s| s.trim().parse().ok())
    })
}
fn state(text: &str) -> String {
    text.lines()
        .find_map(|line| line.trim_start().strip_prefix("state = ").map(str::trim))
        .unwrap_or("unknown")
        .to_string()
}
fn rows() -> Result<Vec<Value>, String> {
    let mut entries = Vec::<Value>::new();
    match invoke("pm2", &["jlist"]) {
        Ok((0, stdout, _)) => {
            let source: Value =
                serde_json::from_str(&stdout).map_err(|_| "invalid pm2 jlist JSON".to_string())?;
            let values = source.as_array().ok_or("invalid pm2 jlist JSON")?;
            for row in values {
                let Some(name) = row["name"].as_str() else {
                    continue;
                };
                entries.push(json!({"name":name,
                    "state":row.pointer("/pm2_env/status").and_then(Value::as_str).unwrap_or("unknown"),
                    "pid":row.get("pid").cloned().unwrap_or(Value::Null),"manager":"pm2",
                    "managed":true,"health":"not_checked"}));
            }
        }
        Ok((_, _, stderr)) => eprintln!("PM2 unavailable: {}", stderr.trim()),
        Err(e) => eprintln!("PM2 unavailable: {e}"),
    }
    let label = format!("gui/{}/{NATIVE_LABEL}", unsafe { libc::getuid() });
    if let Ok((0, launch, _)) = invoke("launchctl", &["print", &label]) {
        let duplicated = entries
            .iter()
            .any(|r| r["name"] == "neoy" || r["name"] == "neoy/app");
        entries.retain(|r| r["name"] != "neoy" && r["name"] != "neoy/app");
        let mut neoy = json!({"name":"neoy/app","nativeLabel":NATIVE_LABEL,
            "state":state(&launch),"pid":pid(&launch),"manager":"launchd",
            "managed":true,"health":"not_checked"});
        if duplicated {
            neoy["warning"] =
                json!("legacy PM2 neoy duplicate detected; native launchd is authoritative");
        }
        entries.push(neoy);
    }
    if entries.is_empty() {
        return Err("no accessible PM2 or NeoY launchd service manager".into());
    }
    entries.sort_by_key(|r| r["name"].as_str().unwrap_or("").to_lowercase());
    Ok(entries)
}
fn safe_name(name: &str) -> bool {
    let mut chars = name.bytes();
    chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'.' | b'/' | b'-'))
}

pub fn run(args: &[String]) -> Result<(Option<Value>, i32), String> {
    let (action, rest) = args.split_first().ok_or(USAGE)?;
    if !matches!(
        action.as_str(),
        "list" | "status" | "start" | "stop" | "restart"
    ) {
        return Err(USAGE.into());
    }
    let rows = rows()?;
    if action == "list" && rest.is_empty() {
        return Ok((Some(json!(rows)), 0));
    }
    if action == "status" && rest.len() == 1 {
        let found = rows.iter().find(|r| r["name"] == rest[0]);
        return found
            .map(|row| (Some(row.clone()), 0))
            .ok_or_else(|| format!("unknown managed service: {}", rest[0]));
    }
    if matches!(action.as_str(), "start" | "stop" | "restart")
        && rest.len() == 2
        && rest[1] == "--apply"
    {
        let name = rest[0].as_str();
        if !safe_name(name) {
            return Err("invalid service name".into());
        }
        let entry = rows
            .iter()
            .find(|row| row["name"] == name)
            .ok_or_else(|| format!("unknown managed service: {name}"))?;
        let result = if entry["manager"] == "launchd" {
            if action == "stop" {
                return Err("NeoY launchd keepalive cannot be stopped safely by this CLI; use the native setup/installer lifecycle".into());
            }
            let target = format!("gui/{}/{NATIVE_LABEL}", unsafe { libc::getuid() });
            let flags = if action == "restart" {
                vec!["kickstart", "-k", target.as_str()]
            } else {
                vec!["kickstart", target.as_str()]
            };
            invoke("launchctl", &flags)?
        } else {
            invoke("pm2", &[action.as_str(), name])?
        };
        if !result.1.is_empty() {
            print!("{}", result.1);
        }
        if !result.2.is_empty() {
            eprint!("{}", result.2);
        }
        return Ok((None, result.0));
    }
    Err(USAGE.into())
}
