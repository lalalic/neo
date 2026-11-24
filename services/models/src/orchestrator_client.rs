//! The adapter is an authenticated private client of the same /v1 SSE API.
//! A one-use in-memory grant permits verified local attachments, never a
//! caller-supplied path in HTTP JSON.
use crate::{
    key,
    store::{codex_id, response_id},
    Result,
};
use serde_json::Value;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Clone, Default)]
pub struct Grants(Arc<Mutex<HashMap<String, (String, Vec<PathBuf>)>>>);
impl Grants {
    pub fn take(&self, grant: &str, owner: Option<&str>) -> Result<Vec<PathBuf>> {
        let mut map = self.0.lock().map_err(|_| "grant lock poisoned")?;
        let (id, files) = map.get(grant).ok_or("unauthorized private /v1 request")?;
        if Some(id.as_str()) != owner {
            return Err("unauthorized private /v1 request".into());
        }
        let files = files.clone();
        map.remove(grant);
        Ok(files)
    }
}
struct GrantGuard {
    map: Grants,
    id: String,
}
impl Drop for GrantGuard {
    fn drop(&mut self) {
        if let Ok(mut m) = self.map.0.lock() {
            m.remove(&self.id);
        }
    }
}
pub trait ModelClient: Send + Sync {
    fn run(
        &self,
        body: Value,
        codex: &str,
        files: Vec<PathBuf>,
        started: &mut dyn FnMut(&str) -> Result<()>,
    ) -> Result<Value>;
}
pub struct HttpClient {
    pub port: u16,
    pub token: Arc<String>,
    pub grants: Grants,
}
impl ModelClient for HttpClient {
    fn run(
        &self,
        mut body: Value,
        codex: &str,
        files: Vec<PathBuf>,
        started: &mut dyn FnMut(&str) -> Result<()>,
    ) -> Result<Value> {
        if !codex_id(codex) || files.len() > 4 || files.iter().any(|p| !p.is_absolute()) {
            return Err("invalid private /v1 identity or verified attachment paths".into());
        }
        let id = key()?;
        self.grants
            .0
            .lock()
            .map_err(|_| "grant lock poisoned")?
            .insert(id.clone(), (codex.into(), files));
        let _guard = GrantGuard {
            map: self.grants.clone(),
            id: id.clone(),
        };
        body["model"] = Value::String("neo".into());
        body["stream"] = Value::Bool(true);
        let agent = ureq::Agent::config_builder()
            .max_redirects(0)
            .timeout_global(Some(Duration::from_secs(1800)))
            .build()
            .new_agent();
        let mut response = agent
            .post(format!("http://127.0.0.1:{}/v1/responses", self.port))
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Content-Type", "application/json")
            .header("thread-id", codex)
            .header("x-neo-orchestrator-grant", &id)
            .send_json(body)
            .map_err(|e| e.to_string())?;
        if response.status() != 200
            || !response
                .headers()
                .get("content-type")
                .and_then(|s| s.to_str().ok())
                .is_some_and(|s| s.starts_with("text/event-stream"))
        {
            return Err("Internal /v1 stream unavailable".into());
        }
        let mut reader = BufReader::new(response.body_mut().as_reader());
        let mut event = String::new();
        let mut data = String::new();
        let mut response_id_seen = None::<String>;
        loop {
            let mut line = String::new();
            let n = (&mut reader)
                .take(1_048_577)
                .read_line(&mut line)
                .map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            if n > 1_048_576 || data.len() + n > 1_048_576 {
                return Err("Internal /v1 event exceeds maximum size".into());
            }
            let line = line.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                if !event.is_empty() && !data.is_empty() {
                    let packet: Value = serde_json::from_str(&data)
                        .map_err(|_| "Malformed internal /v1 SSE event")?;
                    match event.as_str() {
                        "response.created" => {
                            let id = packet["response"]["id"]
                                .as_str()
                                .filter(|s| response_id(s))
                                .ok_or("Invalid internal /v1 response identity")?;
                            if response_id_seen.is_some() {
                                return Err("Duplicate internal /v1 response identity".into());
                            }
                            started(id)?;
                            response_id_seen = Some(id.into());
                        }
                        "response.failed" => {
                            return Err(format!(
                                "Internal /v1 response failed: {}",
                                packet["response"]["error"]["message"]
                                    .as_str()
                                    .unwrap_or("unknown")
                                    .chars()
                                    .take(240)
                                    .collect::<String>()
                            ))
                        }
                        "response.completed" => {
                            if response_id_seen.is_none()
                                || packet["response"]["id"].as_str() != response_id_seen.as_deref()
                                || packet["response"]["status"] != "completed"
                            {
                                return Err(
                                    "Internal /v1 completion does not match the started response"
                                        .into(),
                                );
                            }
                            return Ok(packet["response"].clone());
                        }
                        _ => {}
                    }
                }
                event.clear();
                data.clear();
            } else if let Some(s) = line.strip_prefix("event: ") {
                event = s.into()
            } else if let Some(s) = line.strip_prefix("data: ") {
                if !data.is_empty() {
                    data.push('\n')
                }
                data.push_str(s)
            }
        }
        Err("Internal /v1 stream ended without explicit completion".into())
    }
}
