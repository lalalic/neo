use crate::{
    input, key, now_ms,
    store::{codex_id, Store},
    webhelm::Transport,
    Result,
};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
#[derive(Clone)]
pub struct Engine {
    pub store: Store,
    transport: Arc<dyn Transport>,
    busy: Arc<Mutex<HashSet<String>>>,
}
pub struct Admission {
    pub id: String,
    pub initial: Value,
}
struct Work {
    sid: String,
    id: String,
    latest: Value,
    thread: Option<String>,
    project: Option<String>,
    enforcement: Option<String>,
    thinking: Option<String>,
    attachments: Vec<PathBuf>,
}
impl Engine {
    pub fn new(store: Store, transport: Arc<dyn Transport>) -> Self {
        Self {
            store,
            transport,
            busy: Arc::new(Mutex::new(HashSet::new())),
        }
    }
    pub fn start(
        &self,
        body: Value,
        header: Option<&str>,
        attachments: Vec<PathBuf>,
    ) -> Result<Admission> {
        if attachments.len() > 4 || attachments.iter().any(|p| !p.is_absolute()) {
            return Err("invalid verified attachment paths".into());
        }
        let messages = input::messages(&body)?;
        let latest = messages
            .iter()
            .rev()
            .find(|m| m["role"] == "user")
            .cloned()
            .ok_or("a new user message is required for ChatGPT delivery")?;
        let condensed = input::compact(&messages);
        let hint = body["metadata"]["session_id"].as_str();
        let declared = body["metadata"]["codex_thread_id"].as_str();
        if let (Some(a), Some(b)) = (header, declared) {
            if a != b {
                return Err("Codex Thread ID conflicts with request metadata".into());
            }
        }
        let owner = header.or(declared);
        if owner.is_some_and(|s| !codex_id(s)) {
            return Err("invalid Codex Thread ID".into());
        }
        let raw_id = body["input"]
            .as_array()
            .and_then(|a| a.iter().rev().find(|v| v["role"] == "user"))
            .and_then(|v| v["id"].as_str())
            .filter(|s| {
                (8..=128).contains(&s.len())
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            });
        let enforcement = match body.get("enforcement_context") {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) => Some(s.clone()),
            _ => return Err("invalid enforcement_context".into()),
        };
        // The provider may omit effort; only explicitly supported values are forwarded.
        let thinking = body
            .pointer("/reasoning/effort")
            .or_else(|| body.get("reasoning_effort"))
            .and_then(Value::as_str)
            .filter(|s| matches!(*s, "low" | "medium" | "high" | "xhigh" | "minimal" | "none"))
            .map(|s| {
                match s {
                    "xhigh" => "extra high",
                    "minimal" | "none" | "low" => "instant",
                    x => x,
                }
                .to_owned()
            });
        // Validate enforcement before reserving a durable turn.
        let id = format!("resp_{}", key()?);
        input::prompt(&id, &latest, &[], enforcement.as_deref())?;
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let mut busy = self.busy.lock().map_err(|_| "execution lock poisoned")?;
            let tx = self.store.transaction()?;
            let mut session =
                match tx.resolve(body["previous_response_id"].as_str(), hint, owner)? {
                    Some(s) => s,
                    None => tx.create(&condensed, hint, owner)?,
                };
            let sid = session["id"]
                .as_str()
                .ok_or("invalid session ID")?
                .to_owned();
            let last = session["lastResponseId"].as_str();
            if raw_id.is_some() && raw_id == session["lastUserItemId"].as_str() {
                if let Some(last) = last {
                    if let Some(r) = tx.response(last)? {
                        if r["status"] == "completed"
                            || (!body["stream"].as_bool().unwrap_or(false)
                                && matches!(
                                    session["status"].as_str(),
                                    Some("submitting" | "awaiting")
                                ))
                        {
                            return Ok(Admission {
                                id: last.to_owned(),
                                initial: r,
                            });
                        }
                    }
                }
            }
            if busy.contains(&sid)
                && session["status"] == "idle"
                && last.is_some()
                && Instant::now() < deadline
            {
                drop(tx);
                drop(busy);
                thread::sleep(Duration::from_millis(25));
                continue;
            }
            if busy.contains(&sid)
                || matches!(
                    session["status"].as_str(),
                    Some("submitting" | "awaiting" | "uncertain")
                )
            {
                return Err(
                    "session has an unconfirmed submission; manual reconciliation required".into(),
                );
            }
            if session["threadId"].is_null() && !attachments.is_empty() {
                return Err(
                    "verified attachment delivery requires an existing ChatGPT thread".into(),
                );
            }
            let response = json!({"id":id,"object":"response","model":"neo","created_at":now_ms()/1000,"status":"in_progress","output":[],"sessionId":sid,"usage":null,"metadata":body["metadata"]});
            let work = Work {
                sid: sid.clone(),
                id: id.clone(),
                latest,
                thread: session["threadId"].as_str().map(str::to_owned),
                project: session["projectId"].as_str().map(str::to_owned),
                enforcement,
                thinking,
                attachments,
            };
            session["status"] = json!("submitting");
            session["lastInput"] = json!(condensed);
            session["lastResponseId"] = json!(id);
            session["lastUserItemId"] = json!(raw_id);
            tx.put_response(&response)?;
            tx.put_session(&session)?;
            busy.insert(sid.clone());
            drop(tx);
            drop(busy);
            let engine = self.clone();
            let error_id = id.clone();
            let error_sid = sid.clone();
            if let Err(e) = thread::Builder::new()
                .name(format!("model-{}", &id[5..13]))
                .spawn(move || {
                    if let Err(e) = engine.execute(&work) {
                        let _ = engine.fail(&work.sid, &work.id, &e);
                    }
                    if let Ok(mut b) = engine.busy.lock() {
                        b.remove(&work.sid);
                    }
                })
            {
                self.fail(&error_sid, &error_id, &e.to_string())?;
                self.busy
                    .lock()
                    .map_err(|_| "execution lock poisoned")?
                    .remove(&error_sid);
                return Err("cannot start native model worker".into());
            }
            return Ok(Admission {
                id,
                initial: response,
            });
        }
    }
    fn execute(&self, w: &Work) -> Result<()> {
        let files = input::materialize_latest(
            &w.latest,
            &self.store.base.join("attachments").join(&w.sid),
        )?;
        let (prompt, enforcement) =
            input::prompt(&w.id, &w.latest, &files, w.enforcement.as_deref())?;
        let all = files
            .into_iter()
            .chain(w.attachments.iter().cloned())
            .collect::<Vec<_>>();
        let submission = self.transport.submit(
            w.thread.as_deref(),
            w.project.as_deref(),
            &prompt,
            &enforcement,
            &all,
            &w.id,
            w.thinking.as_deref(),
        )?;
        {
            let tx = self.store.transaction()?;
            let mut session = tx.session(&w.sid)?.ok_or("session vanished")?;
            if session["lastResponseId"] != w.id {
                return Err("session owner changed during submission".into());
            }
            let status = tx.response(&w.id)?.ok_or("response vanished")?["status"].clone();
            if w.thread.is_none() {
                let r = submission.receipt();
                session["threadId"] = r["thread_id"].clone();
                session["threadUrl"] = r["thread_url"].clone();
                session["projectId"] = r["project_id"].clone();
                if session["threadId"].as_str().is_none() {
                    return Err("missing verified thread receipt".into());
                }
            }
            session["status"] = json!(match status.as_str() {
                Some("completed") => "idle",
                Some("failed") => "uncertain",
                _ => "awaiting",
            });
            tx.put_session(&session)?;
        }
        let start = now_ms();
        let mut last_heartbeat = Instant::now();
        let mut last_observe = Instant::now();
        let mut recovery_count = 0usize;
        loop {
            let r = self.store.response(&w.id)?.ok_or("response vanished")?;
            match r["status"].as_str() {
                Some("completed") => return Ok(()),
                Some("failed") => {
                    return Err(r["error"]["message"]
                        .as_str()
                        .unwrap_or("model failed")
                        .to_owned())
                }
                _ => {}
            }
            let now = now_ms();
            if now.saturating_sub(start) >= 30 * 60 * 1000 {
                return Err("ChatGPT model result not reported before maximum duration".into());
            }
            if now.saturating_sub(start.max(r["last_activity_at"].as_u64().unwrap_or(0)))
                >= 9 * 60 * 1000
            {
                return Err("ChatGPT model result not reported before inactivity timeout".into());
            }
            // Check the canonical WebHelm readiness gate once per minute.
            // No fixed post-reminder deadline: continue observing until the
            // original response terminates or the existing request limits expire.
            if last_observe.elapsed() >= Duration::from_secs(60) {
                last_observe = Instant::now();
                let probe_seq = r["reports"].as_array().map_or(1, |a| a.len() + 1);
                match submission.recovery_ready(&w.id, probe_seq, recovery_count + 1) {
                    Ok(true) => {
                        // Replies can arrive while WebHelm checks readiness.
                        let latest = self.store.response(&w.id)?.ok_or("response vanished")?;
                        if latest["status"] != "in_progress" {
                            continue;
                        }
                        let next_seq = latest["reports"].as_array().map_or(1, |a| a.len() + 1);
                        if submission.remind(&w.id, next_seq, recovery_count + 1)? {
                            recovery_count += 1;
                            eprintln!(
                                "[models] recovery reminder {recovery_count} sent for {}",
                                w.id
                            );
                        }
                    }
                    Ok(false) => {}
                    Err(e) => eprintln!("[models] recovery readiness skipped: {e}"),
                }
                // Count the interval from the completed check/send, never burst.
                last_observe = Instant::now();
            }
            if last_heartbeat.elapsed() >= Duration::from_secs(30) {
                submission.heartbeat()?;
                last_heartbeat = Instant::now();
            }
            thread::sleep(Duration::from_millis(350));
        }
    }
    fn fail(&self, sid: &str, id: &str, error: &str) -> Result<()> {
        let tx = self.store.transaction()?;
        let mut r = tx.response(id)?.ok_or("response vanished")?;
        let mut session = tx.session(sid)?.ok_or("session vanished")?;
        // A reply that arrived before the first verified browser receipt
        // cannot establish a successful, resumable thread by itself.
        if r["status"] == "completed" && session["threadId"].as_str().is_some() {
            return Ok(());
        }
        if r["status"] != "failed" {
            r["status"] = json!("failed");
            r["error"] = json!({"type":"transport_error","message":error});
            tx.put_response(&r)?;
        }
        if session["lastResponseId"] == id {
            session["status"] = json!("uncertain");
            tx.put_session(&session)?;
        }
        Ok(())
    }
    pub fn snapshot(&self, id: &str) -> Result<Option<Value>> {
        let busy = self.busy.lock().map_err(|_| "execution lock poisoned")?;
        let tx = self.store.transaction()?;
        let Some(mut r) = tx.response(id)? else {
            return Ok(None);
        };
        // Don't expose a completed first turn until verified WebHelm thread
        // identity is persisted, even if the model reported very quickly.
        if r["status"] == "completed" && r["sessionId"].as_str().is_some_and(|s| busy.contains(s)) {
            if let Some(s) = r["sessionId"]
                .as_str()
                .map(|s| tx.session(s))
                .transpose()?
                .flatten()
            {
                if s["threadId"].is_null() {
                    r["status"] = json!("in_progress");
                    r["output"][0]["status"] = json!("in_progress")
                }
            }
        }
        Ok(Some(r))
    }
    pub fn wait(&self, id: &str) -> Result<Value> {
        loop {
            let r = self.snapshot(id)?.ok_or("response vanished")?;
            match r["status"].as_str() {
                Some("completed") => return Ok(r),
                Some("failed") => {
                    return Err(r["error"]["message"]
                        .as_str()
                        .unwrap_or("model failed")
                        .into())
                }
                _ => thread::sleep(Duration::from_millis(100)),
            }
        }
    }
}

// Restart cannot prove that an interrupted browser submission was not sent.
// Close the orphaned API request as failed and retain the uncertain mapping.
pub fn recover_interrupted(store: &Store) -> Result<()> {
    let tx = store.transaction()?;
    for mut session in tx.sessions()? {
        if !matches!(session["status"].as_str(), Some("submitting" | "awaiting")) {
            continue;
        }
        if let Some(id) = session["lastResponseId"].as_str() {
            if let Some(mut r) = tx.response(id)? {
                if r["status"] == "completed" && session["threadId"].as_str().is_some() {
                    session["status"] = json!("idle");
                    tx.put_session(&session)?;
                    continue;
                }
                if r["status"] == "in_progress" {
                    r["status"] = json!("failed");
                    r["error"] = json!({"type":"transport_error","message":"Models service restarted with an interrupted browser submission; manual reconciliation required"});
                    tx.put_response(&r)?;
                }
            }
        }
        session["status"] = json!("uncertain");
        tx.put_session(&session)?;
    }
    Ok(())
}
