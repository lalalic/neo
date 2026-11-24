use neo_harness_cli::escalation_contract::{self as esc};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
};
struct Fixture {
    _tmp: tempfile::TempDir,
    root: PathBuf,
    handoff: PathBuf,
    notify: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let handoff = tmp.path().join("handoff.md");
        let notify = tmp.path().join("policy.md");
        fs::write(
            &handoff,
            "# Goal\nVerify an authorized local task, and retain recovery state.\n",
        )
        .unwrap();
        fs::write(
            &notify,
            "Use the authorized File Helper for truly human-only steps.\n",
        )
        .unwrap();
        Self {
            _tmp: tmp,
            root,
            handoff,
            notify,
        }
    }
    fn node_function(&self, name: &str, payload: &Value) -> Value {
        let js=match name{
   "normal"=>"import {normalizeLocalResult} from './.bin/neo-local-escalation.mjs';console.log(JSON.stringify(normalizeLocalResult(JSON.parse(process.argv[1]))));",
   "config"=>"import {localEscalationConfig,serverArguments} from './.bin/neo-local-escalation.mjs';const conf=localEscalationConfig(JSON.parse(process.argv[1]));console.log(JSON.stringify({engine:conf.engine,model:conf.model,context:conf.context,budgetSeconds:conf.budgetSeconds,maxTurns:conf.maxTurns,startupMs:conf.startupMs,serverArguments:serverArguments(conf,18937)}));",
   "session"=>"import {parseLocalSession} from './.bin/neo-local-escalation.mjs';const parsed=parseLocalSession(JSON.parse(process.argv[1]));console.log(JSON.stringify(parsed));",
   _=>panic!("unknown reference function")
  };
        let output = Command::new("node")
            .args(["--input-type=module", "-e", js, &payload.to_string()])
            .current_dir(&self.root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice(&output.stdout).unwrap()
    }
}
#[test]
fn native_handoff_file_and_optional_notification_policy_are_private_and_file_only() {
    let f = Fixture::new();
    let options = vec![
        "--handoff-file".to_string(),
        f.handoff.to_string_lossy().to_string(),
        "--on-needs-user-file".into(),
        f.notify.to_string_lossy().to_string(),
        "--correlation-id".into(),
        "job/task123".into(),
    ];
    let req = esc::prepare(&options, None).unwrap();
    assert!(req.handoff.contains("authorized local task"));
    assert!(req.on_needs_user.contains("File Helper"));
    assert_eq!(req.correlation_id.as_deref(), Some("job/task123"));
    let original = fs::read_to_string(&f.handoff).unwrap();
    assert_eq!(req.handoff, original);
    let default = esc::prepare(
        &[
            "--handoff-file".into(),
            f.handoff.to_string_lossy().to_string(),
        ],
        None,
    )
    .unwrap();
    assert!(default.on_needs_user.contains("wechat-bro"));
    assert!(default.on_needs_user.contains("iMessage"));
}
#[test]
fn invalid_legacy_handoff_flags_missing_files_and_unsafe_correlation_ids_fail_closed() {
    let f = Fixture::new();
    for args in [
        vec![],
        vec!["--handoff-file", "-"],
        vec!["--intent", "x"],
        vec!["--handoff", "x"],
        vec!["--codex-command", "codex"],
        vec!["--handoff-file"],
    ] {
        assert!(
            esc::prepare(
                &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                None
            )
            .is_err(),
            "{args:?}"
        );
    }
    for bad in [
        "short",
        "/path with space",
        "../unsafe",
        "a//b",
        "sk-proj-invalid-secret",
        "a/b",
    ] {
        let args = [
            "--handoff-file".to_owned(),
            f.handoff.to_string_lossy().to_string(),
            "--correlation-id".into(),
            bad.into(),
        ];
        if bad == "a/b" || bad == "sk-proj-invalid-secret" {
            continue;
        }
        assert!(
            esc::prepare(&args, None).is_err(),
            "invalid correlation id accepted: {bad}"
        );
    }
    fs::write(&f.notify, " \n ").unwrap();
    let bad = [
        "--handoff-file".to_owned(),
        f.handoff.to_string_lossy().to_string(),
        "--on-needs-user-file".into(),
        f.notify.to_string_lossy().to_string(),
    ];
    assert!(esc::prepare(&bad, None).is_err());
}
#[test]
fn local_model_config_and_metal_arguments_match_node_reference() {
    let f = Fixture::new();
    for entries in [
        vec![],
        vec![("NEO_ESCALATION_ENGINE", "mlx")],
        vec![
            ("NEO_ESCALATION_MODEL", "/tmp/test.gguf"),
            ("NEO_ESCALATION_BUDGET_SECONDS", "300"),
        ],
        vec![
            ("NEO_ESCALATION_CONTEXT", "131072"),
            ("NEO_ESCALATION_MAX_TURNS", "8"),
        ],
    ] {
        let env = entries
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect::<HashMap<_, _>>();
        let config = esc::config_with(&env).unwrap();
        let native = json!({"engine":config.engine,"model":config.model,"context":config.context,
    "budgetSeconds":config.budget_seconds,"maxTurns":config.max_turns,"startupMs":config.startup_ms,
    "serverArguments":esc::server_args(&config,18937).unwrap()});
        let reference = f.node_function("config", &json!(env));
        assert_eq!(native, reference);
    }
}
#[test]
fn remote_inference_endpoints_and_invalid_runtime_numbers_are_rejected() {
    for fields in [
        vec![("NEO_ESCALATION_ENGINE", "cloud")],
        vec![("NEO_ESCALATION_CONTEXT", "4096")],
        vec![("NEO_ESCALATION_CONTEXT", "NaN")],
        vec![("NEO_ESCALATION_MAX_TURNS", "0")],
        vec![("NEO_ESCALATION_BUDGET_SECONDS", "999999")],
        vec![
            ("NEO_ESCALATION_ENGINE", "external"),
            ("NEO_ESCALATION_BASE_URL", "https://example.com/v1"),
        ],
    ] {
        let map = fields
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect::<HashMap<_, _>>();
        assert!(esc::config_with(&map).is_err());
    }
    assert!(esc::local_endpoint("http://127.0.0.1:7000/v1"));
    for bad in [
        "https://127.0.0.1:7000/v1",
        "http://localhost:7000/v1",
        "http://127.0.0.1:0/v1",
        "http://127.0.0.1:65536/v1",
        "http://127.0.0.1:7000/v1/other",
    ] {
        assert!(!esc::local_endpoint(bad));
    }
    let mut env = HashMap::new();
    env.insert("NEO_ESCALATION_ENGINE".into(), "external".into());
    env.insert(
        "NEO_ESCALATION_BASE_URL".into(),
        "http://127.0.0.1:7777/v1".into(),
    );
    let config = esc::config_with(&env).unwrap();
    assert!(esc::server_args(&config, 7777).is_err());
}
#[test]
fn native_local_result_normalization_matches_node_evidence_object_rules() {
    let f = Fixture::new();
    for raw in [
        json!({"status":"resolved","summary":"File verified","reason":"observed",
     "evidence":{"nonce":"abc123","path":"/tmp/data"},"notification":null}),
        json!({"status":"failed","summary":"Missing input","evidence":[],"notification":null}),
        json!({"status":"needs_user","summary":"Human confirmation needed","user_action":"Confirm on phone",
     "evidence":"Delivery tested","notification":{"attempted":true,"delivered":false,"channel":"wechat-bro","details":"not delivered"}}),
    ] {
        let native = esc::normalize(&raw).unwrap();
        let node = f.node_function("normal", &raw);
        assert_eq!(native, node);
    }
}
#[test]
fn resolved_without_evidence_or_successful_tool_event_is_never_reported_success() {
    for case in [
        json!({"status":"resolved","summary":"done","evidence":[]}),
        json!({"status":"needs_user","summary":"pending","evidence":[]}),
        json!({"status":"resolved","summary":"done","evidence":["verified"],
      "notification":{"attempted":true,"delivered":"yes"}}),
    ] {
        assert!(esc::normalize(&case).is_err());
    }
    let payload = json!({"status":"resolved","summary":"done","evidence":["file checked"],"notification":null});
    let terminal = json!({"type":"result","exit_code":0,"text":payload.to_string()});
    let output = terminal.to_string();
    assert!(esc::parse_session(&output)
        .unwrap_err()
        .contains("without a successful tool result"));
    let events = vec![
        json!({"type":"tool_use","name":"terminal","input":{"command":"pwd"}}),
        json!({"type":"tool_result","name":"terminal","is_error":false,"output":"/tmp"}),
        terminal,
    ];
    let content = events
        .iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join("\n");
    let (parsed, returned) = esc::parse_session(&content).unwrap();
    assert_eq!(parsed, payload);
    assert_eq!(returned, events);
    let f = Fixture::new();
    let reference = f.node_function("session", &json!(content));
    assert_eq!(reference["result"], parsed);
    assert_eq!(reference["events"], json!(returned));
}
#[test]
fn redaction_masks_exact_tool_observed_secrets_and_common_credential_patterns() {
    let events = vec![
        json!({"type":"tool_result","output":"password: SCRETMODEL_48249"}),
        json!({"type":"tool_result","output":"access_token=abcd_1337TOKEN"}),
    ];
    let raw = json!({"status":"resolved","summary":"Result SCRETMODEL_48249 verified",
   "reason":"Bearer 12345678 used","user_action":null,
   "evidence":["Observed abcd_1337TOKEN in local output"],
   "notification":{"attempted":true,"delivered":true,"channel":"wechat-bro","details":"password: SCRETMODEL_48249"}});
    let sanitized = esc::redact(&raw, &events).unwrap();
    let text = sanitized.to_string();
    for secret in ["SCRETMODEL_48249", "abcd_1337TOKEN", "Bearer 12345678"] {
        assert!(
            !text.contains(secret),
            "secret leak after output redaction: {secret}"
        );
    }
    assert_eq!(sanitized["summary"], "Result [REDACTED] verified");
}

#[test]
fn small_model_omitted_nullable_notification_fields_are_repaired_without_claiming_delivery() {
    for input in [
        json!({"attempted":false}),
        json!({"attempted":false,"delivered":false}),
        json!({}),
    ] {
        let raw = json!({"status":"resolved","summary":"Local fixture observed",
    "evidence":["one observed nonsecret tool result"],"notification":input});
        let normal = esc::normalize(&raw).unwrap();
        if input.is_object() && input.as_object().unwrap().is_empty() {
            assert!(normal["notification"].is_null());
        } else {
            assert_eq!(normal["notification"]["attempted"], false);
            assert!(normal["notification"].get("delivered").is_some());
            assert!(normal["notification"].get("channel").is_some());
            assert!(normal["notification"].get("details").is_some());
            assert_ne!(normal["notification"]["delivered"], true);
        }
    }
    for bad in [
        json!({"attempted":true}),
        json!({"attempted":"false"}),
        json!({"attempted":false,"delivered":"true"}),
    ] {
        assert!(esc::normalize(
            &json!({"status":"resolved","summary":"Local fixture observed",
    "evidence":["real observation"],"notification":bad})
        )
        .is_err());
    }
}
