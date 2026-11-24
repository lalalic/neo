mod contracts;
use neo_harness_cli::escalation_ledger as ledger;
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::{symlink, PermissionsExt};
use std::{
    fs,
    path::{Path, PathBuf},
};
const TIME: &str = "2026-11-23T12:00:00.000Z";
const LATER: &str = "2026-11-23T12:02:00.000Z";
const ATTEMPT: &str = "11111111-1111-1111-1111-111111111111";
const SECOND: &str = "22222222-2222-2222-2222-222222222222";
const HANDOFF:&str="Goal: Verify local fixture\nBlocker: missing test marker\nProgress: setup complete\nAcceptance: marker verified\n";
struct Fixture {
    _tmp: tempfile::TempDir,
    dir: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("challenges");
        Self { _tmp: tmp, dir }
    }
    fn begin(&self, handoff: &str, attempt: &str) -> ledger::Token {
        ledger::begin(
            handoff,
            Path::new("/tmp/project"),
            Some("job/example/task/repair"),
            &self.dir,
            TIME,
            attempt,
        )
        .unwrap()
    }
    fn file(&self, t: &ledger::Token, suffix: &str) -> PathBuf {
        self.dir.join(&t.challenge_id).join(suffix)
    }
    fn json(path: &Path) -> Value {
        serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
    }
    fn expected(&self, scenario: &str) -> Value {
        contracts::expected("ledger", &json!(scenario))
    }
}
#[test]
fn native_immutable_challenge_and_initial_attempt_match_frozen_contract() {
    let a = Fixture::new();
    let b = Fixture::new();
    let token = a.begin(HANDOFF, ATTEMPT);
    let reference = b.expected("initial");
    assert_eq!(token.challenge_id, reference["id"]);
    assert_eq!(
        Fixture::json(&a.file(&token, "challenge.json")),
        reference["challenge"]
    );
    assert_eq!(
        Fixture::json(&a.file(&token, &format!("{ATTEMPT}.started.json"))),
        reference["started"]
    );
    #[cfg(unix)]
    {
        assert_eq!(
            fs::metadata(&a.dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(a.file(&token, "challenge.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}
#[test]
fn native_checkpoint_and_success_finish_match_contract_and_remove_stale_checkpoint() {
    let a = Fixture::new();
    let b = Fixture::new();
    let token = a.begin(HANDOFF, ATTEMPT);
    let checkpoint =
        ledger::checkpoint(&token, "agent_execution", "2026-11-23T12:01:00.000Z").unwrap();
    let result = json!({"status":"resolved","summary":"verified","reason":"evidence observed","evidence":["marker present"]});
    let finished = ledger::finish(
        &token,
        &result,
        "agent_execution",
        None,
        LATER,
        Some(&json!({"tools":["shell"],"calls":1,"failures":0})),
        None,
    )
    .unwrap();
    let reference = b.expected("finished");
    assert_eq!(checkpoint, reference["checkpoint"]);
    assert_eq!(finished, reference["finished"]);
    assert!(!a
        .file(&token, &format!("{ATTEMPT}.checkpoint.json"))
        .exists());
    assert!(ledger::checkpoint(&token, "model_inference", LATER).is_err());
    assert!(ledger::finish(&token, &result, "completed", None, LATER, None, None).is_err());
}
#[test]
fn native_needs_user_finish_and_notification_match_contract() {
    let a = Fixture::new();
    let b = Fixture::new();
    let token = a.begin(HANDOFF, ATTEMPT);
    ledger::checkpoint(&token, "agent_execution", "2026-11-23T12:01:00.000Z").unwrap();
    let value = json!({"status":"needs_user","summary":"verification requires owner","user_action":"Tap approve",
  "notification":{"attempted":true,"delivered":true,"channel":"wechat-bro","details":"test"},"evidence":[]});
    let finished = ledger::finish(
        &token,
        &value,
        "agent_execution",
        None,
        LATER,
        Some(&json!({"tools":["shell"],"calls":1,"failures":0})),
        None,
    )
    .unwrap();
    let reference = b.expected("needs_user");
    assert_eq!(finished, reference["finished"]);
}
#[test]
fn retry_reuses_stable_challenge_and_retains_original_handoff() {
    let a = Fixture::new();
    let b = Fixture::new();
    let token = a.begin(HANDOFF, ATTEMPT);
    let original = fs::read(a.file(&token, "challenge.json")).unwrap();
    let retry = ledger::begin(
        "Goal: Retry after missing marker\n",
        Path::new("/tmp/project"),
        Some("job/example/task/repair"),
        &a.dir,
        TIME,
        SECOND,
    )
    .unwrap();
    assert_eq!(token.challenge_id, retry.challenge_id);
    assert_eq!(
        original,
        fs::read(a.file(&token, "challenge.json")).unwrap()
    );
    let reference = b.expected("retry");
    assert_eq!(
        Fixture::json(&a.file(&retry, &format!("{SECOND}.started.json"))),
        reference["retry"]
    );
    assert_eq!(
        Fixture::json(&a.file(&token, "challenge.json")),
        reference["challengeAfter"]
    );
}
#[test]
fn invalid_input_and_duplicate_attempt_fail_without_overwriting_evidence() {
    let f = Fixture::new();
    assert!(ledger::begin("   ", Path::new("/tmp"), None, &f.dir, TIME, ATTEMPT).is_err());
    assert!(!f.dir.exists());
    assert!(ledger::begin(
        HANDOFF,
        Path::new("/tmp"),
        Some("../../unsafe"),
        &f.dir,
        TIME,
        ATTEMPT
    )
    .is_err());
    assert!(!f.dir.exists());
    assert!(ledger::begin(HANDOFF, Path::new("/tmp"), None, &f.dir, TIME, "not-a-uuid").is_err());
    assert!(!f.dir.exists());
    let token = f.begin(HANDOFF, ATTEMPT);
    let original = fs::read(f.file(&token, &format!("{ATTEMPT}.started.json"))).unwrap();
    assert!(ledger::begin(
        HANDOFF,
        Path::new("/tmp/project"),
        Some("job/example/task/repair"),
        &f.dir,
        TIME,
        ATTEMPT
    )
    .is_err());
    assert_eq!(
        original,
        fs::read(f.file(&token, &format!("{ATTEMPT}.started.json"))).unwrap()
    );
    assert!(ledger::checkpoint(&token, "not-a-stage", TIME).is_err());
    assert!(ledger::finish(
        &token,
        &json!({"status":"UNKNOWN"}),
        "completed",
        None,
        TIME,
        None,
        None
    )
    .is_err());
}
#[cfg(unix)]
#[test]
fn ledger_rejects_public_and_symlink_roots_before_writes() {
    let f = Fixture::new();
    fs::create_dir(&f.dir).unwrap();
    fs::set_permissions(&f.dir, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(ledger::begin(HANDOFF, Path::new("/tmp"), None, &f.dir, TIME, ATTEMPT).is_err());
    let unsafe_link = f._tmp.path().join("symlinked");
    symlink(&f.dir, &unsafe_link).unwrap();
    assert!(ledger::begin(
        HANDOFF,
        Path::new("/tmp"),
        None,
        &unsafe_link,
        TIME,
        ATTEMPT
    )
    .is_err());
}

#[test]
fn mutated_challenge_identity_prevents_retry_without_creating_another_attempt() {
    let f = Fixture::new();
    let token = f.begin(HANDOFF, ATTEMPT);
    let original = f.file(&token, "challenge.json");
    let mut saved = Fixture::json(&original);
    saved["id"] = json!("a".repeat(64));
    fs::write(&original, serde_json::to_vec_pretty(&saved).unwrap()).unwrap();
    let next = ledger::begin(
        HANDOFF,
        Path::new("/tmp/project"),
        Some("job/example/task/repair"),
        &f.dir,
        LATER,
        SECOND,
    );
    assert!(next.is_err());
    assert!(!f.file(&token, &format!("{SECOND}.started.json")).exists());
}
#[cfg(unix)]
#[test]
fn started_event_symlink_and_identity_tampering_prevent_checkpoint_and_finish() {
    let f = Fixture::new();
    let token = f.begin(HANDOFF, ATTEMPT);
    let event = f.file(&token, &format!("{ATTEMPT}.started.json"));
    let mut modified = Fixture::json(&event);
    modified["attempt_id"] = json!(SECOND);
    fs::write(&event, serde_json::to_vec_pretty(&modified).unwrap()).unwrap();
    assert!(ledger::checkpoint(&token, "agent_execution", LATER).is_err());
    assert!(ledger::finish(
        &token,
        &json!({"status":"failed"}),
        "completed",
        None,
        LATER,
        None,
        None
    )
    .is_err());
    let original = f._tmp.path().join("event-copy.json");
    fs::rename(&event, &original).unwrap();
    symlink(&original, &event).unwrap();
    assert!(ledger::checkpoint(&token, "agent_execution", LATER).is_err());
    assert!(!f.file(&token, &format!("{ATTEMPT}.finished.json")).exists());
}

#[test]
fn native_runtime_failure_codes_and_phase_match_frozen_contract() {
    for (scenario, message) in [
        ("failed_error", "Local inference HTTP 500"),
        ("failed_lock", "Exclusive model slot lock timeout"),
    ] {
        let a = Fixture::new();
        let b = Fixture::new();
        let token = a.begin(HANDOFF, ATTEMPT);
        let native = ledger::finish(
            &token,
            &json!({}),
            "model_inference",
            Some(message),
            LATER,
            None,
            None,
        )
        .unwrap();
        let reference = b.expected(scenario);
        assert_eq!(
            native, reference["finished"],
            "failure classification mismatch: {scenario}"
        );
        assert_eq!(native["outcome"], "failed");
    }
}
