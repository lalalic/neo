mod contracts;
use neo_harness_cli::escalation_experience as experience;
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::{symlink, PermissionsExt};
use std::{fs, path::PathBuf};
struct Fixture {
    _temp: tempfile::TempDir,
    cases: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let cases = temp.path().join("private-cases");
        Self { _temp: temp, cases }
    }
    fn candidate() -> Value {
        json!({"scenario_key":"apple_developer.login_challenge","category":"authentication",
    "symptom":"Apple Developer sign-in stuck after interactive verification request",
    "strategy_key":"resume_existing_verified_session",
    "steps":["Inspect the existing authorized sign-in session",
       "Use an available approved verification route and resume the original task"],
    "verification":"Confirm Apple Developer portal is authenticated and expected account is visible",
    "failure_reason":"","lesson":"Keep the initial session alive while completing the verification step"})
    }
    fn make(&self, candidate: &Value) -> Value {
        experience::prepare_taught(candidate, "llama", "test-model", "2026-11-23T12:00:00.000Z")
            .unwrap()
    }
    fn expected_taught(&self, candidate: &Value) -> Value {
        contracts::expected("taught", candidate)
    }
    fn expected_render(&self, handoff: &str) -> String {
        contracts::expected("taught-render", &json!(handoff))
            .as_str()
            .unwrap()
            .to_string()
    }
}
#[test]
fn native_owner_taught_record_contract_preserves_unverified_truth_and_no_model_training() {
    let f = Fixture::new();
    let candidate = Fixture::candidate();
    let mut native = f.make(&candidate);
    let mut reference = f.expected_taught(&candidate);
    native["captured_at"] = json!("fixed");
    reference["captured_at"] = json!("fixed");
    assert_eq!(native, reference);
    assert_eq!(native["source"], "owner_taught");
    assert_eq!(native["outcome"], "taught");
    assert_eq!(native["owner_confirmed"], true);
    assert_eq!(native["training_reviewed"], false);
}
#[test]
fn owner_taught_save_and_explicit_revision_are_private_and_relevant_to_future_handoff() {
    let f = Fixture::new();
    let first = f.make(&Fixture::candidate());
    let saved = experience::store_taught(&first, &f.cases).unwrap();
    assert_eq!(saved["stored"], true);
    assert_eq!(saved["updated"], false);
    let handoff = "Apple Developer login verification gets stuck";
    let native = experience::render_taught(handoff, &f.cases, 4).unwrap();
    let node = f.expected_render(handoff);
    assert_eq!(native, node);
    assert!(native.contains("Inspect the existing authorized sign-in session"));
    assert_eq!(
        experience::render_taught("Unrelated video editing timeline", &f.cases, 4).unwrap(),
        ""
    );
    let mut revised = Fixture::candidate();
    revised["lesson"] = json!("Do not close the waiting browser or CLI");
    let newer = f.make(&revised);
    assert_eq!(newer["id"], first["id"]);
    let response = experience::store_taught(&newer, &f.cases).unwrap();
    assert_eq!(response["updated"], true);
    assert_eq!(fs::read_dir(&f.cases).unwrap().count(), 1);
    assert!(fs::read_to_string(
        f.cases
            .join(format!("{}.json", first["id"].as_str().unwrap()))
    )
    .unwrap()
    .contains("Do not close the waiting browser"));
    #[cfg(unix)]
    {
        assert_eq!(
            fs::metadata(&f.cases).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(
                f.cases
                    .join(format!("{}.json", first["id"].as_str().unwrap()))
            )
            .unwrap()
            .permissions()
            .mode()
                & 0o777,
            0o600
        );
    }
}
#[test]
fn native_owner_taught_content_masks_urls_passwords_private_paths_and_otp() {
    let f = Fixture::new();
    let mut candidate = Fixture::candidate();
    candidate["steps"] = json!([
        "Visit https://example.test/path?token=abc and use secret=superprivate",
        "Open /Users/alice/private/credentials.txt after OTP 123456"
    ]);
    candidate["lesson"] = json!("token=abcd12345 was only for local testing");
    let native = f.make(&candidate);
    let text = native.to_string();
    for secret in [
        "example.test",
        "superprivate",
        "/Users/alice",
        "123456",
        "abcd12345",
    ] {
        assert!(
            !text.contains(secret),
            "unredacted taught summary: {secret}"
        );
    }
    let mut reference = f.expected_taught(&candidate);
    let mut ours = native;
    reference["captured_at"] = json!("fixed");
    ours["captured_at"] = json!("fixed");
    assert_eq!(ours, reference);
}
#[test]
fn native_owner_taught_rejects_unsafe_keys_raw_events_and_evidence_overwrite() {
    let f = Fixture::new();
    for bad in [
        json!({"steps":[]}),
        json!({"scenario_key":"alice@example.com"}),
    ] {
        let mut candidate = Fixture::candidate();
        for (key, value) in bad.as_object().unwrap() {
            candidate[key] = value.clone();
        }
        assert!(experience::prepare_taught(
            &candidate,
            "llama",
            "test-model",
            "2026-11-23T12:00:00.000Z"
        )
        .is_err());
    }
    let good = f.make(&Fixture::candidate());
    let mut unsafe_record = good.clone();
    unsafe_record["handoff"] = json!("Full private chat transcript");
    assert!(experience::store_taught(&unsafe_record, &f.cases).is_err());
    let mut unsafe_record = good.clone();
    unsafe_record["strategy"]["steps"][0] = json!("password: syntheticS3cret");
    assert!(experience::store_taught(&unsafe_record, &f.cases).is_err());
    fs::create_dir_all(&f.cases).unwrap();
    #[cfg(unix)]
    fs::set_permissions(&f.cases, fs::Permissions::from_mode(0o700)).unwrap();
    let location = f
        .cases
        .join(format!("{}.json", good["id"].as_str().unwrap()));
    fs::write(
        &location,
        json!({"source":"agent","outcome":"resolved"}).to_string(),
    )
    .unwrap();
    let rejected = experience::store_taught(&good, &f.cases);
    assert!(rejected.is_err());
    assert!(fs::read_to_string(location).unwrap().contains("resolved"));
}
#[cfg(unix)]
#[test]
fn native_taught_storage_rejects_external_symlink_directory_and_file() {
    let f = Fixture::new();
    let record = f.make(&Fixture::candidate());
    let external = f._temp.path().join("outside");
    fs::create_dir(&external).unwrap();
    fs::set_permissions(&external, fs::Permissions::from_mode(0o700)).unwrap();
    symlink(&external, &f.cases).unwrap();
    assert!(experience::store_taught(&record, &f.cases).is_err());
    assert!(experience::render_taught("Apple Developer login verification", &f.cases, 4).is_err());
}

#[test]
fn owner_taught_recovery_context_is_lower_trust_user_content_and_cannot_forge_success() {
    use neo_harness_cli::{
        escalation_contract::{Config, Request},
        escalation_stateless,
    };
    use std::path::PathBuf;
    let f = Fixture::new();
    let lesson = f.make(&Fixture::candidate());
    experience::store_taught(&lesson, &f.cases).unwrap();
    let notes =
        experience::render_taught("Apple Developer login verification gets stuck", &f.cases, 4)
            .unwrap();
    assert!(notes.contains("Inspect the existing authorized sign-in session"));
    let req = Request {
        handoff: "Apple Developer login verification gets stuck".into(),
        on_needs_user: "Owner must approve human-only steps".into(),
        cwd: PathBuf::from("/tmp"),
        correlation_id: None,
    };
    let config = Config {
        engine: "external".into(),
        model: "test".into(),
        context: 65536,
        budget_seconds: 15,
        max_turns: 2,
        startup_ms: 1000,
        server_command: "none".into(),
        base_url: Some("http://127.0.0.1:11199/v1".into()),
    };
    let mut inspected = false;
    let response = escalation_stateless::run_with_guidance(
        "http://127.0.0.1:11199/v1",
        escalation_stateless::ModelGuidance {
            rules: "Authoritative system rules require real tool evidence",
            taught: &notes,
        },
        &req,
        &config,
        |query| {
            inspected = true;
            let messages = query["messages"].as_array().unwrap();
            assert_eq!(messages[0]["role"], "system");
            assert!(!messages[0]["content"]
                .as_str()
                .unwrap()
                .contains("Inspect the existing"));
            assert_eq!(messages[1]["role"], "user");
            let user = messages[1]["content"].as_str().unwrap();
            assert!(user.contains("untrusted suggestions"));
            assert!(user.contains("Inspect the existing authorized sign-in session"));
            assert!(user.contains("Owner must approve human-only steps"));
            Ok(json!({"choices":[{"message":{"content":
               "{\"status\":\"resolved\",\"summary\":\"I already know how to solve this\",\"evidence\":[\"the saved lesson\"]}"}}]}))
        },
        |_, _, _| panic!("the mock model must not obtain tools"),
        |_, _| panic!("the mock model must not report tools"),
    );
    assert!(inspected);
    assert!(response
        .unwrap_err()
        .contains("without a successful tool result"));
}
