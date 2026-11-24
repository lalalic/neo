use serde_json::{json, Value};
use std::process::{Command, Output};

fn probe(binary: &str, args: &[&str]) -> Option<Output> {
    Command::new(binary).args(args).output().ok()
}
fn version(binary: &str, args: &[&str]) -> String {
    match probe(binary, args) {
        Some(output) if output.status.success() => {
            let data = if output.stdout.is_empty() {
                output.stderr
            } else {
                output.stdout
            };
            String::from_utf8_lossy(&data).trim().to_owned()
        }
        _ => "missing".into(),
    }
}

pub fn run(category: &str, args: &[String]) -> Result<(String, i32), String> {
    if !args.is_empty() {
        return Err(format!("usage: neo {category}"));
    }
    let gateway = probe(
        "curl",
        &[
            "--fail",
            "--silent",
            "--show-error",
            "--max-time",
            "3",
            "http://127.0.0.1:6767/",
        ],
    )
    .is_some_and(|result| {
        result.status.success() && String::from_utf8_lossy(&result.stdout).contains("mcp_endpoint")
    });
    let node = version("node", &["--version"]);
    let python = version("python3", &["--version"]);
    let mut value: Value = json!({
        "gateway_http":if gateway {"reachable"} else {"unreachable"},
        "mcp_federation":"not_checked",
        "node":node,"python":python,
    });
    if category == "doctor" {
        let mut remediation = Vec::new();
        if !gateway {
            remediation.push("Start or diagnose NeoY native gateway");
        }
        if node == "missing" {
            remediation
                .push("Optional: install Node.js for explicitly declared project JS workloads");
        }
        if python == "missing" {
            remediation.push("Optional: install Python 3 for project workloads that require it");
        }
        value["remediation"] = json!(remediation);
    }
    // Native discovery/bootstrap and MCP no longer require these legacy runtimes.
    // Keep their inventory fields for callers, but do not fail core readiness.
    let code = if gateway { 0 } else { 2 };
    Ok((
        serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?,
        code,
    ))
}
