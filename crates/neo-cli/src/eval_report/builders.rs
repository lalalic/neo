//! Select the report builder by the recorded execution harness, not the model,
//! role, presence of a thread ID, or today's Agent configuration.
use super::trace::{self, s};
use serde_json::{json, Value};
use std::path::Path;

fn nonempty(v: &Value) -> Option<&str> {
    v.as_str().filter(|s| !s.is_empty())
}

fn recorded_adapter(v: &Value) -> Option<&str> {
    let selected = nonempty(&v["workerSelection"]["adapter"]);
    let adapter = nonempty(&v["adapter"]);
    // A selected worker is stronger evidence than the requested adapter.
    // The request may be "auto" or refer to a different proposed worker.
    selected.or(adapter)
}

fn attempt_adapter<'a>(
    task: &'a Value,
    history: &'a Value,
    last: bool,
) -> (Option<&'a str>, &'static str) {
    if let Some(a) = recorded_adapter(history) {
        return (Some(a), "execution history");
    }
    if last {
        if let Some(a) = recorded_adapter(task) {
            return (Some(a), "latest Task worker binding");
        }
    }
    (None, "no attempt-specific harness recorded")
}

pub(super) fn build(
    task: &Value,
    history: &Value,
    last: bool,
    thread: Option<&str>,
    binding: &str,
    home: &Path,
) -> Value {
    let (adapter, provenance) = attempt_adapter(task, history, last);
    let (builder, mut report) = match adapter {
        Some("codex") => (
            "codex-jsonl",
            match thread {
                Some(thread) => match trace::locate(home, thread)
                    .and_then(|p| trace::analyze(&p, thread, binding))
                {
                    Ok(a) => a,
                    Err(e) => json!({"toolCoverage":"UNKNOWN","reason":e,"thread":thread}),
                },
                None => {
                    json!({"toolCoverage":"UNKNOWN","reason":"Codex execution has no recorded thread ID"})
                }
            },
        ),
        Some("script") => (
            "script",
            // Native Script Worker currently persists correlated lifecycle and
            // validated result, not a raw per-call JSONL transcript. Do not
            // substitute Relay events for observed script behavior.
            json!({"toolCoverage":"UNKNOWN","reason":"No execution-bound raw script trace is exposed by Relay; see recorded lifecycle and artifact proof","scriptTraceAvailable":false}),
        ),
        Some("xchat" | "webchatgpt" | "chatgpt" | "claude") => (
            "unsupported-harness",
            json!({"toolCoverage":"UNKNOWN","reason":"No verified raw-trace builder implemented for this harness"}),
        ),
        _ => (
            "unknown-harness",
            json!({"toolCoverage":"UNKNOWN","reason":"No supported execution-specific harness identity"}),
        ),
    };
    report["reportBuilder"] = json!(builder);
    report["harness"] = json!(adapter);
    report["harnessProvenance"] = json!(provenance);
    report
}

pub(super) fn task_kind(task: &Value, attempts: &[Value]) -> &'static str {
    if attempts.is_empty()
        && (task["agentGraph"].is_object() || nonempty(&task["agentGraph"]).is_some())
        && s(task, "agentName").is_empty()
    {
        "dag-coordinator"
    } else if attempts.is_empty() {
        "no-recorded-execution"
    } else {
        "attempt-reports"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn actual_adapter_not_thread_or_provider() {
        let t = json!({"adapter":"codex","workerSelection":{"adapter":"script"},"routing":{"provider":"neo-local"}});
        let r = build(
            &t,
            &json!({}),
            true,
            Some("not-a-thread"),
            "binding",
            Path::new("/nonexistent"),
        );
        assert_eq!(r["reportBuilder"], "script");
        assert_eq!(r["toolCoverage"], "UNKNOWN");
        let h = json!({"adapter":"codex"});
        let r = build(&t, &h, false, None, "binding", Path::new("/nonexistent"));
        assert_eq!(r["reportBuilder"], "codex-jsonl");
        assert_eq!(r["harnessProvenance"], "execution history");
    }
    #[test]
    fn earlier_unknown_and_future_harness_never_fallback_to_codex() {
        let t = json!({"adapter":"codex"});
        let r = build(
            &t,
            &json!({}),
            false,
            Some("thread"),
            "binding",
            Path::new("/nonexistent"),
        );
        assert_eq!(r["reportBuilder"], "unknown-harness");
        let r = build(
            &t,
            &json!({"adapter":"claude"}),
            false,
            Some("thread"),
            "binding",
            Path::new("/nonexistent"),
        );
        assert_eq!(r["reportBuilder"], "unsupported-harness");
        assert_eq!(r["harness"], "claude");
    }
    #[test]
    fn coordinator_not_a_codex_worker() {
        assert_eq!(
            task_kind(&json!({"adapter":"codex","agentGraph":"flowchart TD"}), &[]),
            "dag-coordinator"
        );
    }
}
