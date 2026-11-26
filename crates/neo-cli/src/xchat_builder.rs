//! Neo-owned XChat Harness Builder. Consumes provider-neutral prompt parts
//! from the Relay CLI, then chooses WebChat bootstrap placement/rendering.
//! Does not execute Codex Builder, mutate CODEX_HOME or launch a Worker.
use crate::{skill, workspace};
use neo_harness_cli::process_guard::capture_with_input_limit;
use neo_harness_cli::prompt_parts_client::relay_cli;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::Path, process::Command, time::Duration};

#[derive(Debug, Serialize)]
#[allow(non_snake_case)]
pub struct Manifest {
    schemaVersion: u8,
    agentRules: String,
    bootstrap: String,
    skills: Vec<BootstrapSkill>,
}
#[derive(Debug, Serialize, Deserialize)]
#[allow(non_snake_case)]
struct BootstrapSkill {
    name: String,
    description: String,
    absolutePath: String,
    path: String,
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    missing_required_skills: Option<Vec<String>>,
}
/// Resolve only the read-only Relay CLI Prompt Parts endpoint. Neo owns
/// XChat assembly; Codex Builder is never invoked by neo bootstrap.
fn parts(global: &Path, rules: &Path, skills: &[BootstrapSkill]) -> Result<Value, String> {
    let request = json!({
        "schema":"relay.prompt-parts.request.v1",
        "globalPath":global,
        "harnessRulesPath":rules,
        "skills":skills
    });
    let serialized = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
    let mut command = Command::new(relay_cli()?);
    command.args(["prompt", "--parts-stdin"]);
    let output = capture_with_input_limit(
        &mut command,
        Some(&serialized),
        Duration::from_secs(15),
        4 * 1024 * 1024,
        4 * 1024 * 1024,
    )
    .map_err(|e| format!("Relay Prompt Parts failed: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Relay Prompt Parts rejected bootstrap: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let body: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| "Relay returned invalid Prompt Parts JSON")?;
    if body["schema"] != "relay.prompt-parts.v1"
        || body["global"]["content"].as_str().is_none_or(str::is_empty)
        || body["harness"]["content"]
            .as_str()
            .is_none_or(str::is_empty)
        || !body["skills"].is_array()
    {
        return Err("Relay returned an incompatible Prompt Parts schema".into());
    }
    // Do not validate content against SHA/fingerprint values. The Relay
    // endpoint returns actual Prompt Parts; the Harness checks the typed
    // schema, readable text, and required fields. Any fingerprint is only
    // diagnostic metadata, never a prerequisite to consuming the content.
    Ok(body)
}
pub fn build(args: &[String], root: &Path) -> Result<(Manifest, bool), String> {
    let json = args.iter().any(|s| s == "--json");
    let options = args
        .iter()
        .filter(|s| s.as_str() != "--json")
        .collect::<Vec<_>>();
    let project = if options.is_empty() {
        None
    } else if options.len() == 2
        && options[0] == "--project"
        && !options[1].is_empty()
        && !options[1].starts_with('-')
    {
        Some(options[1].as_str())
    } else {
        return Err("usage: neo bootstrap [--json] [--project PATH]".to_string());
    };
    let home = workspace::home()?;
    let skills: Vec<BootstrapSkill> = skill::list(project, root)?
        .into_iter()
        .map(|s| {
            let missing = s.missing_required_skills.filter(|s| !s.is_empty());
            BootstrapSkill {
                name: s.name,
                description: s.description,
                path: s.path.clone(),
                absolutePath: s.path,
                available: s.requires_resolved != Some(false),
                missing_required_skills: missing,
            }
        })
        .collect();
    let canonical = parts(
        &home.join(".agents/AGENTS.md"),
        &root.join("skills/xchat-orchestrator/xchat-bootstrap.md"),
        &skills,
    )?;
    // Native XChat rendering consumes the validated shared Prompt Parts,
    // not another independently rebuilt skill catalog.
    let normalized_skills: Vec<BootstrapSkill> =
        serde_json::from_value(canonical["skills"].clone())
            .map_err(|e| format!("Relay returned an invalid normalized Skill catalog: {e}"))?;
    Ok((
        Manifest {
            schemaVersion: 1,
            agentRules: canonical["global"]["content"].as_str().unwrap().to_owned(),
            bootstrap: canonical["harness"]["content"].as_str().unwrap().to_owned(),
            skills: normalized_skills,
        },
        json,
    ))
}
pub fn render(manifest: &Manifest) -> String {
    let mut lines=vec![
        "# XChat Harness Bootstrap".to_string(),"".into(),
        "The following local agent rules and XChat bootstrap are authoritative for this session.".into(),
        "This is a dynamic snapshot; discover and load only task-relevant SKILL.md files.".into(),
        "MCP already provides tools. This manifest does not duplicate MCP tool inventory.".into(),
        "".into(),"## Local Agent Rules".into(),"".into(),manifest.agentRules.clone(),
        "".into(),"## XChat Bootstrap".into(),"".into(),manifest.bootstrap.clone(),
        "".into(),"## Discovered Skills".into(),"".into(),
        "The following catalog was discovered dynamically through neo skill list.".into(),
        "Each entry includes name, description, and absolutePath (the SKILL.md file to load on demand).".into(),"".into(),
    ];
    for item in &manifest.skills {
        let description = item
            .description
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        lines.push(format!("- name: `{}`", item.name));
        lines.push(format!("  description: {description}"));
        lines.push(format!("  absolutePath: `{}`", item.absolutePath));
        if !item.available {
            lines.push(format!(
                "  available: false (missing prerequisites: {})",
                item.missing_required_skills
                    .as_ref()
                    .map(|a| a.join(", "))
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "unknown".into())
            ));
        }
    }
    lines.join("\n") + "\n"
}
