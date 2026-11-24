//! Durable Neo Mobile Orchestrator outbox. The generic Models service remains
//! the sole model execution and reply owner.
use crate::{
    attachments::{id, Attachments},
    now_ms,
    orchestrator_client::ModelClient,
    store::{self, codex_id, project_id, thread_id, Store},
    Result,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

fn text<'a>(v: &'a Value, k: &str) -> Result<&'a str> {
    v[k].as_str().ok_or_else(|| format!("missing {k}"))
}
fn exact(v: &Value, keys: &[&str]) -> bool {
    v.as_object()
        .is_some_and(|m| m.keys().all(|k| keys.contains(&k.as_str())))
}
fn digest(s: &[u8]) -> String {
    format!("{:x}", Sha256::digest(s))
}
fn fingerprint(text: &str, refs: &Value) -> String {
    digest(
        json!({"text":text,"attachments":refs})
            .to_string()
            .as_bytes(),
    )
}
fn identity(prefix: &str, id: &str) -> String {
    format!(
        "{prefix}_{}",
        &digest(format!("neo.orchestrator.{prefix}:{id}").as_bytes())[..40]
    )
}
fn uuid() -> Result<String> {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).map_err(|e| e.to_string())?;
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    let h: String = b.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &h[..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..]
    ))
}
fn requests(s: &Value) -> Result<&serde_json::Map<String, Value>> {
    s["requests"]
        .as_object()
        .ok_or("invalid Orchestrator requests".into())
}
fn req_mut<'a>(s: &'a mut Value, id: &str) -> Result<&'a mut Value> {
    s["requests"]
        .as_object_mut()
        .and_then(|r| r.get_mut(id))
        .ok_or("unknown request".into())
}
fn sanitize(s: &str, max: usize) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect()
}
pub fn parse_envelope(raw: &str) -> Result<Value> {
    let v: Value = serde_json::from_str(raw).map_err(|_| "invalid orchestrator reply envelope")?;
    if !exact(&v, &["schema", "message", "control"])
        || v["schema"] != "neo.orchestrator.reply.v1"
        || (v["message"].is_null() && v["control"].is_null())
    {
        return Err("invalid orchestrator reply envelope".into());
    }
    let mut message = v["message"].clone();
    let control = v["control"].clone();
    if !message.is_null() {
        let t = message["text"]
            .as_str()
            .filter(|s| !s.trim().is_empty() && s.encode_utf16().count() <= 20000);
        if !exact(&message, &["text", "level", "needs", "jobId"])
            || t.is_none()
            || !matches!(message["level"].as_str(), Some("info" | "attention"))
            || (message.get("needs").is_some()
                && !matches!(
                    message["needs"].as_str(),
                    Some("none" | "phone" | "work_node" | "retry")
                ))
            || (!message["jobId"].is_null()
                && !message["jobId"].as_str().is_some_and(|s| {
                    (1..=64).contains(&s.len())
                        && s.bytes()
                            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
                }))
        {
            return Err("invalid orchestrator message".into());
        }
        if message.get("needs").is_none() {
            message["needs"] = json!("none")
        }
        if message.get("jobId").is_none() {
            message["jobId"] = Value::Null
        }
    }
    if !control.is_null() {
        if !exact(
            &control,
            &[
                "action",
                "previousThreadId",
                "nextThreadId",
                "expectedGeneration",
                "handoffReceipt",
            ],
        ) || control["action"] != "replace-thread-id"
            || !control["previousThreadId"].as_str().is_some_and(thread_id)
            || !control["nextThreadId"].as_str().is_some_and(thread_id)
            || !control["expectedGeneration"]
                .as_u64()
                .is_some_and(|n| n <= 9_007_199_254_740_991)
            || !control["handoffReceipt"]
                .as_str()
                .is_some_and(|s| id(s) && s.len() >= 16)
        {
            return Err("invalid orchestrator control".into());
        }
    }
    Ok(json!({"schema":"neo.orchestrator.reply.v1","message":message,"control":control}))
}
pub trait HandoffVerifier: Send + Sync {
    fn verify(&self, project: &str, control: &Value) -> Result<()>;
}
pub trait Notifier: Send + Sync {
    fn send(&self, request: &str, payload: &Value) -> Result<NotifyOutcome>;
}
pub enum NotifyOutcome {
    Accepted(String),
    Suppressed,
}
pub struct Orchestrator {
    store: Store,
    dir: PathBuf,
    state: Mutex<Option<Value>>,
    client: Arc<dyn ModelClient>,
    verifier: Option<Arc<dyn HandoffVerifier>>,
    notifier: Option<Arc<dyn Notifier>>,
    busy: AtomicBool,
    notifying: AtomicBool,
}
impl Orchestrator {
    pub fn open(
        store: Store,
        client: Arc<dyn ModelClient>,
        verifier: Option<Arc<dyn HandoffVerifier>>,
        notifier: Option<Arc<dyn Notifier>>,
    ) -> Result<Arc<Self>> {
        let dir = store.base.join("orchestrator");
        crate::input::private_dir(&dir)?;
        let path = dir.join("state.json");
        let mut state = store::read(&path)?;
        if state.is_none() {
            if let Some(head) = store::read(&dir.join("bootstrap-head.json"))? {
                if !head["threadId"].as_str().is_some_and(thread_id)
                    || !head["projectId"].as_str().is_some_and(project_id)
                {
                    return Err("Existing Orchestrator Project/head not verified".into());
                }
                state = Some(
                    json!({"codexThreadId":uuid()?,"threadId":head["threadId"],"projectId":head["projectId"],"generation":0,"sequence":0,"requests":{},"events":[]}),
                );
            }
        }
        if let Some(s) = state.as_mut() {
            let owner = text(s, "codexThreadId")?.to_owned();
            let project = text(s, "projectId")?.to_owned();
            let head = text(s, "threadId")?.to_owned();
            if !codex_id(&owner)
                || !project_id(&project)
                || !thread_id(&head)
                || s["generation"].as_u64().is_none()
                || s["sequence"].as_u64().is_none()
                || !s["events"].is_array()
            {
                return Err("invalid Orchestrator state".into());
            }
            let generation = s["generation"].as_u64().unwrap();
            let tx = store.transaction()?;
            match tx.resolve(None, None, Some(&owner))? {
                None => {
                    if !requests(s)?.is_empty() {
                        return Err(
                            "Orchestrator mapping missing; manual reconciliation required".into(),
                        );
                    }
                    let mut mapped = tx.create(&[], None, Some(&owner))?;
                    mapped["threadId"] = json!(head);
                    mapped["projectId"] = json!(project);
                    mapped["orchestratorGeneration"] = json!(generation);
                    mapped["status"] = json!("idle");
                    tx.put_session(&mapped)?;
                }
                Some(mut mapped) => {
                    if mapped["projectId"] != project {
                        return Err("Conflicting persisted Orchestrator Project mapping".into());
                    }
                    let pending = s["pendingHandoff"].clone();
                    if !pending.is_null()
                        && mapped["threadId"] == pending["nextThreadId"]
                        && mapped["orchestratorGeneration"].as_u64() == generation.checked_add(1)
                        && pending["previousThreadId"] == head
                        && pending["expectedGeneration"].as_u64() == Some(generation)
                    {
                        s["threadId"] = pending["nextThreadId"].clone();
                        s["generation"] = json!(generation + 1);
                        s["lastCommittedHandoff"] = pending;
                        s.as_object_mut().unwrap().remove("pendingHandoff");
                    } else if mapped["threadId"] == head
                        && mapped["orchestratorGeneration"].as_u64().unwrap_or(0) == generation
                    {
                        s.as_object_mut().unwrap().remove("pendingHandoff");
                        if mapped.get("orchestratorGeneration").is_none() {
                            mapped["orchestratorGeneration"] = json!(generation);
                            tx.put_session(&mapped)?;
                        }
                    } else {
                        return Err(
                            "Conflicting persisted Orchestrator Codex/head generation".into()
                        );
                    }
                }
            }
            for r in s["requests"]
                .as_object_mut()
                .ok_or("invalid Orchestrator requests")?
                .values_mut()
            {
                let req = text(r, "requestId")?.to_owned();
                if !id(&req) {
                    return Err("invalid persisted Orchestrator request".into());
                }
                if r["dedupeHash"].is_null() {
                    if let Some(t) = r["text"].as_str() {
                        r["dedupeHash"] = json!(fingerprint(
                            t,
                            &r.get("attachments").cloned().unwrap_or(json!([]))
                        ))
                    }
                }
                if r["deliveryId"].is_null() {
                    r["deliveryId"] = json!(identity("delivery", &req))
                }
                if r["status"] == "processing" {
                    r["status"] = json!("uncertain")
                }
            }
            store::write(&path, s)?;
        }
        Ok(Arc::new(Self {
            store,
            dir,
            state: Mutex::new(state),
            client,
            verifier,
            notifier,
            busy: AtomicBool::new(false),
            notifying: AtomicBool::new(false),
        }))
    }
    fn with_state<T>(&self, f: impl FnOnce(&Value) -> Result<T>) -> Result<T> {
        let g = self
            .state
            .lock()
            .map_err(|_| "Orchestrator state lock poisoned")?;
        f(g.as_ref()
            .ok_or("Existing Orchestrator Project/head not verified; unavailable")?)
    }
    fn mutate<T>(&self, f: impl FnOnce(&mut Value) -> Result<T>) -> Result<T> {
        let mut g = self
            .state
            .lock()
            .map_err(|_| "Orchestrator state lock poisoned")?;
        let mut next = g
            .as_ref()
            .ok_or("Existing Orchestrator Project/head not verified; unavailable")?
            .clone();
        let result = f(&mut next)?;
        store::write(&self.dir.join("state.json"), &next)?;
        *g = Some(next);
        Ok(result)
    }
    fn emit(s: &mut Value, req: &str, status: &str, message: Option<&Value>) -> Result<()> {
        let seq = s["sequence"]
            .as_u64()
            .ok_or("invalid event sequence")?
            .checked_add(1)
            .ok_or("event sequence overflow")?;
        s["sequence"] = json!(seq);
        let mut event =
            json!({"id":seq,"requestId":req,"deliveryId":identity("delivery",req),"status":status});
        if let Some(m) = message.filter(|v| !v.is_null()) {
            event["messageId"] = json!(identity("message", req));
            for k in ["text", "level", "needs", "jobId"] {
                event[k] = m[k].clone()
            }
        }
        let events = s["events"].as_array_mut().ok_or("invalid events")?;
        events.push(event);
        if events.len() > 1000 {
            events.drain(..events.len() - 1000);
        }
        Ok(())
    }
    pub fn health(&self) -> Value {
        self.with_state(|s|{
            let tx=self.store.transaction()?;
            let ready=tx.resolve(None,None,Some(text(s,"codexThreadId")?))?.is_some_and(|m|m["threadId"]==s["threadId"]&&m["projectId"]==s["projectId"]&&m["orchestratorGeneration"].as_u64().unwrap_or(0)==s["generation"].as_u64().unwrap_or(0));
            let all=requests(s)?;
            let count=|status:&str|all.values().filter(|r|r["status"]==status).count();
            Ok(json!({"ready":ready,"mapping":if ready{"verified"}else{"conflict"},"queued":count("queued"),"processing":count("processing"),"uncertain":count("uncertain"),"unacknowledged":all.values().filter(|r|r["ack"]!=true).count(),"apnsPending":all.values().filter(|r|r["notification"]["status"]=="pending").count(),"retentionAvailable":10000usize.saturating_sub(all.len())}))
        }).unwrap_or(json!({"ready":false,"mapping":"unavailable"}))
    }
    pub fn upload(&self, v: &Value) -> Result<Value> {
        self.with_state(|s| {
            let req = text(v, "requestId")?;
            if requests(s)?.contains_key(req) {
                return Err("Attachment upload after request acceptance refused".into());
            }
            Attachments::new(self.dir.clone()).upload(v)
        })
    }
    pub fn submit(&self, v: &Value) -> Result<Value> {
        let request = text(v, "requestId")?;
        let message = text(v, "text")?;
        if !id(request) || message.trim().is_empty() || message.len() > 24000 {
            return Err("invalid orchestrator message".into());
        }
        let refs = v.get("attachments").cloned().unwrap_or(json!([]));
        let list = refs
            .as_array()
            .filter(|a| a.len() <= 4)
            .ok_or("too many attachments")?;
        let hash = fingerprint(message, &refs);
        self.mutate(|s|{
            if let Some(old)=requests(s)?.get(request){
                if old["dedupeHash"]!=hash{return Err("requestId conflict".into())}
                return Ok(json!({"requestId":request,"state":"accepted","status":old["status"]}))
            }
            if requests(s)?.len()>=10000{return Err("Orchestrator request retention capacity exceeded; manual reconciliation required".into())}
            let files=Attachments::new(self.dir.clone()).resolve(request,list)?;
            s["requests"][request]=json!({"requestId":request,"text":message,"deliveryId":identity("delivery",request),"dedupeHash":hash,"status":"queued","attachments":refs,"files":files,"ack":false,"createdAt":now_ms()});
            Self::emit(s,request,"queued",None)?;
            Ok(json!({"requestId":request,"state":"accepted","status":"queued"}))
        })
    }
    pub fn pending(&self, request: Option<&str>) -> Result<Value> {
        self.with_state(|s|{
            let all=requests(s)?;
            let pending=all.values().filter(|r|r["ack"]!=true).map(|r|json!({"requestId":r["requestId"],"deliveryId":r["deliveryId"],"status":r["status"],"message":r["message"],"createdAt":r["createdAt"]})).collect::<Vec<_>>();
            let mut result=json!({"pending":pending,"cursor":s["sequence"]});
            if let Some(idstr)=request{if !id(idstr){return Err("Invalid request ID".into())}result["accepted"]=json!(all.contains_key(idstr))}
            Ok(result)
        })
    }
    pub fn events_after(&self, cursor: u64) -> Result<Vec<Value>> {
        self.with_state(|s| {
            let seq = s["sequence"].as_u64().ok_or("invalid event sequence")?;
            if cursor > seq {
                return Err("future event cursor".into());
            }
            let events = s["events"].as_array().ok_or("invalid events")?;
            let oldest = events.first().and_then(|e| e["id"].as_u64()).unwrap_or(seq);
            if cursor < oldest.saturating_sub(1) {
                return Err("event cursor expired; recover via pending".into());
            }
            Ok(events
                .iter()
                .filter(|e| e["id"].as_u64().unwrap_or(0) > cursor)
                .cloned()
                .collect())
        })
    }
    pub fn ack(&self, delivery: &str) -> Result<Value> {
        let (idstr, v1, owner) = self.mutate(|s| {
            let request = requests(s)?
                .iter()
                .find(|(_, r)| r["deliveryId"] == delivery)
                .map(|(k, _)| k.clone())
                .ok_or("unknown delivery")?;
            let r = req_mut(s, &request)?;
            if !matches!(r["status"].as_str(), Some("completed" | "failed")) {
                return Err("delivery not terminal".into());
            }
            let v1 = r["v1ResponseId"].as_str().map(str::to_owned);
            r["ack"] = json!(true);
            for k in ["text", "message", "files", "attachments"] {
                r.as_object_mut().unwrap().remove(k);
            }
            for e in s["events"].as_array_mut().ok_or("invalid events")? {
                if e["requestId"] == request {
                    for k in ["message", "text", "level", "needs", "jobId"] {
                        e.as_object_mut().unwrap().remove(k);
                    }
                }
            }
            Ok((request, v1, text(s, "codexThreadId")?.to_owned()))
        })?;
        if let Some(id) = v1 {
            let tx = self.store.transaction()?;
            if let (Some(mut response), Some(mut session)) =
                (tx.response(&id)?, tx.resolve(None, None, Some(&owner))?)
            {
                if response["sessionId"] == session["id"] {
                    response.as_object_mut().unwrap().remove("reports");
                    response.as_object_mut().unwrap().remove("metadata");
                    response["output"] = json!([]);
                    response["scrubbed"] = json!(true);
                    tx.put_response(&response)?;
                    // Never scrub a newer turn's diagnostics.
                    if session["lastResponseId"] == id {
                        session["lastInput"] = json!([]);
                        session["history"] = json!([]);
                        tx.put_session(&session)?;
                    }
                }
            }
        }
        Attachments::new(self.dir.clone()).scrub(&idstr)?;
        Ok(json!({"deliveryId":delivery,"acked":true}))
    }
    fn queue_notice(r: &mut Value) {
        let m = &r["message"];
        let failed = r["status"] == "failed";
        if !failed && m["level"] != "attention" && m["needs"].as_str().is_none_or(|s| s == "none") {
            return;
        }
        if r["notification"].is_null() {
            r["notification"] = json!({"status":"pending","attempts":0,"nextAttemptAt":0,"payload":{"kind":if failed{"failure"}else{"blocked"},"title":if failed{"Orchestrator error"}else{"Orchestrator report"},"body":sanitize(m["text"].as_str().unwrap_or("Orchestrator needs attention"),170)}})
        }
    }
    fn settle(&self, request: &str, status: &str, message: Value) -> Result<()> {
        self.mutate(|s| {
            let r = req_mut(s, request)?;
            r["status"] = json!(status);
            r["message"] = message.clone();
            Self::queue_notice(r);
            Self::emit(s, request, status, Some(&message))
        })
    }
    fn fail_verified(&self, request: &str, error: &str) -> Result<()> {
        self.settle(request,"failed",json!({"text":format!("Orchestrator request failed: {}",error.chars().take(240).collect::<String>()),"level":"attention","needs":"retry","jobId":null}))
    }
    fn finish_model(&self, request: &str, response: &Value) -> Result<()> {
        let result = (|| {
            let id = self.with_state(|s| {
                Ok(
                    requests(s)?.get(request).ok_or("unknown request")?["v1ResponseId"]
                        .as_str()
                        .ok_or("missing internal response identity")?
                        .to_owned(),
                )
            })?;
            let recorded = self
                .store
                .response(&id)?
                .ok_or("missing internal response")?;
            if recorded["reports"].as_array().is_none_or(|a| a.len() != 1)
                || response["id"] != id
                || recorded["status"] != "completed"
            {
                return Err("Orchestrator reply must be exactly one complete reply.text".into());
            }
            let raw = recorded["reports"][0]
                .as_str()
                .ok_or("missing reply text")?;
            let envelope = parse_envelope(raw)?;
            if !envelope["control"].is_null() {
                self.replace_thread(&envelope["control"])?;
            }
            self.settle(request, "completed", envelope["message"].clone())
        })();
        if let Err(error) = result {
            self.fail_verified(request, &error)?;
        }
        Ok(())
    }
    pub fn process_one(&self) -> Result<bool> {
        if self.busy.swap(true, Ordering::AcqRel) {
            return Ok(false);
        }
        struct Flag<'a>(&'a AtomicBool);
        impl Drop for Flag<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
        let _guard = Flag(&self.busy);
        let selected = self.with_state(|s| {
            let all = requests(s)?;
            if let Some((id, r)) = all.iter().find(|(_, r)| r["status"] == "uncertain") {
                return Ok(Some((id.clone(), r.clone(), s.clone())));
            }
            Ok(all
                .iter()
                .find(|(_, r)| r["status"] == "queued")
                .map(|(id, r)| (id.clone(), r.clone(), s.clone())))
        });
        let Some((request, r, s)) = selected? else {
            return Ok(false);
        };
        if r["status"] == "uncertain" {
            let Some(resp) = r["v1ResponseId"].as_str() else {
                return Ok(false);
            };
            let Some(response) = self.store.response(resp)? else {
                return Ok(false);
            };
            if response["status"] != "completed" || response["scrubbed"] == true {
                return Ok(false);
            }
            let tx = self.store.transaction()?;
            if tx
                .resolve(None, None, Some(text(&s, "codexThreadId")?))?
                .is_none_or(|m| m["id"] != response["sessionId"])
            {
                return Ok(false);
            }
            drop(tx);
            self.finish_model(&request, &response)?;
            return Ok(true);
        }
        self.mutate(|s| {
            req_mut(s, &request)?["status"] = json!("processing");
            Self::emit(s, &request, "processing", None)
        })?;
        let mut prompt = text(&r, "text")?.to_owned();
        let files = r["files"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(PathBuf::from)
            .collect::<Vec<_>>();
        if let Some(refs) = r["attachments"].as_array().filter(|a| !a.is_empty()) {
            prompt.push_str("\n\nAttached files (verified, available locally for this turn): ");
            prompt.push_str(
                &refs
                    .iter()
                    .filter_map(|a| a["name"].as_str())
                    .collect::<Vec<_>>()
                    .join(", "),
            );
        }
        let enforcement=format!("{}\nCurrent verified Orchestrator Project: {}\nCurrent ChatGPT Thread: {}\nCurrent handoff generation: {}\nOnly server-authorized handoffs may change the head.",include_str!("orchestrator-enforcement.txt").trim(),text(&s,"projectId")?,text(&s,"threadId")?,s["generation"]);
        let body = json!({"model":"neo","stream":true,"input":[{"role":"user","content":[{"type":"input_text","text":prompt}]}],"enforcement_context":enforcement});
        let result = self
            .client
            .run(body, text(&s, "codexThreadId")?, files, &mut |response| {
                self.mutate(|s| {
                    req_mut(s, &request)?["v1ResponseId"] = json!(response);
                    Ok(())
                })
            });
        match result {
            Ok(response) => self.finish_model(&request, &response)?,
            Err(e) => self.mutate(|s| {
                let r = req_mut(s, &request)?;
                r["status"] = json!("uncertain");
                r["lastError"] = json!(e.chars().take(160).collect::<String>());
                Self::emit(s, &request, "uncertain", None)
            })?,
        }
        Ok(true)
    }
    pub fn replace_thread(&self, c: &Value) -> Result<u64> {
        let envelope =
            parse_envelope(&json!({"schema":"neo.orchestrator.reply.v1","control":c}).to_string())?;
        let c = &envelope["control"];
        let previous = text(c, "previousThreadId")?;
        let next = text(c, "nextThreadId")?;
        let expected = c["expectedGeneration"]
            .as_u64()
            .ok_or("invalid generation")?;
        let (project, owner, replay) = self.with_state(|s| {
            let replay = s["lastCommittedHandoff"] == *c
                && s["threadId"] == next
                && s["generation"].as_u64() == expected.checked_add(1);
            if !replay
                && (s["threadId"] != previous
                    || s["generation"].as_u64() != Some(expected)
                    || previous == next)
            {
                return Err("stale or conflicting head replacement".into());
            }
            Ok((
                text(s, "projectId")?.to_owned(),
                text(s, "codexThreadId")?.to_owned(),
                replay,
            ))
        })?;
        if replay {
            let tx = self.store.transaction()?;
            let m = tx
                .resolve(None, None, Some(&owner))?
                .ok_or("missing mapping")?;
            if m["threadId"] == next
                && m["projectId"] == project
                && m["orchestratorGeneration"].as_u64() == expected.checked_add(1)
            {
                return Ok(expected + 1);
            }
            return Err("Orchestrator committed handoff mapping mismatch".into());
        }
        self.verifier
            .as_ref()
            .ok_or("Independent thread/handoff verifier unavailable")?
            .verify(&project, c)?;
        // Serialize state and ModelStore CAS; persist a recovery marker before CAS.
        let mut g = self
            .state
            .lock()
            .map_err(|_| "Orchestrator state lock poisoned")?;
        let s = g.as_mut().ok_or("Orchestrator unavailable")?;
        if s["threadId"] != previous || s["generation"].as_u64() != Some(expected) {
            return Err("head changed during verification".into());
        }
        s["pendingHandoff"] = c.clone();
        store::write(&self.dir.join("state.json"), s)?;
        let tx = self.store.transaction()?;
        let generation = tx.cas_orchestrator(&owner, &project, previous, next, expected)?;
        s["threadId"] = json!(next);
        s["generation"] = json!(generation);
        s["lastCommittedHandoff"] = c.clone();
        s.as_object_mut().unwrap().remove("pendingHandoff");
        store::write(&self.dir.join("state.json"), s)?;
        Ok(generation)
    }
    pub fn flush_one(&self) -> Result<bool> {
        let Some(notifier) = &self.notifier else {
            return Ok(false);
        };
        if self.notifying.swap(true, Ordering::AcqRel) {
            return Ok(false);
        }
        struct Flag<'a>(&'a AtomicBool);
        impl Drop for Flag<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
        let _guard = Flag(&self.notifying);
        let selected = self.with_state(|s| {
            Ok(requests(s)?
                .iter()
                .find(|(_, r)| {
                    r["notification"]["status"] == "pending"
                        && r["notification"]["nextAttemptAt"].as_u64().unwrap_or(0) <= now_ms()
                })
                .map(|(id, r)| (id.clone(), r["notification"]["payload"].clone())))
        })?;
        let Some((request, payload)) = selected else {
            return Ok(false);
        };
        let result = if payload["kind"] == "completed" {
            Ok(NotifyOutcome::Suppressed)
        } else {
            notifier.send(&request, &payload)
        };
        self.mutate(|s| {
            let r = req_mut(s, &request)?;
            let n = &mut r["notification"];
            match result {
                Ok(NotifyOutcome::Accepted(id)) => {
                    n["status"] = json!("delivered");
                    n["deliveryId"] = json!(id);
                    n["deliveredAt"] = json!(now_ms());
                    n.as_object_mut().unwrap().remove("payload");
                }
                Ok(NotifyOutcome::Suppressed) => {
                    n["status"] = json!("suppressed");
                    n["suppressedAt"] = json!(now_ms());
                    n.as_object_mut().unwrap().remove("payload");
                }
                Err(e) => {
                    let attempt = n["attempts"].as_u64().unwrap_or(0) + 1;
                    n["attempts"] = json!(attempt);
                    n["lastError"] = json!(e.chars().take(120).collect::<String>());
                    n["nextAttemptAt"] = json!(
                        now_ms()
                            + 3_600_000u64.min(5000 * (1 << attempt.saturating_sub(1).min(10)))
                    );
                }
            }
            Ok(())
        })?;
        Ok(true)
    }
    pub fn start(self: &Arc<Self>, ready: Arc<AtomicBool>) {
        let o = self.clone();
        thread::spawn(move || loop {
            if ready.load(Ordering::Acquire) {
                match o.process_one() {
                    Ok(true) => continue,
                    Ok(false) => {}
                    Err(e) => eprintln!("[orchestrator] {e}"),
                }
            }
            thread::sleep(Duration::from_millis(250));
        });
        if self.notifier.is_some() {
            let o = self.clone();
            thread::spawn(move || loop {
                match o.flush_one() {
                    Ok(true) => continue,
                    Ok(false) => {}
                    Err(e) => eprintln!("[orchestrator-notify] {e}"),
                }
                thread::sleep(Duration::from_secs(5));
            });
        }
    }
}
