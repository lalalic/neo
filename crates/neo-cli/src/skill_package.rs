//! Standalone native ZIP packager for Web ChatGPT Skill imports. Paths and
//! symlinks are filtered; only UTF-8 text in the chosen Skill is archived.
//! No Python, Node, temporary dependency trees or optional system archiver.
use flate2::{write::DeflateEncoder, Compression};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
};
use uuid::Uuid;

const USAGE: &str = "usage: neo skill list [--project PATH] | package SKILL_DIR OUTPUT.zip";
fn resolved(raw: &str) -> Result<PathBuf, String> {
    if raw == "~" {
        return crate::workspace::home();
    }
    if let Some(rest) = raw.strip_prefix("~/") {
        return Ok(crate::workspace::home()?.join(rest));
    }
    let source = Path::new(raw);
    if source.is_absolute() {
        Ok(source.into())
    } else {
        Ok(env::current_dir().map_err(|e| e.to_string())?.join(source))
    }
}
fn excluded(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "node_modules" | "__pycache__" | ".venv" | ".git" | ".pytest_cache" | ".mypy_cache"
        )
}
fn walk(root: &Path, dir: &Path, entries: &mut Vec<(String, Vec<u8>)>) -> Result<(), String> {
    let mut children = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    children.sort_by_key(|entry| entry.file_name());
    for child in children {
        let name = child.file_name().to_string_lossy().to_string();
        if excluded(&name) {
            continue;
        }
        let ft = child.file_type().map_err(|e| e.to_string())?;
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            walk(root, &child.path(), entries)?;
            continue;
        }
        if !ft.is_file() {
            continue;
        }
        let data = fs::read(child.path()).map_err(|e| e.to_string())?;
        if data.len() > 8 * 1024 * 1024 {
            return Err(format!("Skill text file exceeds 8MiB: {name}"));
        }
        if data.contains(&0) || std::str::from_utf8(&data).is_err() {
            continue;
        }
        let child_path = child.path();
        let relative = child_path.strip_prefix(root).map_err(|e| e.to_string())?;
        let name = relative
            .to_str()
            .ok_or("Skill path is not valid UTF-8")?
            .replace('\\', "/");
        if entries
            .iter()
            .map(|(_, source)| source.len())
            .sum::<usize>()
            + data.len()
            > 32 * 1024 * 1024
        {
            return Err("Skill text payload exceeds 32MiB total limit".into());
        }
        entries.push((name, data));
        if entries.len() > 10000 {
            return Err("Skill contains too many files".into());
        }
    }
    Ok(())
}
fn u16le(v: &mut Vec<u8>, n: u16) {
    v.extend_from_slice(&n.to_le_bytes());
}
fn u32le(v: &mut Vec<u8>, n: u32) {
    v.extend_from_slice(&n.to_le_bytes());
}
fn small(n: usize, label: &str) -> Result<u32, String> {
    u32::try_from(n).map_err(|_| format!("Skill ZIP {label} exceeds ZIP32 limits"))
}
fn archive(entries: &[(String, Vec<u8>)]) -> Result<Vec<u8>, String> {
    if entries.len() > u16::MAX as usize {
        return Err("Skill ZIP has too many entries".into());
    }
    let mut data = Vec::<u8>::new();
    let mut central = Vec::<u8>::new();
    for (path, source) in entries {
        let filename = path.as_bytes();
        let len = u16::try_from(filename.len()).map_err(|_| "Skill ZIP filename too long")?;
        let mut encoded = DeflateEncoder::new(Vec::new(), Compression::default());
        encoded.write_all(source).map_err(|e| e.to_string())?;
        let compressed = encoded.finish().map_err(|e| e.to_string())?;
        let crc = crc32fast::hash(source);
        let start = small(data.len(), "offset")?;
        let packed = small(compressed.len(), "compressed size")?;
        let original = small(source.len(), "original size")?;
        // Deterministic ZIP32; method 8 = DEFLATE; bit11 = UTF8 names.
        u32le(&mut data, 0x0403_4b50);
        u16le(&mut data, 20);
        u16le(&mut data, 0x0800);
        u16le(&mut data, 8);
        u16le(&mut data, 0);
        u16le(&mut data, 33);
        u32le(&mut data, crc);
        u32le(&mut data, packed);
        u32le(&mut data, original);
        u16le(&mut data, len);
        u16le(&mut data, 0);
        data.extend_from_slice(filename);
        data.extend_from_slice(&compressed);
        u32le(&mut central, 0x0201_4b50);
        u16le(&mut central, 20);
        u16le(&mut central, 20);
        u16le(&mut central, 0x0800);
        u16le(&mut central, 8);
        u16le(&mut central, 0);
        u16le(&mut central, 33);
        u32le(&mut central, crc);
        u32le(&mut central, packed);
        u32le(&mut central, original);
        u16le(&mut central, len);
        u16le(&mut central, 0);
        u16le(&mut central, 0);
        u16le(&mut central, 0);
        u16le(&mut central, 0);
        u32le(&mut central, 0o100644 << 16);
        u32le(&mut central, start);
        central.extend_from_slice(filename);
    }
    let begin = small(data.len(), "central directory offset")?;
    let size = small(central.len(), "central directory size")?;
    data.extend_from_slice(&central);
    u32le(&mut data, 0x0605_4b50);
    u16le(&mut data, 0);
    u16le(&mut data, 0);
    u16le(&mut data, entries.len() as u16);
    u16le(&mut data, entries.len() as u16);
    u32le(&mut data, size);
    u32le(&mut data, begin);
    u16le(&mut data, 0);
    if data.len() > 32 * 1024 * 1024 {
        return Err("Skill ZIP exceeds 32MiB output limit".into());
    }
    Ok(data)
}

pub fn run(args: &[String]) -> Result<String, String> {
    if args.len() != 2 || args.iter().any(|a| a.is_empty() || a.starts_with('-')) {
        return Err(USAGE.into());
    }
    let root = resolved(&args[0])?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let manifest = root.join("SKILL.md");
    let metadata =
        fs::symlink_metadata(&manifest).map_err(|_| format!("missing {}", manifest.display()))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(format!("missing {}", manifest.display()));
    }
    let name = root
        .file_name()
        .ok_or("Skill root name missing")?
        .to_string_lossy()
        .to_string();
    if name.starts_with('.') || name == ".." || name.is_empty() {
        return Err("Invalid Skill root name".into());
    }
    let destination = resolved(&args[1])?;
    if !destination
        .extension()
        .is_some_and(|e| e.to_string_lossy().eq_ignore_ascii_case("zip"))
    {
        return Err("output must be a .zip file".into());
    }
    if fs::symlink_metadata(&destination).is_ok() {
        return Err("refusing to replace existing Skill ZIP".into());
    }
    let mut paths = Vec::new();
    walk(&root, &root, &mut paths)?;
    paths.sort_by(|a, b| a.0.cmp(&b.0));
    let selected = paths
        .into_iter()
        .map(|(p, data)| (format!("{name}/{p}"), data))
        .collect::<Vec<_>>();
    let encoded = archive(&selected)?;
    let parent = destination
        .parent()
        .ok_or("Skill ZIP output has no parent")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let parent = parent.canonicalize().map_err(|e| e.to_string())?;
    let dest = parent.join(destination.file_name().ok_or("Skill ZIP name missing")?);
    let temp = parent.join(format!(".neo-skill-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(&temp).map_err(|e| e.to_string())?;
        file.write_all(&encoded).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::hard_link(&temp, &dest)
            .map_err(|e| format!("cannot publish Skill ZIP without overwrite: {e}"))?;
        Ok(dest.to_string_lossy().to_string())
    })();
    let _ = fs::remove_file(&temp);
    result
}
