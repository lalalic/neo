use crate::{skill, workspace};
use serde::Serialize;
use std::{fs, path::Path};

#[derive(Debug, Serialize)]
#[allow(non_snake_case)]
pub struct Manifest {
    schemaVersion: u8,
    agentRules: String,
    bootstrap: String,
    skills: Vec<BootstrapSkill>,
}
#[derive(Debug, Serialize)]
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
fn required(path: &Path, name: &str) -> Result<String, String> {
    let text = fs::read_to_string(path)
        .map_err(|e| format!("{name} could not be read: {}: {e}", path.display()))?;
    if text.trim().is_empty() {
        return Err(format!("{name} is empty: {}", path.display()));
    }
    Ok(text.trim().to_string())
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
    let agent_rules = required(&home.join(".agents/AGENTS.md"), "Agent rules")?;
    let boot = required(
        &root.join("skills/xchat-orchestrator/xchat-bootstrap.md"),
        "XChat bootstrap",
    )?;
    let skills = skill::list(project, root)?
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
    Ok((
        Manifest {
            schemaVersion: 1,
            agentRules: agent_rules,
            bootstrap: boot,
            skills,
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
pub fn run(args: &[String], root: &Path) -> Result<String, String> {
    let (manifest, json) = build(args, root)?;
    if json {
        Ok(serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())? + "\n")
    } else {
        Ok(render(&manifest))
    }
}
