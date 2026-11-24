use serde_json::{json, Value};
pub fn public(r: &Value) -> Value {
    let mut p = r.clone();
    if let Some(m) = p.as_object_mut() {
        for k in [
            "sessionId",
            "reports",
            "last_activity_at",
            "heartbeat_count",
        ] {
            m.remove(k);
        }
    }
    p
}
#[derive(Default)]
pub struct Writer {
    seq: u64,
    sent: usize,
    started: bool,
    item: bool,
    pub terminal: bool,
}
impl Writer {
    fn emit(&mut self, out: &mut String, kind: &str, mut fields: Value) {
        fields["type"] = json!(kind);
        fields["sequence_number"] = json!(self.seq);
        self.seq += 1;
        out.push_str(&format!("event: {kind}\ndata: {fields}\n\n"));
    }
    pub fn update(&mut self, r: &Value) -> String {
        let mut out = String::new();
        if self.terminal {
            return out;
        }
        let p = public(r);
        if !self.started {
            let mut start = p.clone();
            start["status"] = json!("in_progress");
            start["output"] = json!([]);
            self.emit(&mut out, "response.created", json!({"response":start}));
            self.emit(&mut out, "response.in_progress", json!({"response":start}));
            self.started = true;
        }
        let item = &p["output"][0];
        let id = &item["id"];
        if !item.is_null() && !self.item {
            self.emit(&mut out,"response.output_item.added",json!({"output_index":0,"item":{"id":id,"type":"message","status":"in_progress","role":"assistant","content":[]}}));
            self.emit(&mut out,"response.content_part.added",json!({"output_index":0,"content_index":0,"item_id":id,"part":{"type":"output_text","text":"","annotations":[]}}));
            self.item = true;
        }
        let reports = r["reports"].as_array().cloned().unwrap_or_else(|| {
            if item.is_null() {
                vec![]
            } else {
                vec![item["content"][0]["text"].clone()]
            }
        });
        for (i, chunk) in reports.iter().enumerate().skip(self.sent) {
            let delta = format!(
                "{}{}",
                if i > 0 { "\n" } else { "" },
                chunk.as_str().unwrap_or("")
            );
            self.emit(
                &mut out,
                "response.output_text.delta",
                json!({"output_index":0,"content_index":0,"item_id":id,"delta":delta}),
            );
            self.sent = i + 1;
        }
        if r["status"] == "completed" {
            if !item.is_null() {
                self.emit(&mut out,"response.output_text.done",json!({"output_index":0,"content_index":0,"item_id":id,"text":item["content"][0]["text"]}));
                self.emit(&mut out,"response.content_part.done",json!({"output_index":0,"content_index":0,"item_id":id,"part":item["content"][0]}));
                self.emit(
                    &mut out,
                    "response.output_item.done",
                    json!({"output_index":0,"item":item}),
                );
            }
            self.emit(&mut out, "response.completed", json!({"response":p}));
            self.terminal = true;
        } else if r["status"] == "failed" {
            self.emit(&mut out, "response.failed", json!({"response":p}));
            self.terminal = true;
        }
        out
    }
    pub fn fail(&mut self, id: &str, error: &str) -> String {
        let mut out = String::new();
        if !self.terminal {
            self.emit(&mut out,"response.failed",json!({"response":{"id":id,"object":"response","status":"failed","error":{"type":"transport_error","message":error}}}));
            self.terminal = true;
        }
        out
    }
}
