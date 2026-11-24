//! Existing WebHelm CLI Actions own the browser. No browser pool or browser
//! protocol implementation is embedded in Models.
use crate::{
    input::private_dir,
    store::{project_id, thread_id},
    Result,
};
use serde_json::{json, Value};
use std::{
    env,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use url::Url;

pub trait Submission: Send {
    fn receipt(&self) -> &Value;
    fn heartbeat(&self) -> Result<()> {
        Ok(())
    }
}
pub trait Transport: Send + Sync {
    fn submit(
        &self,
        thread: Option<&str>,
        project: Option<&str>,
        prompt: &str,
        enforcement: &str,
        files: &[PathBuf],
        response: &str,
    ) -> Result<Box<dyn Submission>>;
}
pub struct WebHelm {
    binary: PathBuf,
    temp: PathBuf,
    project: Option<String>,
    platform: String,
    app: String,
    hold: bool,
    serialize: bool,
    new_thread: Mutex<()>,
}
pub struct Held {
    binary: PathBuf,
    temp: PathBuf,
    session: Option<String>,
    receipt: Value,
}
fn command(binary: &Path, temp: &Path, args: &[String]) -> Result<Value> {
    let output = tempfile::NamedTempFile::new_in(temp).map_err(|e| e.to_string())?;
    let errors = tempfile::NamedTempFile::new_in(temp).map_err(|e| e.to_string())?;
    let mut child = Command::new(binary)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(output.reopen().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(errors.reopen().map_err(|e| e.to_string())?))
        .spawn()
        .map_err(|e| e.to_string())?;
    let start = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break s;
        }
        if start.elapsed() > Duration::from_secs(300)
            || output
                .as_file()
                .metadata()
                .map_err(|e| e.to_string())?
                .len()
                > 2 * 1024 * 1024
            || errors
                .as_file()
                .metadata()
                .map_err(|e| e.to_string())?
                .len()
                > 2 * 1024 * 1024
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err(
                "WebHelm command timeout or output bound; submission status uncertain".into(),
            );
        }
        thread::sleep(Duration::from_millis(30));
    };
    let mut bytes = Vec::new();
    output
        .reopen()
        .map_err(|e| e.to_string())?
        .take(2 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("WebHelm output bound exceeded".into());
    }
    let parsed: Value =
        serde_json::from_slice(&bytes).map_err(|_| "WebHelm returned invalid JSON")?;
    if !status.success() || parsed["ok"] == false || parsed["result"]["ok"] == false {
        let error = parsed["result"]["error"]
            .as_str()
            .or_else(|| parsed["error"].as_str())
            .unwrap_or("WebHelm action failed");
        return Err(error.chars().take(300).collect());
    }
    Ok(parsed
        .pointer("/result/value")
        .or_else(|| parsed.get("result"))
        .unwrap_or(&parsed)
        .clone())
}
fn strings(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|s| s.to_string()).collect()
}
fn close(binary: &Path, temp: &Path, session: &str) {
    if let Err(e) = command(binary, temp, &strings(&["session", "stop", session])) {
        eprintln!("[models] WebHelm cleanup failed: {e}");
    }
}
impl Drop for Held {
    fn drop(&mut self) {
        if let Some(session) = &self.session {
            close(&self.binary, &self.temp, session)
        }
    }
}
impl Submission for Held {
    fn receipt(&self) -> &Value {
        &self.receipt
    }
    fn heartbeat(&self) -> Result<()> {
        if let Some(session) = &self.session {
            command(
                &self.binary,
                &self.temp,
                &strings(&["session", "heartbeat", session]),
            )?;
        }
        Ok(())
    }
}
impl WebHelm {
    pub fn from_env(home: &Path, base: &Path) -> Result<Self> {
        let cfg = home.join(".config/neo/models/chatgpt-project.json");
        let project = match crate::store::read(&cfg)? {
            None => None,
            Some(v) => {
                let id = v["project_id"]
                    .as_str()
                    .filter(|s| {
                        s.len() == 36
                            && s.starts_with("g-p-")
                            && s[4..].bytes().all(|b| b.is_ascii_alphanumeric())
                    })
                    .ok_or("Invalid Neo model ChatGPT Project ID")?;
                Some(id.to_owned())
            }
        };
        let temp = base.join("tmp");
        private_dir(&temp)?;
        let binary = env::var_os("NEO_MODELS_WEBHELM_COMMAND")
            .map(PathBuf::from)
            .unwrap_or(home.join(".local/bin/webhelm"));
        Ok(Self {
            binary,
            temp,
            project,
            platform: env::var("NEO_MODEL_WEBHELM_PLATFORM").unwrap_or("chatgpt".into()),
            app: env::var("NEO_MODEL_APP_MENTION").unwrap_or_default(),
            hold: env::var("NEO_MODEL_HOLD_CHATGPT_SESSION").as_deref() != Ok("0"),
            serialize: env::var("NEO_MODEL_SERIAL_NEW_THREAD").as_deref() != Ok("0"),
            new_thread: Mutex::new(()),
        })
    }
    fn open(&self, url: &str) -> Result<String> {
        let r = command(
            &self.binary,
            &self.temp,
            &strings(&["session", "start", "--url", url]),
        )?;
        let id = r["session_id"]
            .as_str()
            .filter(|s| {
                s.len() == 16
                    && s.bytes()
                        .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'))
            })
            .ok_or("WebHelm session start returned invalid session ID")?;
        if r["workspace"] != "WebHelm" {
            close(&self.binary, &self.temp, id);
            return Err("Model transport requires the default WebHelm workspace".into());
        }
        Ok(id.to_owned())
    }
    fn action(
        &self,
        action: &str,
        config: &Value,
        session: Option<&str>,
        auto: bool,
    ) -> Result<Value> {
        let mut f = tempfile::NamedTempFile::new_in(&self.temp).map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut f, config).map_err(|e| e.to_string())?;
        f.flush().map_err(|e| e.to_string())?;
        let mut args = strings(&["platform", "run", &self.platform, action]);
        if auto {
            args.push("--auto-session".into())
        } else if let Some(s) = session {
            args.extend(strings(&["--session-id", s]));
        }
        args.extend(strings(&[
            "--config",
            f.path().to_str().ok_or("invalid temp path")?,
        ]));
        command(&self.binary, &self.temp, &args)
    }
}
impl Transport for WebHelm {
    fn submit(
        &self,
        thread: Option<&str>,
        project: Option<&str>,
        prompt: &str,
        enforcement: &str,
        files: &[PathBuf],
        response: &str,
    ) -> Result<Box<dyn Submission>> {
        if files.len() > 4 || files.iter().any(|p| !p.is_absolute()) {
            return Err("invalid ChatGPT attachment paths".into());
        }
        let _serial = if thread.is_none() && self.serialize {
            Some(
                self.new_thread
                    .lock()
                    .map_err(|_| "WebHelm serialization lock poisoned")?,
            )
        } else {
            None
        };
        let project = if thread.is_none() {
            self.project.as_deref()
        } else {
            project
        };
        if project.is_some_and(|p| !project_id(p)) {
            return Err("invalid ChatGPT project".into());
        }
        if thread.is_some_and(|t| !thread_id(t)) {
            return Err("invalid ChatGPT thread".into());
        }
        let url = thread
            .map(|t| format!("https://chatgpt.com/c/{t}"))
            .unwrap_or("https://chatgpt.com/".into());
        let session = if self.hold {
            Some(self.open(&url)?)
        } else {
            None
        };
        let mut held = Held {
            binary: self.binary.clone(),
            temp: self.temp.clone(),
            session,
            receipt: Value::Null,
        };
        let mut config = json!({"message":prompt,"enforcement_context":enforcement});
        if let Some(p) = project {
            config["project_id"] = json!(p)
        }
        if !self.app.is_empty() {
            config["app"] = json!(self.app)
        }
        if let Some(t) = thread {
            config["thread_id"] = json!(t);
            config["mergeable"] = json!(false);
            config["idempotency_key"] = json!(response);
            if !files.is_empty() {
                config["file"] = json!(files)
            }
            let receipt = self.action("new-turn", &config, held.session.as_deref(), false)?;
            let valid = if held.session.is_some() {
                receipt["status"] == "submitted"
                    && receipt["thread_id"] == t
                    && receipt["verified_by"]
                        .as_str()
                        .is_some_and(|s| !s.is_empty())
            } else {
                receipt["status"] == "queued"
                    && receipt["queue_id"].as_str().is_some_and(|s| !s.is_empty())
            };
            if !valid {
                return Err("new-turn returned no verified direct or durable queue receipt".into());
            }
            held.receipt = receipt;
        } else {
            config["mode"] = json!("chat");
            config["temporary"] = json!(false);
            // The existing new-thread Action receives image references in the
            // user prompt; subsequent turns use its supported file field.
            let receipt = self.action(
                "new-thread",
                &config,
                held.session.as_deref(),
                held.session.is_none(),
            )?;
            let id = receipt["thread_id"]
                .as_str()
                .filter(|s| thread_id(s))
                .ok_or("new-thread returned no verified thread ID")?;
            let target = Url::parse(receipt["thread_url"].as_str().unwrap_or(""))
                .map_err(|_| "invalid new-thread URL")?;
            if receipt["status"] != "submitted"
                || target.scheme() != "https"
                || target.host_str() != Some("chatgpt.com")
                || target
                    .path_segments()
                    .is_none_or(|mut p| p.next_back() != Some(id))
            {
                return Err("new-thread returned no verified submission receipt".into());
            }
            if let Some(p) = project {
                if receipt["project_id"] != p || !target.path().contains(&format!("/g/{p}")) {
                    return Err("new-thread did not verify configured project".into());
                }
            }
            held.receipt = receipt;
        }
        Ok(Box::new(held))
    }
}
