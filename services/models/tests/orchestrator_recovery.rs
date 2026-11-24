use neo_models::{
    orchestrator::{parse_envelope, HandoffVerifier, Notifier, NotifyOutcome, Orchestrator},
    orchestrator_client::ModelClient,
    store::{self, Store},
    Result,
};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
struct Offline;
impl ModelClient for Offline {
    fn run(
        &self,
        _: Value,
        _: &str,
        _: Vec<PathBuf>,
        _: &mut dyn FnMut(&str) -> Result<()>,
    ) -> Result<Value> {
        Err("fixture transport disconnected".into())
    }
}
struct Verified;
impl HandoffVerifier for Verified {
    fn verify(&self, _: &str, _: &Value) -> Result<()> {
        Ok(())
    }
}
struct Notice(Mutex<Vec<Value>>);
impl Notifier for Notice {
    fn send(&self, _: &str, payload: &Value) -> Result<NotifyOutcome> {
        self.0.lock().unwrap().push(payload.clone());
        Ok(NotifyOutcome::Accepted("fixture_notification".into()))
    }
}
const PREV: &str = "fixture_thread_123";
const NEXT: &str = "fixture_thread_456";
const PROJECT: &str = "g-p-fixtureproject";
fn fixture() -> (tempfile::TempDir, Store, PathBuf) {
    let d = tempfile::tempdir().unwrap();
    let store = Store::open(d.path().to_path_buf()).unwrap();
    let state = d.path().join("orchestrator/state.json");
    store::write(
        &d.path().join("orchestrator/bootstrap-head.json"),
        &json!({"projectId":PROJECT,"threadId":PREV}),
    )
    .unwrap();
    (d, store, state)
}
fn control() -> Value {
    json!({"action":"replace-thread-id","previousThreadId":PREV,"nextThreadId":NEXT,"expectedGeneration":0,"handoffReceipt":"fixture_receipt_1234"})
}
#[test]
fn uncertain_fifo_survives_restart_and_never_resends() {
    let (_d, store, path) = fixture();
    let o = Orchestrator::open(store.clone(), Arc::new(Offline), None, None).unwrap();
    o.submit(&json!({"requestId":"first_request","text":"first"}))
        .unwrap();
    o.submit(&json!({"requestId":"second_request","text":"second"}))
        .unwrap();
    assert!(o.process_one().unwrap());
    assert!(!o.process_one().unwrap());
    drop(o);
    let fresh = Orchestrator::open(store, Arc::new(Offline), None, None).unwrap();
    assert!(!fresh.process_one().unwrap());
    assert_eq!(fresh.health()["uncertain"], 1);
    assert_eq!(fresh.health()["queued"], 1);
    let s = store::read(&path).unwrap().unwrap();
    assert_eq!(s["requests"]["first_request"]["status"], "uncertain");
}
#[test]
fn verified_cas_and_crash_repair() {
    let (_d, store, path) = fixture();
    let o = Orchestrator::open(store.clone(), Arc::new(Offline), None, None).unwrap();
    assert!(o.replace_thread(&control()).is_err());
    drop(o);
    let mut s = store::read(&path).unwrap().unwrap();
    let owner = s["codexThreadId"].as_str().unwrap().to_owned();
    s["pendingHandoff"] = control();
    store::write(&path, &s).unwrap();
    // Simulate crash immediately after durable Models mapping CAS.
    store
        .transaction()
        .unwrap()
        .cas_orchestrator(&owner, PROJECT, PREV, NEXT, 0)
        .unwrap();
    let o = Orchestrator::open(
        store.clone(),
        Arc::new(Offline),
        Some(Arc::new(Verified)),
        None,
    )
    .unwrap();
    assert_eq!(o.health()["ready"], true);
    assert_eq!(o.replace_thread(&control()).unwrap(), 1);
    let s = store::read(&path).unwrap().unwrap();
    assert_eq!(s["threadId"], NEXT);
    assert_eq!(s["generation"], 1);
    assert!(s.get("pendingHandoff").is_none());
    assert_eq!(s["codexThreadId"], owner);
}
#[test]
fn ack_retains_attention_notification_until_delivery() {
    let (_d, store, path) = fixture();
    let o = Orchestrator::open(store.clone(), Arc::new(Offline), None, None).unwrap();
    o.submit(&json!({"requestId":"attention_request","text":"private text"}))
        .unwrap();
    drop(o);
    let mut s = store::read(&path).unwrap().unwrap();
    let r = &mut s["requests"]["attention_request"];
    let delivery = r["deliveryId"].as_str().unwrap().to_owned();
    r["status"] = json!("completed");
    r["message"] = json!({"text":"attention","level":"attention","needs":"phone","jobId":null});
    r["notification"] = json!({"status":"pending","attempts":0,"nextAttemptAt":0,"payload":{"kind":"blocked","title":"Orchestrator report","body":"attention"}});
    store::write(&path, &s).unwrap();
    let notifier = Arc::new(Notice(Mutex::new(vec![])));
    let o = Orchestrator::open(store, Arc::new(Offline), None, Some(notifier.clone())).unwrap();
    o.ack(&delivery).unwrap();
    assert!(o.flush_one().unwrap());
    assert!(!o.flush_one().unwrap());
    assert_eq!(notifier.0.lock().unwrap().len(), 1);
    let s = store::read(&path).unwrap().unwrap();
    let r = &s["requests"]["attention_request"];
    assert!(r.get("text").is_none() && r.get("message").is_none());
    assert_eq!(r["notification"]["status"], "delivered");
}
#[test]
fn invalid_envelope_rejected() {
    assert!(parse_envelope(r#"{"schema":"neo.orchestrator.reply.v1","message":{"text":"bad","level":"info","needs":"arbitrary"}}"#).is_err());
    assert!(parse_envelope(r#"{"schema":"neo.orchestrator.reply.v1","message":{"text":"bad","level":"info","extra":true}}"#).is_err());
    assert!(parse_envelope(
        &json!({"schema":"neo.orchestrator.reply.v1","control":control()}).to_string()
    )
    .is_ok());
}
