mod contracts;
use neo_harness_cli::escalation_experience as experience;
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::{symlink, PermissionsExt};
use std::{fs, path::PathBuf};
struct Fixture {
    _tmp: tempfile::TempDir,
    dir: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("private-cases");
        Self { _tmp: temp, dir }
    }
    fn agent() -> Value {
        json!({"scenario_key":"oauth.callback_pending","category":"authentication",
    "symptom":"Authorization callback not received","strategy_key":"webhelm.resume_auth",
    "steps":["Check existing managed Chrome tab","Finish authorized consent flow"],
    "verification":"Connection status is healthy","failure_reason":null,
    "lesson":"Keep waiting CLI process alive during consent"})
    }
    fn events() -> Vec<Value> {
        vec![
            json!({"type":"tool_use","name":"terminal","input":{"command":"webhelm status --url https://secret.example/session?token=ABC"}}),
            json!({"type":"tool_result","name":"terminal","is_error":false,"output":"password: syntheticSECRET_77"}),
            json!({"type":"tool_use","name":"terminal","input":{"command":"neo computer-use call list_apps"}}),
            json!({"type":"tool_result","name":"terminal","is_error":true,"output":"local error"}),
        ]
    }
    fn prepare(
        &self,
        result: &Value,
        agent: Option<&Value>,
        events: &[Value],
        error: Option<&str>,
        timestamp: &str,
    ) -> Value {
        experience::prepare(&experience::Input {
            handoff: "OAuth authorization callback appears stuck",
            result,
            experience: agent,
            events,
            backend: "local",
            engine: "llama",
            model: "unsloth/Qwen3.5-4B-GGUF:Q4_K_M",
            capture_method: "executor",
            error_class: error,
            captured_at: timestamp,
        })
        .unwrap()
    }
    fn reference(
        &self,
        result: &Value,
        agent: Option<&Value>,
        events: &[Value],
        error: Option<&str>,
    ) -> Value {
        let payload = json!({"result":result,"experience":agent,"events":events,"error":error});
        contracts::expected("experience", &payload)
    }
}
#[test]
fn native_sanitized_experience_record_matches_contract_fields_and_never_stores_tool_transcripts() {
    let f = Fixture::new();
    let agent = Fixture::agent();
    let events = Fixture::events();
    let result = json!({"status":"resolved"});
    let ref_json = f.reference(&result, Some(&agent), &events, None);
    let native = f.prepare(
        &result,
        Some(&agent),
        &events,
        None,
        ref_json["captured_at"].as_str().unwrap(),
    );
    assert_eq!(native, ref_json);
    let serial = native.to_string();
    for sensitive in [
        "secret.example",
        "syntheticSECRET_77",
        "token=ABC",
        "webhelm status --url",
    ] {
        assert!(
            !serial.contains(sensitive),
            "Experience secret leak: {sensitive}"
        );
    }
    assert_eq!(native["observation"]["calls"], 2);
    assert_eq!(native["observation"]["failures"], 1);
    assert_eq!(
        native["observation"]["tools"],
        json!(["computer-use", "shell", "webhelm"])
    );
    assert_eq!(native["training_reviewed"], false);
}
#[test]
fn invalid_scenario_fallback_and_runtime_failure_are_contract_equivalent() {
    let f = Fixture::new();
    let result = json!({"status":"failed"});
    let events = [];
    let agent = json!({"scenario_key":"oauth.user@example.com","strategy_key":"", "steps":[]});
    let node = f.reference(&result, Some(&agent), &events, Some("Error"));
    let native = f.prepare(
        &result,
        Some(&agent),
        &events,
        Some("Error"),
        node["captured_at"].as_str().unwrap(),
    );
    assert_eq!(native, node);
    assert_eq!(native["source"], "fallback");
    assert_eq!(native["strategy"]["key"], "runtime.error");
    assert!(native["scenario"]["key"]
        .as_str()
        .unwrap()
        .starts_with("unclassified."));
    assert!(!native
        .to_string()
        .contains("OAuth authorization callback appears stuck"));
}
#[test]
fn credential_path_ip_otp_and_long_id_sanitizer_matches_contract() {
    let sensitive="token=abcd1234 sk-abcdef1234567890 Bearer abc.def.ghi email alice@example.com link https://site.test/auth?key=xyz path /Users/alice/private/token.txt 192.168.1.5 OTP 123456";
    let reference = contracts::expected("sanitize", &json!(sensitive));
    assert_eq!(
        experience::sanitize(sensitive, 500),
        reference["text"].as_str().unwrap()
    );
    assert_eq!(
        experience::category_key("OAuth Callback Pending", "unknown"),
        reference["category"]
    );
    for secret in [
        "abcd1234",
        "abcdef1234567890",
        "alice@example.com",
        "site.test",
        "/Users/alice",
        "192.168.1.5",
    ] {
        assert!(!reference["text"].as_str().unwrap().contains(secret));
    }
}
#[test]
fn native_atomic_dedupe_is_private_and_stores_one_record_for_parallel_writers() {
    let f = Fixture::new();
    let agent = Fixture::agent();
    let events = [];
    let result = json!({"status":"resolved"});
    let prepared = f.prepare(
        &result,
        Some(&agent),
        &events,
        None,
        "2026-11-23T12:00:00.000Z",
    );
    let rows = std::thread::scope(|scope| {
        (0..12)
            .map(|_| {
                let record = prepared.clone();
                let dir = f.dir.clone();
                scope.spawn(move || experience::store(&record, &dir).unwrap())
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert_eq!(rows.iter().filter(|r| r["stored"] == true).count(), 1);
    assert_eq!(rows.iter().filter(|r| r["duplicate"] == true).count(), 11);
    let json_file = f
        .dir
        .join(format!("{}.json", prepared["id"].as_str().unwrap()));
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(&json_file).unwrap()).unwrap(),
        prepared
    );
    #[cfg(unix)]
    {
        assert_eq!(
            fs::metadata(&f.dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(json_file).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
#[test]
fn experience_outcomes_have_distinct_ids_and_invalid_values_are_rejected() {
    let f = Fixture::new();
    let agent = Fixture::agent();
    let cases = ["resolved", "failed", "needs_user"]
        .iter()
        .map(|status| {
            f.prepare(
                &json!({"status":status}),
                Some(&agent),
                &[],
                None,
                "2026-11-23T12:00:00.000Z",
            )
        })
        .collect::<Vec<_>>();
    let ids = cases
        .iter()
        .map(|r| r["id"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert!(ids[0] != ids[1] && ids[0] != ids[2] && ids[1] != ids[2]);
    for row in cases {
        assert_eq!(experience::store(&row, &f.dir).unwrap()["stored"], true);
    }
    let bad = json!({"status":"fabricated"});
    assert!(experience::prepare(&experience::Input {
        handoff: "bad",
        result: &bad,
        experience: None,
        events: &[],
        backend: "local",
        engine: "llama",
        model: "unknown",
        capture_method: "executor",
        error_class: None,
        captured_at: "now"
    })
    .is_err());
}
#[cfg(unix)]
#[test]
fn private_experience_store_rejects_public_and_symlinked_output_dirs() {
    let f = Fixture::new();
    let agent = Fixture::agent();
    let record = f.prepare(
        &json!({"status":"failed"}),
        Some(&agent),
        &[],
        None,
        "2026-11-23T12:00:00.000Z",
    );
    fs::create_dir(&f.dir).unwrap();
    fs::set_permissions(&f.dir, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(experience::store(&record, &f.dir).is_err());
    let alias = f._tmp.path().join("case-link");
    symlink(&f.dir, &alias).unwrap();
    assert!(experience::store(&record, &alias).is_err());
    assert!(fs::read_dir(&f.dir).unwrap().next().is_none());
}

#[test]
fn experience_store_blocks_raw_handoff_events_or_unsanitized_secret_fields() {
    let f = Fixture::new();
    let agent = Fixture::agent();
    let record = f.prepare(
        &json!({"status":"failed"}),
        Some(&agent),
        &[],
        None,
        "2026-11-23T12:00:00.000Z",
    );
    for alteration in [
        "raw_handoff",
        "raw_events",
        "unmasked_secret",
        "id_mismatch",
    ] {
        let mut unsafe_record = record.clone();
        match alteration {
            "raw_handoff" => {
                unsafe_record["handoff"] = json!("Original unredacted private instructions")
            }
            "raw_events" => {
                unsafe_record["observation"]["events"] = json!([{"tool_result":"secrets"}])
            }
            "unmasked_secret" => {
                unsafe_record["strategy"]["lesson"] = json!("API key=syntheticTESTsecret123")
            }
            "id_mismatch" => unsafe_record["id"] = json!("e".repeat(64)),
            _ => unreachable!(),
        }
        let rejected = experience::store(&unsafe_record, &f.dir);
        assert!(
            rejected.is_err(),
            "unsafe long-term record was accepted: {alteration}"
        );
    }
    assert!(!f.dir.exists(), "invalid summaries must not create storage");
}

#[test]
fn generated_experience_prompt_contains_only_sanitized_context_and_tool_counts() {
    let events = vec![
        json!({"type":"tool_use","name":"terminal",
        "input":{"command":"echo secret=syntheticSensitiveKey12345"}}),
        json!({"type":"tool_result","name":"terminal","is_error":false,
        "output":"token=syntheticSensitiveKey12345"}),
    ];
    let result = json!({"status":"resolved","summary":"Verified the fixture","reason":null});
    let mut observed = false;
    let candidate = experience::generate_with(
        "Local post-run recorder",
        "Visit https://private.example/session?token=privateSecret for an authorized task",
        &result,
        &events,
        |request| {
            observed = true;
            assert_eq!(request["messages"][0]["role"], "system");
            assert_eq!(request["messages"][0]["content"], "Local post-run recorder");
            assert_eq!(request["messages"][1]["role"], "user");
            assert!(request["messages"][1]["content"].is_string());
            let text = request["messages"][1]["content"].as_str().unwrap();
            assert!(!text.contains("private.example"));
            assert!(!text.contains("syntheticSensitiveKey12345"));
            assert!(!text.contains("echo secret"));
            let context: Value = serde_json::from_str(text).unwrap();
            assert_eq!(context["outcome"], "resolved");
            assert_eq!(context["tool_calls"], 1);
            assert_eq!(context["tool_errors"], 0);
            assert_eq!(context["observed_tools"], json!(["shell"]));
            assert_eq!(request["response_format"]["type"], "json_object");
            Ok(json!({"choices":[{"message":{"content":json!({
           "scenario_key":"recorded_example","category":"tooling","symptom":"Fixture missing",
           "strategy_key":"inspect_and_verify","steps":["Inspect permitted resource"],
           "verification":"Confirm tool result","lesson":"Use observed evidence"
        }).to_string()}}]}))
        },
    )
    .unwrap();
    assert!(observed);
    assert_eq!(candidate["scenario_key"], "recorded_example");
    assert_eq!(candidate["strategy_key"], "inspect_and_verify");
}

#[test]
fn malformed_optional_recording_cannot_be_treated_as_success_or_a_tool_result() {
    let candidate = experience::generate_with(
        "Recorder",
        "Safe synthetic task",
        &json!({"status":"failed","summary":"No evidence"}),
        &[],
        |_| Ok(json!({"choices":[{"message":{"content":"not-json"}}]})),
    );
    assert!(candidate.is_err());
    let missing = experience::generate_with(
        "Recorder",
        "Safe synthetic task",
        &json!({"status":"failed","summary":"No evidence"}),
        &[],
        |_| Ok(json!({"choices":[{"message":{"content":"[]"}}]})),
    );
    assert!(missing.is_err());
}
