use crate::{input::private_dir, key, store, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
};
const MAX_FILE: usize = 12 * 1024 * 1024;
pub fn id(s: &str) -> bool {
    (8..=128).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn name(s: &str) -> bool {
    !s.is_empty()
        && s.encode_utf16().count() <= 120
        && !s.starts_with('.')
        && !s.contains(['/', '\\'])
        && !s.chars().any(|c| c < '\u{20}')
}
fn hash(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}
fn bytes(path: &Path, cap: usize) -> Result<Option<Vec<u8>>> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
        Ok(m) => {
            if !m.is_file() || m.file_type().is_symlink() || m.len() > cap as u64 {
                return Err("unsafe attachment file".into());
            }
            Ok(Some(fs::read(path).map_err(|e| e.to_string())?))
        }
    }
}
fn exclusive(path: &Path, content: &[u8]) -> Result<()> {
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| e.to_string())?;
    f.write_all(content)
        .and_then(|_| f.sync_all())
        .map_err(|e| e.to_string())
}
fn field<'a>(v: &'a Value, k: &str) -> Result<&'a str> {
    v[k].as_str()
        .ok_or_else(|| format!("invalid attachment {k}"))
}
pub struct Attachments {
    root: PathBuf,
}
impl Attachments {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn dir(&self, request: &str, attachment: &str) -> Result<PathBuf> {
        if !id(request) || !id(attachment) {
            return Err("invalid attachment identity".into());
        }
        Ok(self.root.join("attachments").join(request).join(attachment))
    }
    pub fn upload(&self, v: &Value) -> Result<Value> {
        let request = field(v, "requestId")?;
        let attachment = field(v, "attachmentId")?;
        let filename = field(v, "name")?;
        let sha = field(v, "sha256")?;
        let size = v["size"]
            .as_u64()
            .filter(|n| *n > 0 && *n <= MAX_FILE as u64)
            .ok_or("invalid attachment size")?;
        let count = v["chunkCount"]
            .as_u64()
            .filter(|n| *n > 0 && *n <= 96)
            .ok_or("invalid attachment chunkCount")?;
        let index = v["chunkIndex"]
            .as_u64()
            .filter(|n| *n < count)
            .ok_or("invalid attachment chunkIndex")?;
        let encoded = field(v, "contentBase64")?;
        if !name(filename)
            || sha.len() != 64
            || !sha
                .bytes()
                .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'))
            || encoded.len() > 175_000
        {
            return Err("invalid attachment chunk metadata".into());
        }
        let data = STANDARD
            .decode(encoded)
            .map_err(|_| "invalid attachment bytes")?;
        if data.is_empty() || data.len() > 128 * 1024 || STANDARD.encode(&data) != encoded {
            return Err("invalid attachment bytes".into());
        }
        let dir = self.dir(request, attachment)?;
        private_dir(&dir)?;
        let meta = json!({"requestId":request,"attachmentId":attachment,"name":filename,"chunkCount":count,"size":size,"sha256":sha});
        let mf = dir.join("manifest.json");
        if let Some(old) = store::read(&mf)? {
            if old != meta {
                return Err("Attachment ID already belongs to different content".into());
            }
        } else {
            store::write(&mf, &meta)?
        }
        let part = dir.join(format!("{index:04}.part"));
        if let Some(old) = bytes(&part, 128 * 1024)? {
            if old != data {
                return Err("Attachment chunk collision".into());
            }
        } else {
            exclusive(&part, &data)?
        }
        let output = dir.join(filename);
        if let Some(done) = bytes(&output, MAX_FILE)? {
            if done.len() != size as usize || hash(&done) != sha {
                return Err("Attachment size or checksum mismatch".into());
            }
            return Ok(json!({"attachmentId":attachment,"complete":true}));
        }
        let mut complete = Vec::with_capacity(size as usize);
        for i in 0..count {
            let Some(part) = bytes(&dir.join(format!("{i:04}.part")), 128 * 1024)? else {
                return Ok(json!({"attachmentId":attachment,"complete":false}));
            };
            complete.extend(part);
        }
        if complete.len() != size as usize || hash(&complete) != sha {
            return Err("Attachment size or checksum mismatch".into());
        }
        let temp = dir.join(format!(".complete-{}.tmp", key()?));
        exclusive(&temp, &complete)?;
        fs::rename(&temp, &output).map_err(|e| e.to_string())?;
        Ok(json!({"attachmentId":attachment,"complete":true}))
    }
    pub fn resolve(&self, request: &str, refs: &[Value]) -> Result<Vec<PathBuf>> {
        if !id(request) || refs.len() > 4 {
            return Err("Invalid attachment references".into());
        }
        refs.iter()
            .map(|r| {
                let ident = field(r, "id")?;
                let filename = field(r, "name")?;
                if !name(filename) {
                    return Err("invalid attachment name".into());
                }
                let dir = self.dir(request, ident)?;
                let meta = store::read(&dir.join("manifest.json"))?
                    .ok_or("Attachment manifest missing")?;
                if meta["requestId"] != request
                    || meta["attachmentId"] != ident
                    || meta["name"] != filename
                {
                    return Err("Attachment reference mismatch".into());
                }
                let path = dir.join(filename);
                let data = bytes(&path, MAX_FILE)?.ok_or("Attachment not yet complete")?;
                if meta["size"].as_u64() != Some(data.len() as u64) || meta["sha256"] != hash(&data)
                {
                    return Err("Attachment not yet complete or corrupted".into());
                }
                Ok(path)
            })
            .collect()
    }
    pub fn scrub(&self, request: &str) -> Result<()> {
        if !id(request) {
            return Err("invalid attachment identity".into());
        }
        let path = self.root.join("attachments").join(request);
        match fs::remove_dir_all(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}
