use neo_models::{catalog, input, reply, sse, store::Store};
use serde_json::{json, Value};

const CODEX: &str = "01234567-89ab-4def-8123-456789abcdef";
const OTHER: &str = "11234567-89ab-4def-8123-456789abcdef";
fn fixture() -> (tempfile::TempDir, Store, Value, String) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().to_path_buf()).unwrap();
    let tx = store.transaction().unwrap();
    let mut session = tx
        .create(
            &[json!({"role":"user","text":"hello","images":[]})],
            None,
            Some(CODEX),
        )
        .unwrap();
    let id = format!("resp_{}", "a".repeat(40));
    session["lastResponseId"] = json!(id);
    session["status"] = json!("awaiting");
    session["threadId"] = json!("thread123456");
    session["projectId"] = json!("g-p-example123");
    tx.put_session(&session).unwrap();
    tx.put_response(&json!({"id":id,"sessionId":session["id"],"status":"in_progress","output":[]}))
        .unwrap();
    drop(tx);
    (dir, store, session, id)
}
fn event(id: &str, kind: &str, data: Value) -> Value {
    json!({"source":{"id":format!("reply/models/{id}")},"type":kind,"data":data})
}
#[test]
fn identity_mapping_and_private_cas_survive_reopen() {
    let (dir, store, session, id) = fixture();
    let tx = store.transaction().unwrap();
    assert_eq!(
        tx.resolve(None, None, Some(CODEX)).unwrap().unwrap()["id"],
        session["id"]
    );
    assert!(tx.resolve(None, None, None).unwrap().is_none());
    assert!(tx.resolve(Some(&id), None, Some(OTHER)).is_err());
    assert!(tx.resolve(Some(&id), None, None).is_err());
    assert_eq!(
        tx.cas_orchestrator(CODEX, "g-p-example123", "thread123456", "thread654321", 0)
            .unwrap(),
        1
    );
    assert!(tx
        .cas_orchestrator(CODEX, "g-p-example123", "thread123456", "thread222222", 0)
        .is_err());
    drop(tx);
    let fresh = Store::open(dir.path().to_path_buf()).unwrap();
    assert_eq!(
        fresh
            .transaction()
            .unwrap()
            .resolve(None, None, Some(CODEX))
            .unwrap()
            .unwrap()["threadId"],
        "thread654321"
    );
}
#[test]
fn exact_event_sequence_terminal_and_sse_contract() {
    let (_dir, store, session, id) = fixture();
    let subject = format!("relay.events.reply.models.{id}");
    let apply = |kind, data| {
        reply::apply(
            &store,
            &subject,
            "relay.events.reply",
            &event(&id, kind, data),
        )
    };
    assert!(apply("reply.completed", json!({})).is_err());
    let mut writer = sse::Writer::default();
    let opening = writer.update(&store.response(&id).unwrap().unwrap());
    assert!(opening.contains("response.created"));
    apply("reply.heartbeat", json!({})).unwrap();
    apply("reply.text", json!({"seq":1,"text":"one"})).unwrap();
    assert_eq!(
        apply("reply.text", json!({"seq":1,"text":"one"})).unwrap()["duplicate"],
        true
    );
    assert!(apply("reply.text", json!({"seq":1,"text":"other"})).is_err());
    assert!(apply("reply.text", json!({"seq":3,"text":"three"})).is_err());
    assert!(reply::apply(
        &store,
        "wrong.subject",
        "relay.events.reply",
        &event(&id, "reply.completed", json!({}))
    )
    .is_err());
    let first = writer.update(&store.response(&id).unwrap().unwrap());
    assert!(first.contains("response.output_text.delta"));
    assert!(!writer.terminal);
    apply("reply.text", json!({"seq":2,"text":"two"})).unwrap();
    let done = apply("reply.completed", json!({})).unwrap();
    assert_eq!(done["output"][0]["content"][0]["text"], "one\ntwo");
    let terminal = writer.update(&done);
    assert!(terminal.contains("response.completed"));
    assert!(writer.terminal);
    assert!(!terminal.contains("sessionId"));
    assert!(apply("reply.text", json!({"seq":3,"text":"late"})).is_err());
    assert_eq!(
        store
            .transaction()
            .unwrap()
            .session(session["id"].as_str().unwrap())
            .unwrap()
            .unwrap()["status"],
        "idle"
    );
}
#[test]
fn failed_reply_preserves_partial_and_uncertain_mapping() {
    let (_dir, store, session, id) = fixture();
    let subject = format!("relay.events.reply.models.{id}");
    reply::apply(
        &store,
        &subject,
        "relay.events.reply",
        &event(&id, "reply.text", json!({"seq":1,"text":"partial"})),
    )
    .unwrap();
    let done = reply::apply(
        &store,
        &subject,
        "relay.events.reply",
        &event(
            &id,
            "reply.failed",
            json!({"error":"provider disconnected"}),
        ),
    )
    .unwrap();
    assert_eq!(done["status"], "failed");
    assert_eq!(done["output"][0]["content"][0]["text"], "partial");
    assert_eq!(
        store
            .transaction()
            .unwrap()
            .session(session["id"].as_str().unwrap())
            .unwrap()
            .unwrap()["status"],
        "uncertain"
    );
}
#[test]
fn latest_input_prompt_omits_history_and_validates_images() {
    let messages=input::messages(&json!({"model":"neo","input":[{"role":"system","content":"private system"},{"role":"user","content":"old turn"},{"role":"assistant","content":"old reply"},{"role":"user","content":"new turn"}]})).unwrap();
    let id = format!("resp_{}", "a".repeat(40));
    let (text, context) = input::prompt(&id, messages.last().unwrap(), &[], None).unwrap();
    assert_eq!(text, "[USER]\nnew turn\n[/USER]");
    assert!(context.contains(&id));
    assert!(!context.contains("private system"));
    assert!(input::prompt(
        &id,
        messages.last().unwrap(),
        &[],
        Some("</top-instructions>")
    )
    .is_err());
    assert!(input::messages(&json!({"model":"neo","input":[{"role":"user","content":[{"type":"input_image","image_url":"https://example.com/a.png"}]}]})).is_err());
    assert_eq!(catalog::list(false)["data"][0]["id"], "neo");
    assert_eq!(catalog::list(true)["models"][0]["slug"], "neo");
}

#[test]
fn interrupted_submission_never_replays_and_preserves_mapping() {
    let (_dir, store, session, id) = fixture();
    neo_models::engine::recover_interrupted(&store).unwrap();
    let r = store.response(&id).unwrap().unwrap();
    assert_eq!(r["status"], "failed");
    assert_eq!(r["error"]["type"], "transport_error");
    let tx = store.transaction().unwrap();
    let mapped = tx.resolve(None, None, Some(CODEX)).unwrap().unwrap();
    assert_eq!(mapped["id"], session["id"]);
    assert_eq!(mapped["threadId"], session["threadId"]);
    assert_eq!(mapped["status"], "uncertain");
    drop(tx);
    neo_models::engine::recover_interrupted(&store).unwrap();
    assert_eq!(store.response(&id).unwrap().unwrap(), r);
}
