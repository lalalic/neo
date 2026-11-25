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
    fn recovery_ready(&self, _response: &str, _next_seq: usize, _attempt: usize) -> Result<bool> {
        Ok(false)
    }
    fn remind(&self, _response: &str, _next_seq: usize, _attempt: usize) -> Result<bool> {
        Err("same-thread recovery is unavailable".into())
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
        thinking: Option<&str>,
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
    platform: String,
}
fn command(binary: &Path, temp: &Path, args: &[String]) -> Result<Value> {
    command_timeout(binary, temp, args, 300)
}
fn command_timeout(binary: &Path, temp: &Path, args: &[String], seconds: u64) -> Result<Value> {
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
        if start.elapsed() > Duration::from_secs(seconds)
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
// Recover only from the URL in the original caller-owned Session after Send.
impl Held {
    fn observe_url(&self) -> Result<Value> {
        let session = self.session.as_deref().ok_or("no owned session")?;
        let mut file = tempfile::NamedTempFile::new_in(&self.temp).map_err(|e| e.to_string())?;
        file.write_all(b"return (await page_info()).url;")
            .map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
        let r = command_timeout(
            &self.binary,
            &self.temp,
            &strings(&[
                "session",
                "exec",
                session,
                "--code-file",
                file.path().to_str().ok_or("invalid temp path")?,
            ]),
            35,
        )?;
        if r["ok"] != true {
            return Err("owned browser URL observation not verified".into());
        }
        Ok(r["value"].clone())
    }
    fn recover_receipt(&self, project: Option<&str>) -> Result<Value> {
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(90) {
            if let Ok(observed) = self.observe_url() {
                if let Some((id, url)) = verified_thread_url(&observed, project) {
                    return Ok(
                        json!({"status":"submitted","thread_id":id,"thread_url":url,"project_id":project,"verified_by":"same-session-recovery"}),
                    );
                }
            }
            self.heartbeat()?;
            thread::sleep(Duration::from_secs(2));
        }
        Err("Send clicked; original Thread ID still unconfirmed; no resend".into())
    }
}
fn verified_thread_url(value: &Value, project: Option<&str>) -> Option<(String, String)> {
    let mut u = Url::parse(value.as_str()?).ok()?;
    if u.scheme() != "https"
        || u.host_str() != Some("chatgpt.com")
        || u.port().is_some()
        || !u.username().is_empty()
        || u.password().is_some()
    {
        return None;
    }
    let p = u
        .path_segments()?
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();
    let id = match (p.as_slice(), project) {
        (["c", id], None) => *id,
        (["g", scope, "c", id], Some(project))
            if *scope == project || scope.starts_with(&format!("{project}-")) =>
        {
            *id
        }
        _ => return None,
    };
    if !thread_id(id) || id.starts_with("local-") {
        return None;
    }
    let id = id.to_owned();
    u.set_query(None);
    u.set_fragment(None);
    Some((id, u.to_string()))
}
// The readiness probe and delivery use the same normal Action config.
fn recovery_config(thread: &str, response: &str, next_seq: usize, attempt: usize) -> Value {
    let message=format!("Finish existing request {response}. Do not repeat completed actions. Continue only unfinished work. 1. Publish the actual result to reply/models/{response} with reply.text, seq={next_seq} (skip if final text was already accepted). 2. Publish reply.completed separately with data={{}}; on actual failure use reply.failed with an error. 3. Verify the publish receipts before ending.");
    json!({"thread_id":thread,"message":message,"mergeable":false,"idempotency_key":format!("{response}-recovery-{attempt}")})
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
    fn recovery_ready(&self, response: &str, next_seq: usize, attempt: usize) -> Result<bool> {
        let Some(session) = self.session.as_deref() else {
            return Ok(false);
        };
        let thread = self.receipt["thread_id"]
            .as_str()
            .ok_or("no verified thread")?;
        let mut config = recovery_config(thread, response, next_seq, attempt);
        if let Some(project) = self.receipt["project_id"].as_str() {
            config["project_id"] = json!(project);
        }
        let mut f = tempfile::NamedTempFile::new_in(&self.temp).map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut f, &config).map_err(|e| e.to_string())?;
        f.flush().map_err(|e| e.to_string())?;
        let result = command_timeout(
            &self.binary,
            &self.temp,
            &strings(&[
                "platform",
                "run",
                &self.platform,
                "validate_new_turn_ready",
                "--session-id",
                session,
                "--config",
                f.path().to_str().ok_or("invalid temp path")?,
            ]),
            35,
        )?;
        result
            .as_bool()
            .ok_or("invalid recovery readiness result".into())
    }
    fn remind(&self, response: &str, next_seq: usize, attempt: usize) -> Result<bool> {
        // The ordinary new-turn action owns Send readiness and delivery.
        let session = self.session.as_deref().ok_or("no owned session")?;
        let thread = self.receipt["thread_id"]
            .as_str()
            .ok_or("no verified thread")?;
        let mut config = recovery_config(thread, response, next_seq, attempt);
        if let Some(p) = self.receipt["project_id"].as_str() {
            config["project_id"] = json!(p);
        }
        let mut f = tempfile::NamedTempFile::new_in(&self.temp).map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut f, &config).map_err(|e| e.to_string())?;
        f.flush().map_err(|e| e.to_string())?;
        let r = command(
            &self.binary,
            &self.temp,
            &strings(&[
                "platform",
                "run",
                &self.platform,
                "new-turn",
                "--session-id",
                session,
                "--config",
                f.path().to_str().ok_or("invalid temp path")?,
            ]),
        )?;
        if r["status"] == "not_ready" {
            return Ok(false);
        }
        if r["status"] != "submitted" || r["thread_id"] != thread {
            return Err("same-thread recovery submission unconfirmed".into());
        }
        Ok(true)
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
    pub(crate) fn inspect(&self, thread: &str, script: &str) -> Result<Value> {
        if !thread_id(thread) {
            return Err("invalid ChatGPT thread".into());
        }
        let session = self.open(&format!("https://chatgpt.com/c/{thread}"))?;
        let result = (|| {
            let mut file =
                tempfile::NamedTempFile::new_in(&self.temp).map_err(|e| e.to_string())?;
            file.write_all(script.as_bytes())
                .map_err(|e| e.to_string())?;
            file.flush().map_err(|e| e.to_string())?;
            let result = command_timeout(
                &self.binary,
                &self.temp,
                &strings(&[
                    "session",
                    "exec",
                    &session,
                    "--code-file",
                    file.path().to_str().ok_or("invalid temp path")?,
                ]),
                35,
            )?;
            if result["ok"] != true {
                return Err("WebHelm inspection not verified".into());
            }
            Ok(result["value"].clone())
        })();
        close(&self.binary, &self.temp, &session);
        result
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
        thinking: Option<&str>,
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
            platform: self.platform.clone(),
        };
        let mut config = json!({"message":prompt,"enforcement_context":enforcement});
        if let Some(level) = thinking {
            config["thinking_level"] = json!(level);
        }
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
            if held.session.is_some() {
                config["recover_thread_receipt"] = json!(true);
            }
            // The existing new-thread Action receives image references in the
            // user prompt; subsequent turns use its supported file field.
            let mut receipt = self.action(
                "new-thread",
                &config,
                held.session.as_deref(),
                held.session.is_none(),
            )?;
            if receipt["status"] == "submitted"
                && receipt["receipt_pending"] == true
                && receipt["verified_by"] == "send-clicked"
                && held.session.is_some()
            {
                receipt = held.recover_receipt(project)?;
            }
            let id = receipt["thread_id"]
                .as_str()
                .filter(|s| thread_id(s))
                .ok_or("new-thread returned no verified thread ID")?;
            if receipt["status"] != "submitted"
                || !verified_thread_url(&receipt["thread_url"], project)
                    .is_some_and(|(thread, _)| thread == id)
            {
                return Err("new-thread returned no verified submission receipt".into());
            }
            if let Some(p) = project {
                if receipt["project_id"] != p {
                    return Err("new-thread did not verify configured project".into());
                }
            }
            held.receipt = receipt;
        }
        Ok(Box::new(held))
    }
}

#[cfg(test)]
mod recovery_tests {
    use super::*;

    #[test]
    fn recovery_accepts_only_durable_chatgpt_urls() {
        let id = "6b0614ab-8228-83e9-81d3-e675192bc7e1";
        assert_eq!(
            verified_thread_url(
                &json!(format!("https://chatgpt.com/c/{id}?prompt=ignored")),
                None
            ),
            Some((id.to_owned(), format!("https://chatgpt.com/c/{id}")))
        );
        let project = "g-p-example123";
        assert!(verified_thread_url(
            &json!(format!("https://chatgpt.com/g/{project}-slug/c/{id}")),
            Some(project)
        )
        .is_some());
        for url in [
            "https://chatgpt.com/c/local-chatgpt%3A12345678",
            "https://chatgpt.com/c/local-chatgpt-12345678",
            "https://evil.example/c/fixture_thread_123",
            "https://chatgpt.com/?prompt=hi",
        ] {
            assert!(verified_thread_url(&json!(url), None).is_none(), "{url}");
        }
        assert!(verified_thread_url(
            &json!(format!("https://chatgpt.com/g/g-p-other123/c/{id}")),
            Some(project)
        )
        .is_none());
    }

    #[test]
    fn recovery_uses_standard_new_turn_input_and_unique_key() {
        let response = format!("resp_{}", "a".repeat(40));
        let first = recovery_config("thread123456", &response, 1, 1);
        let next = recovery_config("thread123456", &response, 2, 2);
        assert_eq!(first["thread_id"], "thread123456");
        assert!(first["message"]
            .as_str()
            .unwrap()
            .contains(&format!("reply/models/{response}")));
        assert!(next["message"].as_str().unwrap().contains("seq=2"));
        assert_ne!(first["idempotency_key"], next["idempotency_key"]);
        assert_eq!(first["mergeable"], false);
        assert!(first.get("recovery_response_id").is_none());
    }
}
