//! Native Project setup handoff. Browser navigation is explicit; this does
//! not submit a ChatGPT prompt or create/manage a browser automation session.
use serde_json::{json, Value};
use std::{path::Path, process::Command};

pub struct SetupLaunch {
    pub url: String,
    pub project: String,
    pub bootstrap: String,
}
pub fn prepare(meta: &Value) -> Result<SetupLaunch, String> {
    let project = meta["xchat_project"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("Project resolution lacks a project identity")?;
    let bootstrap = meta
        .pointer("/setup/bootstrap")
        .and_then(Value::as_str)
        .filter(|s| Path::new(s).is_absolute())
        .ok_or("project has no setup/bootstrap.md")?;
    let path = Path::new(bootstrap);
    if !path.is_file() {
        return Err("project setup/bootstrap.md is not available".into());
    }
    let prompt=format!("Set up {project} using @neo on my Mac. Read and follow this bootstrap file at its absolute path: {bootstrap}. Check existing state first, ask for necessary permissions, and verify the real outcome.");
    let mut target = url::Url::parse("https://chatgpt.com/").map_err(|e| e.to_string())?;
    target.query_pairs_mut().append_pair("prompt", &prompt);
    Ok(SetupLaunch {
        url: target.into(),
        project: project.into(),
        bootstrap: bootstrap.into(),
    })
}
pub fn run_with<F>(meta: &Value, mut opener: F) -> Result<Value, String>
where
    F: FnMut(&str) -> Result<(), String>,
{
    let launch = prepare(meta)?;
    opener(&launch.url)?;
    Ok(
        json!({"project":launch.project,"bootstrap":launch.bootstrap,
        "opened":true,"browser":"Google Chrome","promptSubmitted":false}),
    )
}
pub fn run(meta: &Value) -> Result<Value, String> {
    run_with(meta, |url| {
        let result = Command::new("/usr/bin/open")
            .args(["-a", "Google Chrome", url])
            .output()
            .map_err(|e| format!("Cannot open Google Chrome: {e}"))?;
        if !result.status.success() {
            return Err(format!(
                "could not open Google Chrome: {}",
                String::from_utf8_lossy(&result.stderr).trim()
            ));
        }
        Ok(())
    })
}
