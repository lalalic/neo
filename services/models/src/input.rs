use crate::{key, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
};

pub fn private_dir(path: &Path) -> Result<()> {
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .map_err(|e| e.to_string())?;
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("unsafe state directory".into());
    }
    Ok(())
}
fn decode(kind: &str, data: &str) -> Result<Vec<u8>> {
    if data.len() > 14 * 1024 * 1024 {
        return Err("image data too large".into());
    }
    let bytes = STANDARD
        .decode(data)
        .map_err(|_| "invalid image base64".to_string())?;
    if bytes.len() < 12 || bytes.len() > 10 * 1024 * 1024 {
        return Err("image size invalid".into());
    }
    let valid = match kind {
        "png" => bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]),
        "jpeg" => bytes.starts_with(&[255, 216]),
        "webp" => bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        _ => false,
    };
    if !valid {
        return Err("image format/header mismatch".into());
    }
    Ok(bytes)
}
pub fn messages(body: &Value) -> Result<Vec<Value>> {
    if body["model"] != "neo" {
        return Err("unsupported model (expected neo)".into());
    }
    if let Some(text) = body["input"].as_str() {
        return Ok(vec![json!({"role":"user","text":text,"images":[]})]);
    }
    let items = body["input"]
        .as_array()
        .filter(|v| !v.is_empty() && v.len() <= 128)
        .ok_or("input must be a string or 1–128 message items")?;
    let mut out = vec![];
    for item in items {
        let role = item["role"].as_str().unwrap_or("");
        if !matches!(role, "system" | "developer" | "user" | "assistant") {
            continue;
        }
        let content = if let Some(text) = item["content"].as_str() {
            json!([{"type":"input_text","text":text}])
        } else {
            item["content"].clone()
        };
        let parts = content
            .as_array()
            .filter(|a| a.len() <= 40)
            .ok_or("unsupported content")?;
        let mut texts = vec![];
        let mut images = vec![];
        for part in parts {
            match part["type"].as_str().unwrap_or("") {
                "input_text" | "output_text" | "text" => {
                    texts.push(part["text"].as_str().ok_or("unsupported text")?)
                }
                "input_image" | "image_url" => {
                    let uri = part["image_url"]
                        .as_str()
                        .or_else(|| part["image_url"]["url"].as_str())
                        .ok_or("only bounded image data URIs are supported")?;
                    let (kind, data) = uri
                        .strip_prefix("data:image/")
                        .and_then(|s| s.split_once(";base64,"))
                        .ok_or("only bounded image data URIs are supported")?;
                    decode(kind, data)?;
                    images.push(json!({"type":kind,"base64":data}));
                }
                _ => return Err("unsupported message part".into()),
            }
        }
        out.push(json!({"role":role,"text":texts.join("\n"),"images":images}));
    }
    if out.is_empty() {
        return Err("no textual message roles".into());
    }
    Ok(out)
}
pub fn compact(messages: &[Value]) -> Vec<Value> {
    messages
        .iter()
        .map(|m| {
            let mut result = m.clone();
            result["images"] = json!(m["images"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|img| {
                    let hash = img["sha256"]
                        .as_str()
                        .map(str::to_owned)
                        .unwrap_or_else(|| {
                            format!(
                                "{:x}",
                                Sha256::digest(img["base64"].as_str().unwrap_or("").as_bytes())
                            )
                        });
                    json!({"type":img["type"],"sha256":hash})
                })
                .collect::<Vec<_>>());
            result
        })
        .collect()
}
pub fn materialize_latest(latest: &Value, dir: &Path) -> Result<Vec<PathBuf>> {
    private_dir(dir)?;
    let mut files = vec![];
    for img in latest["images"].as_array().into_iter().flatten() {
        let kind = img["type"].as_str().ok_or("image type required")?;
        let data = decode(kind, img["base64"].as_str().ok_or("image required")?)?;
        let ext = if kind == "jpeg" { "jpg" } else { kind };
        let path = dir.join(format!("image-{}.{ext}", key()?));
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| e.to_string())?;
        file.write_all(&data).map_err(|e| e.to_string())?;
        files.push(path);
    }
    Ok(files)
}
pub fn prompt(
    id: &str,
    latest: &Value,
    paths: &[PathBuf],
    enforcement: Option<&str>,
) -> Result<(String, String)> {
    if !crate::store::response_id(id) {
        return Err("invalid response ID".into());
    }
    let mut context = include_str!("../TOP_INSTRUCTIONS.md")
        .trim()
        .replace("<response_id>", id);
    if let Some(s) = enforcement {
        let lower = s.to_ascii_lowercase();
        if s.trim().is_empty()
            || s.len() > 8192
            || [
                "<top-instructions>",
                "</top-instructions>",
                "[user]",
                "[/user]",
            ]
            .iter()
            .any(|x| lower.contains(x))
        {
            return Err("invalid enforcement_context".into());
        }
        context.push_str("\nAdditional, not overriding:\n");
        context.push_str(s);
    }
    // Reject oversized enforcement before admission, rather than fail after a
    // response ID is reserved. WebHelm's visible contract is capped at 1500 UTF-16 units.
    if context.encode_utf16().count() > 1500 {
        return Err("enforcement_context exceeds WebHelm limit (1500 UTF-16 units)".into());
    }
    let mut text = format!(
        "[USER]\n{}",
        latest["text"].as_str().ok_or("user text required")?
    );
    for (i, file) in paths.iter().enumerate() {
        text.push_str(&format!("\n[image {}] {}", i + 1, file.display()));
    }
    text.push_str("\n[/USER]");
    Ok((text, context))
}
