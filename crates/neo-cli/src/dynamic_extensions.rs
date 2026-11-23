//! Explicit specialized Node adapters that remain dynamic by design.
//! This is not a general Node fallback for core Harness commands: only
//! allowlisted Eval / Compute entrypoints may cross this runtime boundary.
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

const EVAL_HELP: &str = "usage: neo eval run|list|audit [project Eval options]";
const COMPUTE_HELP: &str = "usage: neo compute build|run|web|services|doctor|cleanup [options]";
fn script(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let candidate = root.join(rel);
    let actual = candidate
        .canonicalize()
        .map_err(|e| format!("Optional Node extension asset {rel} unavailable: {e}"))?;
    if !actual.starts_with(root) || !actual.is_file() {
        return Err(format!(
            "Optional Node extension asset {rel} is outside its versioned Harness bundle"
        ));
    }
    Ok(actual)
}
fn delegate(rel: &str, args: &[String]) -> Result<i32, String> {
    let root = crate::workspace::harness_root()?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let script = script(&root, rel)?;
    let result = Command::new("node")
        .arg(script)
        .args(args)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|e| format!("Optional {rel} extension needs an installed Node.js runtime: {e}"))?;
    Ok(result.code().unwrap_or(1))
}

pub fn eval(args: &[String]) -> Result<i32, String> {
    let (sub, params) = if let Some((first, rest)) = args.split_first() {
        (first.as_str(), rest)
    } else {
        ("run", args)
    };
    let (script, argv) = match sub {
        "run" => ("scripts/eval-project-worker-prompts.mjs", params.to_vec()),
        "list" => {
            let mut items = vec!["--list".to_string()];
            items.extend_from_slice(params);
            ("scripts/eval-project-worker-prompts.mjs", items)
        }
        "audit" => {
            if !params.is_empty() {
                return Err("usage: neo eval audit".into());
            }
            ("scripts/audit-project-worker-evals.mjs", Vec::new())
        }
        "--help" | "-h" => {
            if !params.is_empty() {
                return Err(EVAL_HELP.into());
            }
            (
                "scripts/eval-project-worker-prompts.mjs",
                vec!["--help".into()],
            )
        }
        _ => return Err(EVAL_HELP.into()),
    };
    // The Node project-eval runner is the sole owner of authenticated Codex
    // evals, Relay prompt construction and report evidence. Rust only handles
    // transport and does not imitate those domain evaluators.
    delegate(script, &argv)
}

pub fn compute(args: &[String]) -> Result<i32, String> {
    if let Some(first) = args.first() {
        if !matches!(
            first.as_str(),
            "build" | "run" | "web" | "services" | "doctor" | "cleanup" | "--help" | "help" | "-h"
        ) {
            return Err(COMPUTE_HELP.into());
        }
        if matches!(first.as_str(), "services" | "doctor") && args.len() != 1 {
            return Err(COMPUTE_HELP.into());
        }
        if matches!(first.as_str(), "--help" | "help" | "-h") && args.len() != 1 {
            return Err(COMPUTE_HELP.into());
        }
    }
    delegate("gpu/cli.mjs", args)
}

/// Extra tracked JS extension assets that the native bundle intentionally
/// includes. All other JS sources remain absent from the native package.
pub const EVAL_ASSETS: &[&str] = &[
    "scripts/eval-project-worker-prompts.mjs",
    "scripts/audit-project-worker-evals.mjs",
    "scripts/resolve-relay-cli.mjs",
    ".bin/workspace-config.mjs",
];

pub fn has_bundled_extension(root: &Path, path: &str) -> bool {
    fs::symlink_metadata(root.join(path)).is_ok_and(|m| m.is_file() && !m.file_type().is_symlink())
}
