use crate::{
    key, now_ms,
    store::{response_id, Store},
    Result,
};
use serde_json::{json, Value};

/// Validate exact channel/source/subject and apply one durable journal update.
/// Text is never a terminal event. Unknown response IDs are ignored.
pub fn apply(store: &Store, subject: &str, prefix: &str, event: &Value) -> Result<Value> {
    let source = event["source"]["id"]
        .as_str()
        .ok_or("invalid reply source")?;
    let id = source
        .strip_prefix("reply/models/")
        .filter(|s| response_id(s))
        .ok_or("invalid model reply channel or response_id")?;
    if subject != format!("{prefix}.models.{id}") {
        return Err("reply subject mismatch".into());
    }
    let kind = event["type"].as_str().ok_or("invalid reply type")?;
    let data = event["data"]
        .as_object()
        .ok_or("reply data must be object")?;
    let keys: &[&str] = match kind {
        "reply.text" => &["text", "seq"],
        "reply.failed" => &["error"],
        "reply.completed" | "reply.heartbeat" => &[],
        _ => return Err("unsupported reply type".into()),
    };
    if data.keys().any(|k| !keys.contains(&k.as_str())) {
        return Err("unsupported reply data field".into());
    }
    let text = if kind == "reply.text" {
        Some(
            event["data"]["text"]
                .as_str()
                .filter(|s| !s.trim().is_empty() && s.encode_utf16().count() <= 100_000)
                .ok_or("reply.text needs bounded text")?,
        )
    } else {
        None
    };
    let seq = if text.is_some() {
        Some(
            event["data"]["seq"]
                .as_u64()
                .filter(|n| *n > 0 && *n <= 9_007_199_254_740_991)
                .ok_or("invalid reply sequence")?,
        )
    } else {
        None
    };
    let error = if kind == "reply.failed" {
        Some(
            event["data"]["error"]
                .as_str()
                .filter(|s| !s.trim().is_empty() && s.encode_utf16().count() <= 1000)
                .ok_or("actual failure reason required")?,
        )
    } else {
        None
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
