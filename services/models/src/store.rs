use crate::{input::private_dir, key, now_ms, Result};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};
fn valid_key(s: &str) -> bool {
    (8..=80).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
pub fn response_id(s: &str) -> bool {
    s.len() == 45
        && s.starts_with("resp_")
        && s[5..]
            .bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'))
}
pub fn codex_id(s: &str) -> bool {
    regex::Regex::new("(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
        .unwrap()
        .is_match(s)
}
pub fn thread_id(s: &str) -> bool {
    (8..=160).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
pub fn project_id(s: &str) -> bool {
    s.starts_with("g-p-")
        && (8..=128).contains(&s[4..].len())
        && s[4..]
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

#[derive(Clone)]
pub struct Store {
    pub base: PathBuf,
    guard: Arc<Mutex<()>>,
}
pub struct Transaction<'a> {
    store: &'a Store,
    _lock: MutexGuard<'a, ()>,
}
impl Store {
    pub fn open(base: PathBuf) -> Result<Self> {
        for p in [&base, &base.join("sessions"), &base.join("responses")] {
            private_dir(p)?
        }
        Ok(Self {
            base,
            guard: Arc::new(Mutex::new(())),
        })
    }
    pub fn transaction(&self) -> Result<Transaction<'_>> {
        Ok(Transaction {
            store: self,
            _lock: self.guard.lock().map_err(|_| "state lock poisoned")?,
        })
    }
    pub fn response(&self, id: &str) -> Result<Option<Value>> {
        self.transaction()?.response(id)
    }
}
pub fn read(path: &Path) -> Result<Option<Value>> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
        Ok(m) => {
            if !m.is_file() || m.file_type().is_symlink() || m.len() > 64 * 1024 * 1024 {
                return Err("invalid state file".into());
            }
            let bytes = fs::read(path).map_err(|e| e.to_string())?;
            serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|e| e.to_string())
        }
    }
}
pub fn write(path: &Path, value: &Value) -> Result<()> {
    let parent = path.parent().ok_or("missing state parent")?;
    private_dir(parent)?;
    let temp = parent.join(format!(".write-{}.tmp", key()?));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut file, value).map_err(|e| e.to_string())?;
        file.flush()
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        fs::rename(&temp, path).map_err(|e| e.to_string())?;
        fs::File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
impl Transaction<'_> {
    fn path(&self, kind: &str, id: &str) -> Result<PathBuf> {
        if !valid_key(id) {
            return Err("invalid ID".into());
        }
        Ok(self.store.base.join(kind).join(format!("{id}.json")))
    }
    pub fn session(&self, id: &str) -> Result<Option<Value>> {
        read(&self.path("sessions", id)?)
    }
    pub fn response(&self, id: &str) -> Result<Option<Value>> {
        read(&self.path("responses", id)?)
    }
    pub fn put_session(&self, item: &Value) -> Result<()> {
        write(
            &self.path(
                "sessions",
                item["id"].as_str().ok_or("session ID required")?,
            )?,
            item,
        )
    }
    pub fn put_response(&self, item: &Value) -> Result<()> {
        write(
            &self.path(
                "responses",
                item["id"].as_str().ok_or("response ID required")?,
            )?,
            item,
        )
    }
    pub fn sessions(&self) -> Result<Vec<Value>> {
        let mut out = vec![];
        for entry in fs::read_dir(self.store.base.join("sessions")).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            if path.extension().is_some_and(|s| s == "json") {
                if let Some(v) = read(&path)? {
                    out.push(v)
                }
            }
        }
        Ok(out)
    }
    pub fn resolve(
        &self,
        previous: Option<&str>,
        hint: Option<&str>,
        codex: Option<&str>,
    ) -> Result<Option<Value>> {
        if hint.is_some_and(|s| !valid_key(s)) {
            return Err("invalid metadata.session_id".into());
        }
        if codex.is_some_and(|s| !codex_id(s)) {
            return Err("invalid Codex Thread ID".into());
        }
        if let Some(id) = previous {
            let p = self.response(id)?.ok_or("unknown previous_response_id")?;
            let s = self
                .session(p["sessionId"].as_str().ok_or("missing session ID")?)?
                .ok_or("missing previous session")?;
            if s["codexThreadId"].as_str().is_some() && s["codexThreadId"].as_str() != codex {
                return Err("previous_response_id belongs to a different Codex Thread".into());
            }
            if hint.is_some() && s["clientSessionId"].as_str() != hint {
                return Err("previous_response_id belongs to a different client session".into());
            }
            return Ok(Some(s));
        }
        let owner = codex
            .map(|s| ("codexThreadId", s))
            .or_else(|| hint.map(|s| ("clientSessionId", s)));
        if let Some((field, id)) = owner {
            let mut matches = self.sessions()?.into_iter().filter(|s| s[field] == id);
            let mapped = matches.next();
            if matches.next().is_some() {
                return Err("duplicate session mapping".into());
            }
            if let Some(s) = &mapped {
                if hint.is_some()
                    && s["clientSessionId"].as_str().is_some()
                    && s["clientSessionId"].as_str() != hint
                {
                    return Err("Codex Thread maps to a different client session".into());
                }
            }
            Ok(mapped)
        } else {
            Ok(None)
        }
    }
    pub fn create(
        &self,
        messages: &[Value],
        hint: Option<&str>,
        codex: Option<&str>,
    ) -> Result<Value> {
        let s = json!({"id":format!("sess_{}",key()?),"clientSessionId":hint,"codexThreadId":codex,"threadId":null,"threadUrl":null,"status":"new","history":messages,"lastResponseId":null,"lastInput":messages,"createdAt":now_ms()});
        self.put_session(&s)?;
        Ok(s)
    }
    pub fn cas_orchestrator(
        &self,
        codex: &str,
        project: &str,
        previous: &str,
        next: &str,
        generation: u64,
    ) -> Result<u64> {
        if !codex_id(codex)
            || !project_id(project)
            || !thread_id(previous)
            || !thread_id(next)
            || previous == next
        {
            return Err("Invalid private Orchestrator CAS".into());
        }
        let mut s = self
            .resolve(None, None, Some(codex))?
            .ok_or("Orchestrator CAS has no unique Codex owner")?;
        if s["threadId"] != previous
            || s["projectId"] != project
            || s["orchestratorGeneration"].as_u64().unwrap_or(0) != generation
        {
            return Err("Orchestrator CAS mapping or generation mismatch".into());
        }
        let next_generation = generation.checked_add(1).ok_or("generation overflow")?;
        s["threadId"] = json!(next);
        s["orchestratorGeneration"] = json!(next_generation);
        self.put_session(&s)?;
        Ok(next_generation)
    }
}
