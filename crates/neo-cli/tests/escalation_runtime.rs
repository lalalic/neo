use neo_harness_cli::{
    escalation_contract::{Config, Request},
    escalation_lock,
    escalation_runtime::{self, Paths},
    escalation_stateless::ToolResult,
};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

struct Fixture {
    _temp: tempfile::TempDir,
    paths: Paths,
    request: Request,
    config: Config,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("isolated");
        fs::create_dir_all(&home).unwrap();
        let work = home.join("workspace");
        fs::create_dir_all(&work).unwrap();
        let paths = Paths {
            challenge_dir: home.join("private/challenges"),
            experience_dir: home.join("private/cases"),
            lock: escalation_lock::Config {
                dir: home.join("private/state"),
                wait_seconds: 2,
            },
            guardian_binary: PathBuf::from(env!("CARGO_BIN_EXE_neo-rs")),
        };
        let request = Request {
            handoff: "Goal: Check synthetic local marker\nBlocker: mock tool not run yet".into(),
            on_needs_user: "Do not send messages during tests".into(),
            cwd: work,
            correlation_id: Some("fixture/test/task-101".into()),
        };
        let config = Config {
            engine: "external".into(),
            model: "fixture/mock-model".into(),
            context: 65536,
            budget_seconds: 45,
            max_turns: 4,
            startup_ms: 1000,
            server_command: "none".into(),
            base_url: Some("http://127.0.0.1:19298/v1".into()),
        };
        Self {
            _temp: temp,
            paths,
            request,
            config,
        }
    }
    fn challenge_folder(&self) -> PathBuf {
        let root = &self.paths.challenge_dir;
        let folders = fs::read_dir(root)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect::<Vec<_>>();
        assert_eq!(folders.len(), 1);
        folders[0].clone()
    }
    fn entry(&self, extension: &str) -> Value {
        let folder = self.challenge_folder();
        let files = fs::read_dir(folder)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| {
                p.file_name()
                    .and_then(|x| x.to_str())
                    .is_some_and(|x| x.ends_with(extension))
            })
            .collect::<Vec<_>>();
        assert_eq!(files.len(), 1, "{extension}: {files:?}");
        serde_json::from_slice(&fs::read(&files[0]).unwrap()).unwrap()
    }
    fn experience(&self) -> Value {
        let files = fs::read_dir(&self.paths.experience_dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|v| v == "json"))
            .collect::<Vec<_>>();
        assert_eq!(files.len(), 1);
        serde_json::from_slice(&fs::read(&files[0]).unwrap()).unwrap()
    }
}
fn reply(value: Value) -> Value {
    json!({"choices":[{"message":value}]})
}
fn tool_call() -> Value {
    json!({"id":"call-1","type":"function","function":{
   "name":"shell","arguments":"{\"command\":\"printf marker\"}"}})
}
fn success_json() -> Value {
    json!({"status":"resolved","summary":"Synthetic marker verified; password: SYNTHETIC-SECRET-633",
    "reason":null,"user_action":null,"evidence":["Observed SYNTHETIC-SECRET-633 in synthetic tool"],"notification":null,
    "experience":{"scenario_key":"marker_missing","strategy_key":"verify_tool","category":"tooling",
      "symptom":"marker absent","steps":["Run fixture-only check"],"verification":"Marker verified"}})
}
#[test]
fn native_esc_run_durably_records_verified_tool_result_and_sanitized_case_without_transcript() {
    let f = Fixture::new();
    let mut count = 0;
    let mut calls = 0;
    let result = escalation_runtime::run_external_with(
        &f.request,
        f.config.clone(),
        &f.paths,
        |_body| {
            count += 1;
            Ok(if count == 1 {
                reply(json!({"role":"assistant","content":null,"tool_calls":[tool_call()]}))
            } else {
                reply(json!({"role":"assistant","content":success_json().to_string()}))
            })
        },
        |name, args, cwd| {
            calls += 1;
            assert_eq!(name, "shell");
            assert_eq!(args["command"], "printf marker");
            assert_eq!(cwd, f.request.cwd);
            Ok(ToolResult {
                ok: true,
                text: "password: SYNTHETIC-SECRET-633".into(),
            })
        },
    )
    .unwrap();
    assert_eq!(calls, 1);
    assert_eq!(count, 2);
    assert_eq!(result["status"], "resolved");
    assert!(!result.to_string().contains("SYNTHETIC-SECRET-633"));
    let start = f.entry("started.json");
    assert_eq!(start["event"], "started");
    let finished = f.entry("finished.json");
    assert_eq!(finished["outcome"], "resolved");
    assert_eq!(finished["observed"]["calls"], 1);
    assert_eq!(finished["observed"]["tools"], json!(["shell"]));
    assert!(!finished.to_string().contains("SYNTHETIC-SECRET-633"));
    assert!(!f
        .challenge_folder()
        .join(format!(
            "{}.checkpoint.json",
            finished["attempt_id"].as_str().unwrap()
        ))
        .exists());
    let experience = f.experience();
    assert_eq!(experience["outcome"], "resolved");
    assert!(!experience.to_string().contains("SYNTHETIC-SECRET-633"));
    assert!(!experience.to_string().contains("printf marker"));
    assert_eq!(experience["observation"]["calls"], 1);
    let fields = fs::read_dir(&f.request.cwd).unwrap().count();
    assert_eq!(fields, 0);
}
#[test]
fn malformed_model_success_records_failure_and_does_not_replay_tool_action() {
    let f = Fixture::new();
    let mut calls = 0;
    let mut prompts = 0;
    let outcome = escalation_runtime::run_external_with(
        &f.request,
        f.config.clone(),
        &f.paths,
        |_body| {
            prompts += 1;
            Ok(if prompts == 1 {
                reply(json!({"role":"assistant","content":null,"tool_calls":[tool_call()]}))
            } else {
                reply(
                    json!({"content":"{\"status\":\"resolved\",\"summary\":\"claimed success\",\"evidence\":[]}"}),
                )
            })
        },
        |_, _, _| {
            calls += 1;
            Ok(ToolResult {
                ok: false,
                text: "synthetic tool failed".into(),
            })
        },
    );
    assert!(outcome.is_err());
    assert_eq!(calls, 1, "a tool error may not trigger a repeated action");
    let finished = f.entry("finished.json");
    assert_eq!(finished["outcome"], "failed");
    assert_eq!(finished["observed"]["calls"], 1);
    assert_eq!(finished["observed"]["failures"], 1);
    assert_eq!(finished["failure"]["code"], "verification_missing");
    assert_eq!(f.experience()["outcome"], "failed");
}
#[test]
fn invalid_runtime_config_still_leaves_a_durable_failed_attempt() {
    let f = Fixture::new();
    let result = escalation_runtime::execute_with(
        &f.request,
        Err("unsafe model config".into()),
        &f.paths,
        |_, _, _| panic!("model must not run when preflight failed"),
    );
    assert!(result.is_err());
    let started = f.entry("started.json");
    let finished = f.entry("finished.json");
    assert_eq!(started["event"], "started");
    assert_eq!(finished["outcome"], "failed");
    assert_eq!(finished["failure"]["stage"], "preflight");
    assert_eq!(f.experience()["outcome"], "failed");
}
#[test]
fn competing_inference_slot_blocks_external_execution_but_records_lock_failure() {
    let f = Fixture::new();
    let guard =
        escalation_lock::acquire_with_binary(&f.paths.lock, &f.paths.guardian_binary).unwrap();
    let mut paths = f.paths.clone();
    paths.lock.wait_seconds = 1;
    let outcome =
        escalation_runtime::execute_with(&f.request, Ok(f.config.clone()), &paths, |_, _, _| {
            panic!("blocked slot may not start any model or tool")
        });
    assert!(outcome.is_err());
    assert!(outcome.unwrap_err().contains("busy"));
    let finished = f.entry("finished.json");
    assert_eq!(finished["outcome"], "failed");
    assert_eq!(finished["failure"]["stage"], "resource_lock");
    guard.finish().unwrap();
}
#[test]
fn separately_requested_retry_preserves_challenge_identity_and_original_handoff() {
    let f = Fixture::new();
    let bad = escalation_runtime::execute_with(
        &f.request,
        Err("temporary synthetic blocker".into()),
        &f.paths,
        |_, _, _| panic!("preflight failed"),
    );
    assert!(bad.is_err());
    let initial = f.entry("challenge.json");
    let retry = escalation_runtime::execute_with(
        &f.request,
        Err("still blocked".into()),
        &f.paths,
        |_, _, _| panic!("preflight failed"),
    );
    assert!(retry.is_err());
    let unchanged = f.entry("challenge.json");
    assert_eq!(unchanged, initial);
    let attempts = fs::read_dir(f.challenge_folder())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .filter(|s| s.ends_with("started.json"))
        .collect::<Vec<_>>();
    assert_eq!(attempts.len(), 2);
    assert_eq!(f.experience()["outcome"], "failed");
}
