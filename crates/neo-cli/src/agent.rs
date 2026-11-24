use serde::Serialize;
use std::{
    cmp::Ordering,
    collections::HashSet,
    env, fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

const USAGE: &str = "usage: neo agent list [--project PATH] [--source project|shared|global|agency] | search QUERY [--project PATH] [--source ...] [--limit N]";

#[derive(Clone, Debug, Serialize)]
pub struct Definition {
    name: String,
    description: String,
    source: String,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    extends: Option<String>,
    requires_project_manifest: bool,
    effective: bool,
}

#[derive(Default)]
struct Metadata {
    name: Option<String>,
    description: Option<String>,
    r#type: Option<String>,
    extends: Option<String>,
}

/// Parse the same limited, initial frontmatter window as the existing
/// JavaScript resolver. Never evaluate YAML tags or read agent body text.
fn metadata(file: &Path) -> Result<Metadata, String> {
    let file_stream =
        fs::File::open(file).map_err(|e| format!("cannot read {}: {e}", file.display()))?;
    let mut bytes = Vec::with_capacity(16_384);
    file_stream
        .take(16_384)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("cannot read {}: {e}", file.display()))?;
    let start = String::from_utf8_lossy(&bytes);
    let lines = start.lines().collect::<Vec<_>>();
    if lines.first().map(|s| s.trim_end_matches('\r')) != Some("---") {
        return Ok(Metadata::default());
    }
    let end = lines
        .iter()
        .enumerate()
        .skip(1)
        .find_map(|(i, line)| (line.trim_end_matches('\r') == "---").then_some(i));
    let Some(end) = end else {
        return Ok(Metadata::default());
    };
    let mut result = Metadata::default();
    for raw in &lines[1..end] {
        let Some((key, raw_value)) = raw.trim_end_matches('\r').split_once(':') else {
            continue;
        };
        if !matches!(key, "name" | "description" | "type" | "extends") {
            continue;
        }
        // Accept only single-line values, as in the reference's small
        // frontmatter regex; quoted YAML is not evaluated as a document.
        let value = raw_value.trim();
        let value = if value.len() >= 2 && value.starts_with('\'') && value.ends_with('\'') {
            value[1..value.len() - 1].replace("''", "'")
        } else if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
            serde_json::from_str::<String>(value)
                .unwrap_or_else(|_| value[1..value.len() - 1].to_owned())
        } else {
            value.to_owned()
        };
        if value.is_empty() || value == ">" || value == "|" {
            continue;
        }
        match key {
            "name" => result.name = Some(value),
            "description" => result.description = Some(value),
            "type" => result.r#type = Some(value),
            "extends" => result.extends = Some(value),
            _ => {}
        }
    }
    Ok(result)
}

fn definitions_in(directory: &Path, source: &str) -> Result<Vec<Definition>, String> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    if !directory.is_dir() {
        return Err(format!("not a directory: {}", directory.display()));
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map_err(|e| e.to_string())?.is_file()
            && entry.file_name().to_string_lossy().ends_with(".agent.md")
        {
            files.push(entry.path());
        }
    }
    // JS readdirSync is normally alphabetical, but precedence within one
    // directory must remain deterministic on all filesystems.
    files.sort();
    files
        .into_iter()
        .map(|path| {
            let info = metadata(&path)?;
            let basename = path.file_name().unwrap().to_string_lossy();
            Ok(Definition {
                name: info
                    .name
                    .unwrap_or_else(|| basename.trim_end_matches(".agent.md").to_string()),
                description: info.description.unwrap_or_default(),
                source: source.to_owned(),
                path: path.to_string_lossy().into_owned(),
                r#type: info.r#type,
                extends: info.extends,
                requires_project_manifest: false,
                effective: false,
            })
        })
        .collect()
}

fn agency_definitions(directory: &Path) -> Result<Vec<Definition>, String> {
    if !directory.exists() {
        return Err(format!(
            "Agency Agents library unavailable: {}; recover using Neo's agency-agents setup.sh",
            directory.display()
        ));
    }
    let mut directories = Vec::new();
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map_err(|e| e.to_string())?.is_dir()
            && entry.file_name().to_string_lossy().starts_with("agency-")
        {
            directories.push(entry.path());
        }
    }
    directories.sort();
    let mut items = Vec::new();
    for folder in directories {
        let file = folder.join("SKILL.md");
        if !file.exists() {
            continue;
        }
        let info = metadata(&file)?;
        let default_name = folder.file_name().unwrap().to_string_lossy().to_string();
        items.push(Definition {
            name: info.name.unwrap_or(default_name),
            description: info.description.unwrap_or_default(),
            source: "agency".to_owned(),
            path: file.to_string_lossy().into_owned(),
            r#type: None,
            extends: None,
            requires_project_manifest: true,
            effective: false,
        });
    }
    Ok(items)
}

fn resolve(input: &Path) -> Result<PathBuf, String> {
    let joined = if input.is_absolute() {
        input.to_path_buf()
    } else {
        env::current_dir().map_err(|e| e.to_string())?.join(input)
    };
    // Match Node path.resolve lexically, without following symlinks.
    let mut normalized = PathBuf::new();
    for part in joined.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    Ok(normalized)
}

fn project_from_cwd(cwd: &Path, harness: &Path) -> Option<PathBuf> {
    for current in cwd.ancestors() {
        if current == harness {
            break;
        }
        if current.join("AGENTS.md").exists() && current.join("README.md").exists() {
            return Some(current.to_path_buf());
        }
    }
    None
}

fn discover(harness: &Path, project_arg: Option<&str>) -> Result<Vec<Definition>, String> {
    let home = crate::workspace::home()?;
    let agency = home.join(".local/share/agency-agents/integrations/dsh");
    let project = if let Some(path) = project_arg {
        Some(resolve(Path::new(path))?)
    } else {
        project_from_cwd(&env::current_dir().map_err(|e| e.to_string())?, harness)
    };
    if let Some(path) = &project {
        if !path.is_dir() {
            return Err(format!("invalid project directory: {}", path.display()));
        }
    }
    let mut items = Vec::new();
    if let Some(path) = project.as_ref().filter(|p| p.as_path() != harness) {
        items.extend(definitions_in(&path.join("agents"), "project")?);
    }
    items.extend(definitions_in(&home.join(".agents/agents"), "global")?);
    items.extend(definitions_in(&harness.join("agents"), "shared")?);
    items.extend(agency_definitions(&agency)?);
    let mut seen = HashSet::new();
    for item in &mut items {
        item.effective = seen.insert(item.name.to_lowercase());
    }
    items.sort_by(|a, b| a.name.cmp(&b.name).then(a.source.cmp(&b.source)));
    Ok(items)
}

fn score(item: &Definition, phrase: &str, words: &[&str]) -> i32 {
    let name = item.name.to_lowercase();
    let description = item.description.to_lowercase();
    let mut score = if name == phrase {
        100
    } else if name.contains(phrase) {
        50
    } else if description.contains(phrase) {
        25
    } else {
        0
    };
    for word in words {
        if name.contains(word) {
            score += 10;
        } else if description.contains(word) {
            score += 3;
        }
    }
    score
}

fn search(items: Vec<Definition>, query: &str, limit: usize) -> Vec<Definition> {
    let phrase = query.to_lowercase().trim().to_owned();
    let words = phrase
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>();
    let mut ranked: Vec<_> = items
        .into_iter()
        .filter_map(|item| {
            let score = score(&item, &phrase, &words);
            (score > 0).then_some((item, score))
        })
        .collect();
    ranked.sort_by(|(a, sa), (b, sb)| {
        sb.cmp(sa)
            .then_with(|| b.effective.cmp(&a.effective))
            .then_with(|| a.name.cmp(&b.name))
            .then(Ordering::Equal)
    });
    ranked
        .into_iter()
        .take(limit)
        .map(|(item, _)| item)
        .collect()
}

pub fn run(args: &[String], harness: &Path) -> Result<Vec<Definition>, String> {
    let (operation, options) = args.split_first().ok_or(USAGE.to_string())?;
    if operation != "list" && operation != "search" {
        return Err(USAGE.to_string());
    }
    let mut project = None;
    let mut source = None;
    let mut limit = 10;
    let mut has_limit = false;
    let mut words = Vec::new();
    let mut i = 0;
    while i < options.len() {
        let arg = options[i].as_str();
        if matches!(arg, "--project" | "--source" | "--limit") {
            i += 1;
            let value = options
                .get(i)
                .filter(|s| !s.is_empty() && !s.starts_with("--"))
                .ok_or_else(|| format!("{arg} requires a value"))?;
            match arg {
                "--project" => project = Some(value.as_str()),
                "--source" => source = Some(value.as_str()),
                "--limit" => {
                    let numeric = value.parse::<f64>().unwrap_or(f64::NAN);
                    if !numeric.is_finite()
                        || numeric.fract() != 0.0
                        || !(1.0..=283.0).contains(&numeric)
                    {
                        return Err("--limit must be an integer from 1 to 283".to_string());
                    }
                    limit = numeric as usize;
                    has_limit = true;
                }
                _ => unreachable!(),
            }
        } else if arg.starts_with('-') {
            return Err(USAGE.to_string());
        } else {
            words.push(arg);
        }
        i += 1;
    }
    if let Some(src) = source {
        if !matches!(src, "project" | "shared" | "global" | "agency") {
            return Err("invalid --source".to_string());
        }
    }
    if operation == "list" && (!words.is_empty() || has_limit) {
        return Err(USAGE.to_string());
    }
    if operation == "search" && words.is_empty() {
        return Err(USAGE.to_string());
    }
    let items = discover(harness, project)?;
    let filtered = items
        .into_iter()
        .filter(|item| source.is_none_or(|s| s == item.source))
        .collect::<Vec<_>>();
    if operation == "search" {
        Ok(search(filtered, &words.join(" "), limit))
    } else {
        Ok(filtered)
    }
}
