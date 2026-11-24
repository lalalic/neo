//! Native notification client. Neo Master owns APNs credentials and delivery.
use crate::{
    now_ms,
    orchestrator::{Notifier, NotifyOutcome},
    store, Result,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    env,
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};
use url::Url;
pub struct NeoNotifier {
    endpoint: String,
    devices: PathBuf,
}
fn sanitize(s: &str, max: usize, fallback: &str) -> String {
    let safe = s
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>();
    let text = safe.split_whitespace().collect::<Vec<_>>().join(" ");
    let text = text.chars().take(max).collect::<String>();
    if text.is_empty() {
        fallback.into()
    } else {
        text
    }
}
impl NeoNotifier {
    pub fn from_env(home: &Path) -> Result<Self> {
        let dir = home.join("Library/Application Support/NeoY");
        let endpoint = match env::var("NEO_MODELS_MCP_URL") {
            Ok(s) => s,
            Err(_) => {
                let cfg = store::read(&dir.join("deployment.json"))?.unwrap_or(json!({}));
                let port = match cfg["mcpPort"].as_u64() {
                    None | Some(9224) => 6767,
                    Some(p) if (1..=65535).contains(&p) => p,
                    _ => return Err("Invalid Neo MCP port".into()),
                };
                format!("http://127.0.0.1:{port}/mcp")
            }
        };
        let url = Url::parse(&endpoint).map_err(|_| "Invalid Neo MCP endpoint")?;
        if url.scheme() != "http"
            || url.host_str() != Some("127.0.0.1")
            || url.port_or_known_default().is_none()
            || url.path() != "/mcp"
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("Neo MCP endpoint must be local /mcp".into());
        }
        Ok(Self {
            endpoint,
            devices: dir.join("apns/devices.json"),
        })
    }
    fn post(&self, url: &str, data: &Value) -> Result<Value> {
        let agent = ureq::Agent::config_builder()
            .max_redirects(0)
            .timeout_global(Some(Duration::from_secs(20)))
            .build()
            .new_agent();
        let mut r = agent
            .post(url)
            .header("Accept", "application/json, text/event-stream")
            .send_json(data)
            .map_err(|_| "Neo notification request unavailable")?;
        if !r.status().is_success() {
            return Err("Neo notification request failed".into());
        }
        let sse = r
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|s| s.contains("text/event-stream"));
        let mut bytes = vec![];
        r.body_mut()
            .as_reader()
            .take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Neo notification response unavailable")?;
        if bytes.len() > 1024 * 1024 {
            return Err("Neo notification response exceeds bound".into());
        }
        let text = std::str::from_utf8(&bytes).map_err(|_| "Invalid Neo notification response")?;
        let json = if sse {
            text.lines()
                .find_map(|l| l.strip_prefix("data:"))
                .ok_or("Neo MCP SSE result missing")?
        } else {
            text
        };
        serde_json::from_str(json).map_err(|_| "Invalid Neo notification response".into())
    }
}
impl Notifier for NeoNotifier {
    fn send(&self, request: &str, payload: &Value) -> Result<NotifyOutcome> {
        let kind = payload["kind"]
            .as_str()
            .filter(|s| matches!(*s, "completed" | "blocked" | "failure"))
            .ok_or("Unsupported notification kind")?;
        let rpc=self.post(&self.endpoint,&json!({"jsonrpc":"2.0","id":now_ms(),"method":"tools/call","params":{"name":"setup","arguments":{"command":"events status"}}}))?;
        if !rpc["error"].is_null() || rpc["result"]["isError"] == true {
            return Err("Neo event notification policy unavailable".into());
        }
        let text = rpc["result"]["content"]
            .as_array()
            .ok_or("Neo notification policy unavailable")?
            .iter()
            .filter(|v| v["type"] == "text")
            .filter_map(|v| v["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let policy: Value =
            serde_json::from_str(&text).map_err(|_| "Invalid Neo notification policy")?;
        if ["completed", "blocked", "failure"]
            .iter()
            .any(|s| !policy[*s].is_boolean())
        {
            return Err("Invalid Neo notification policy".into());
        }
        if policy[kind] == false {
            return Ok(NotifyOutcome::Suppressed);
        }
        let registry = store::read(&self.devices)?.ok_or("Neo APNs device registry unavailable")?;
        let devices = registry["devices"]
            .as_object()
            .ok_or("Invalid Neo APNs device registry")?;
        let target = devices
            .iter()
            .filter(|(id, v)| {
                crate::store::codex_id(id)
                    && v["token"].as_str().is_some_and(|s| s.len() >= 64)
                    && matches!(v["environment"].as_str(), Some("sandbox" | "production"))
            })
            .max_by_key(|(_, v)| v["updatedAt"].as_str().unwrap_or(""))
            .map(|(id, _)| id)
            .ok_or("No registered Neo Mobile APNs target")?;
        let digest = format!(
            "{:x}",
            Sha256::digest(format!("orchestrator:{request}").as_bytes())
        );
        let id = &digest[..16];
        let url = format!(
            "{}/mobile/notify",
            self.endpoint
                .strip_suffix("/mcp")
                .ok_or("Invalid Neo MCP endpoint")?
        );
        let r=self.post(&url,&json!({"id":target,"title":sanitize(payload["title"].as_str().unwrap_or(""),160,"Neo"),"body":sanitize(payload["body"].as_str().unwrap_or(""),170,"-"),"payload":{"neoNotificationId":id}}))?;
        if r["accepted"] != true {
            return Err("Neo APNs did not accept the notification".into());
        }
        Ok(NotifyOutcome::Accepted(id.into()))
    }
}
