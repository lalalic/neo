use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Serialize)]
pub struct Requirements {
    pub skills: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requires: Option<Requirements>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requires_resolved: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing_required_skills: Option<Vec<String>>,
}

fn yaml_scalar(value: &str) -> String {
    let raw = value.trim();
    if raw.len() >= 2 && raw.starts_with('\'') && raw.ends_with('\'') {
        raw[1..raw.len() - 1].replace("''", "'")
    } else if raw.len() >= 2 && raw.starts_with('"') && raw.ends_with('"') {
        serde_json::from_str::<String>(raw).unwrap_or_else(|_| raw[1..raw.len() - 1].to_string())
    } else {
        raw.to_string()
    }
}

fn scalar_block(lines: &[&str], mode: &str) -> String {
    let indent = lines
        .iter()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.len() - s.trim_start_matches(' ').len())
        .min()
        .unwrap_or(0);
    let mut normalized: Vec<&str> = lines
        .iter()
        .map(|s| if s.len() >= indent { &s[indent..] } else { "" })
        .collect();
    while normalized.last().is_some_and(|s| s.is_empty()) {
        normalized.pop();
    }
    if mode.starts_with('|') {
        return normalized.join("\n");
    }
    // YAML folded description: replace single newlines by a space, but
    // preserve paragraph breaks. The outer resolver trims trailing newline.
    let mut result = String::new();
    for (index, line) in normalized.iter().enumerate() {
        if index > 0 {
            let prior = normalized[index - 1];
            if prior.is_empty() || line.is_empty() {
                result.push('\n');
            } else {
                result.push(' ');
            }
        }
        result.push_str(line);
    }
    result
}

fn parse_skill(path: &Path) -> Option<Skill> {
    let content = fs::read_to_string(path).ok()?;
    if !content.starts_with("---\n") {
        return None;
    }
    let close = content[4..].find("\n---")? + 4;
    let lines = content[4..close].lines().collect::<Vec<_>>();
    let mut name = None;
    let mut description = None;
    let mut required = None;
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            i += 1;
            continue;
        }
        if line.starts_with(' ') {
            i += 1;
            continue;
        }
        let (key, val) = line.split_once(':')?;
        let key = key.trim();
        if !key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return None;
        }
        let val = val.trim();
        if key == "requires" {
            if !val.is_empty() {
                return None;
            }
            i += 1;
            if i >= lines.len() || lines[i].trim_end() != "  skills:" {
                return None;
            }
            let mut items = Vec::new();
            i += 1;
            while i < lines.len() && lines[i].starts_with("    - ") {
                let skill = yaml_scalar(lines[i][6..].trim());
                if skill.is_empty() {
                    return None;
                }
                items.push(skill);
                i += 1;
            }
            if i < lines.len() && lines[i].starts_with(' ') && !lines[i].trim().is_empty() {
                return None;
            }
            required = Some(items);
            continue;
        }
        if key == "description" || key == "name" {
            let value = if ["|", "|-", ">", ">-"].contains(&val) {
                let mut block = Vec::new();
                i += 1;
                while i < lines.len() && (lines[i].starts_with(' ') || lines[i].is_empty()) {
                    block.push(lines[i]);
                    i += 1;
                }
                scalar_block(&block, val)
            } else {
                i += 1;
                yaml_scalar(val)
            };
            if key == "name" {
                name = Some(value);
            } else {
                description = Some(value);
            }
            continue;
        }
        i += 1;
        // Unrelated nested metadata is not interpreted as a dependency.
        while i < lines.len() && (lines[i].starts_with(' ') || lines[i].is_empty()) {
            i += 1;
        }
    }
    let description = description.unwrap_or_default().trim().to_string();
    if description.is_empty() {
        return None;
    }
    let name = name.unwrap_or_default();
    let name = if name.trim().is_empty() {
        path.parent()?.file_name()?.to_string_lossy().to_string()
    } else {
        name.trim().to_string()
    };
    Some(Skill {
        name,
        description,
        path: path.to_string_lossy().to_string(),
        requires: required.map(|skills| Requirements { skills }),
        requires_resolved: None,
        missing_required_skills: None,
    })
}

fn resolve_project(raw: Option<&str>) -> Option<PathBuf> {
    raw.map(|arg| {
        let arg = if arg == "~" {
            crate::workspace::home().unwrap_or_default()
        } else if let Some(rest) = arg.strip_prefix("~/") {
            crate::workspace::home().unwrap_or_default().join(rest)
        } else {
            PathBuf::from(arg)
        };
        arg.canonicalize().unwrap_or(arg)
    })
}

fn collect(root: &Path, priority: u8, found: &mut HashMap<PathBuf, (PathBuf, u8)>) {
    if !root.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        let file = dir.join("SKILL.md");
        if !file.is_file() {
            continue;
        }
        if let Ok(resolved) = file.canonicalize() {
            found.insert(resolved, (file, priority));
        }
    }
}

pub fn list(project_arg: Option<&str>, assets_root: &Path) -> Result<Vec<Skill>, String> {
    let home = crate::workspace::home()?;
    let project = resolve_project(project_arg);
    let mut found = HashMap::new();
    collect(&home.join(".agents/skills"), 2, &mut found);
    collect(&assets_root.join("skills"), 1, &mut found);
    if let Some(project) = &project {
        collect(&project.join("skills"), 0, &mut found);
    }
    let mut parsed = found
        .into_values()
        .filter_map(|(path, rank)| parse_skill(&path).map(|s| (s, rank)))
        .collect::<Vec<_>>();
    parsed.sort_by(|(a, ra), (b, rb)| {
        ra.cmp(rb)
            .then_with(|| a.path.to_lowercase().cmp(&b.path.to_lowercase()))
    });
    let mut chosen: HashMap<String, Skill> = HashMap::new();
    for (skill, _) in parsed {
        chosen.entry(skill.name.to_lowercase()).or_insert(skill);
    }
    let visible: HashSet<String> = chosen.keys().cloned().collect();
    let mut skills = chosen.into_values().collect::<Vec<_>>();
    for skill in &mut skills {
        if let Some(requires) = &skill.requires {
            let missing = requires
                .skills
                .iter()
                .filter(|name| !visible.contains(&name.to_lowercase()))
                .cloned()
                .collect::<Vec<_>>();
            skill.requires_resolved = Some(missing.is_empty());
            skill.missing_required_skills = Some(missing);
        }
    }
    skills.sort_by_key(|a| a.name.to_lowercase());
    Ok(skills)
}

pub fn run(args: &[String], root: &Path) -> Result<Vec<Skill>, String> {
    let usage = "usage: neo skill list [--project PATH] | package SKILL_DIR OUTPUT.zip";
    let (command, params) = args.split_first().ok_or_else(|| usage.to_string())?;
    if command != "list" {
        return Err(usage.to_string());
    }
    let project = if params.is_empty() {
        None
    } else if params.len() == 2
        && params[0] == "--project"
        && !params[1].is_empty()
        && !params[1].starts_with('-')
    {
        Some(params[1].as_str())
    } else {
        return Err(usage.to_string());
    };
    list(project, root)
}
