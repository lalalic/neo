use crate::{
    key, now_ms,
    store::{response_id, Store},
    Result,
};
use serde_json::{json, Value};

/// Validate exact channel/source/subject and apply one durable journal update.
/// Text is never a terminal event. Unknown response IDs are ignored.
pub fn apply(store: &Store, subject: &str, prefix: &str, event: &Value) -> Result<Value> {
    let parsed = neo_reply::validate(subject, prefix, event)?;
    let id = parsed.request_id;
    if parsed.channel != "models" || !response_id(id) {
        return Err("invalid model reply channel or response_id".into());
    }
    let (kind, seq, text, error) = match parsed.payload {
        neo_reply::Payload::Text { seq, text } => ("reply.text", Some(seq), Some(text), None),
        neo_reply::Payload::Heartbeat => ("reply.heartbeat", None, None, None),
        neo_reply::Payload::Completed => ("reply.completed", None, None, None),
        neo_reply::Payload::Failed { error } => ("reply.failed", None, None, Some(error)),
    };
    let tx = store.transaction()?;
    let Some(mut r) = tx.response(id)? else {
        return Ok(json!({"ignored":true}));
    };
    if let Some(seq) = seq {
        let reports = r["reports"].as_array().cloned().unwrap_or_default();
        let expected = reports.len() as u64 + 1;
        if seq < expected {
            if reports[(seq - 1) as usize].as_str() == text {
                return Ok(json!({"duplicate":true}));
            }
            return Err("conflicting model reply sequence".into());
        }
        if seq != expected {
            return Err("out-of-order model reply sequence".into());
        }
    }
    if (kind == "reply.completed" && r["status"] == "completed")
        || (kind == "reply.failed" && r["status"] == "failed")
    {
        return Ok(r);
    }
    if r["status"] != "in_progress" {
        return Err("cannot update terminal response".into());
    }
    match kind {
        "reply.heartbeat" => {
            r["last_activity_at"] = json!(now_ms());
            r["heartbeat_count"] = json!(r["heartbeat_count"].as_u64().unwrap_or(0) + 1);
        }
        "reply.text" => {
            let mut reports = r["reports"].as_array().cloned().unwrap_or_default();
            reports.push(json!(text.unwrap()));
            let combined = reports
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join("\n");
            r["reports"] = json!(reports);
            r["last_activity_at"] = json!(now_ms());
            if r["output"].as_array().is_none_or(|a| a.is_empty()) {
                r["output"] = json!([{"id":format!("msg_{}",key()?),"type":"message","status":"in_progress","role":"assistant","content":[{"type":"output_text","text":combined,"annotations":[]}]}]);
            } else {
                r["output"][0]["content"][0]["text"] = json!(combined)
            }
        }
        "reply.completed" => {
            if r["output"].as_array().is_none_or(|a| a.is_empty()) {
                return Err("at least one text report required before completion".into());
            }
            r["output"][0]["status"] = json!("completed");
            r["status"] = json!("completed");
        }
        "reply.failed" => {
            r["status"] = json!("failed");
            r["error"] = json!({"type":"model_execution_failed","message":error.unwrap().chars().take(500).collect::<String>()});
        }
        _ => unreachable!(),
    }
    tx.put_response(&r)?;
    if matches!(kind, "reply.completed" | "reply.failed") {
        if let Some(sid) = r["sessionId"].as_str() {
            if let Some(mut session) = tx.session(sid)? {
                if session["lastResponseId"] == id {
                    if kind == "reply.completed" {
                        let mut history =
                            session["lastInput"].as_array().cloned().unwrap_or_default();
                        history.push(json!({"role":"assistant","text":r["output"][0]["content"][0]["text"],"images":[]}));
                        session["history"] = json!(history);
                        session["status"] = json!("idle");
                    } else {
                        session["status"] = json!("uncertain")
                    }
                    tx.put_session(&session)?;
                }
            }
        }
    }
    Ok(r)
}
