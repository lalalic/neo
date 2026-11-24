use neo_harness_cli::{
    escalation_contract::Config,
    escalation_learn::{self, LearnConfig},
    escalation_stateless::ToolResult,
};
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    fs,
    io::Cursor,
    path::PathBuf,
    process::{Command, Stdio},
};
const CANDIDATE: &str = r#"{"scenario_key":"apple_developer.login_challenge","category":"authentication",
 "symptom":"Apple Developer login requires an existing approved session",
 "strategy_key":"resume_existing_verified_session",
 "steps":["Inspect existing session","Use authorized verification route"],
 "verification":"Confirm sign-in status","failure_reason":"",
 "lesson":"Do not replace the already authenticated browser tab"}"#;
struct Fixture {
    temp: tempfile::TempDir,
    work: PathBuf,
    cases: PathBuf,
    config: Config,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let work = temp.path().join("workspace");
        fs::create_dir_all(&work).unwrap();
        let cases = temp.path().join("private-cases");
        let config = Config {
            engine: "external".into(),
            model: "mock-local".into(),
            context: 65536,
            budget_seconds: 15,
            max_turns: 4,
            startup_ms: 1000,
            server_command: "none".into(),
            base_url: Some("http://127.0.0.1:10055/v1".into()),
        };
        Self {
            temp,
            work,
            cases,
            config,
        }
    }
    fn config(&self) -> LearnConfig<'_> {
        LearnConfig {
            endpoint: "http://127.0.0.1:10055/v1",
            model: &self.config,
            cwd: &self.work,
            cases: &self.cases,
        }
    }
    fn files(&self) -> Vec<PathBuf> {
        if !self.cases.exists() {
            return Vec::new();
        }
        fs::read_dir(&self.cases)
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect()
    }
    fn stored(&self) -> Value {
        let files = self.files();
        assert_eq!(files.len(), 1);
        serde_json::from_slice(&fs::read(&files[0]).unwrap()).unwrap()
    }
}
fn reply(content: &str) -> Value {
    json!({"choices":[{"message":{"role":"assistant","content":content}}]})
}
fn draft(request: &Value) -> bool {
    request["response_format"]["type"] == "json_object"
}
fn call(command: &str) -> Value {
    json!({"choices":[{"message":{"role":"assistant","content":null,
   "tool_calls":[{"id":"c1","type":"function","function":{"name":"shell",
      "arguments":json!({"command":command}).to_string()}}]}}]})
}
#[test]
fn owner_remember_requires_explicit_yes_and_keeps_private_conversation_out_of_saved_case() {
    let f = Fixture::new();
    let mut input = Cursor::new(
        "Apple Developer login challenge requires existing session\n/remember\ny\n/quit\n",
    );
    let mut output = Vec::<u8>::new();
    let mut calls = 0;
    escalation_learn::run_loop(
        &mut input,
        &mut output,
        &f.config(),
        |request| {
            calls += 1;
            Ok(reply(if draft(request) {
                CANDIDATE
            } else {
                "Explain symptoms and steps"
            }))
        },
        |_, _, _| panic!("no tool should run in owner-only teaching"),
    )
    .unwrap();
    let visible = String::from_utf8(output).unwrap();
    assert!(visible.contains("Save or update this lesson? [y/N]"));
    assert!(visible.contains("Saved lesson"));
    assert!(visible.contains("Conversation discarded"));
    assert_eq!(calls, 2);
    let record = f.stored();
    assert_eq!(record["outcome"], "taught");
    assert_eq!(record["source"], "owner_taught");
    assert_eq!(record["owner_confirmed"], true);
    assert_eq!(record["training_reviewed"], false);
    assert!(!record
        .to_string()
        .contains("Apple Developer login challenge requires existing session"));
    #[cfg(unix)]
    {
        assert_eq!(
            fs::metadata(&f.cases).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(f.files()[0].clone())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}
#[test]
fn declining_remember_never_creates_a_case_or_transcript() {
    let f = Fixture::new();
    let mut input = Cursor::new("Explain owner steps\n/remember\nn\n/quit\n");
    let mut output = Vec::<u8>::new();
    escalation_learn::run_loop(
        &mut input,
        &mut output,
        &f.config(),
        |body| Ok(reply(if draft(body) { CANDIDATE } else { "Teach me" })),
        |_, _, _| panic!("no tool expected"),
    )
    .unwrap();
    assert!(!f.cases.exists());
    let message = String::from_utf8(output).unwrap();
    assert!(message.contains("Not saved"));
    assert!(message.contains("Conversation discarded"));
}
#[test]
fn learning_tool_toggle_disables_tool_specs_before_model_dispatch() {
    let f = Fixture::new();
    let mut input = Cursor::new("/tools off\nA blocked case\n/tools on\nAnother case\n/quit\n");
    let mut output = Vec::<u8>::new();
    let mut times = 0;
    escalation_learn::run_loop(
        &mut input,
        &mut output,
        &f.config(),
        |req| {
            times += 1;
            if times == 1 {
                assert!(req.get("tools").is_none());
            } else {
                assert_eq!(req["tool_choice"], "auto");
                assert!(req["tools"].is_array());
            }
            Ok(reply("Continue explaining"))
        },
        |_, _, _| panic!("tool must not be invoked by this model"),
    )
    .unwrap();
    assert_eq!(times, 2);
    assert!(!f.cases.exists());
}
#[test]
fn learning_identical_failed_tool_is_not_repeated_by_executor() {
    let f = Fixture::new();
    let mut input = Cursor::new("Try an unavailable mock command\n/quit\n");
    let mut output = Vec::<u8>::new();
    let mut step = 0;
    let mut actual = 0;
    escalation_learn::run_loop(
        &mut input,
        &mut output,
        &f.config(),
        |_| {
            step += 1;
            Ok(if step < 3 {
                call("ls /unavailable-mock-resource")
            } else {
                reply("Unable to verify")
            })
        },
        |_, _, _| {
            actual += 1;
            Ok(ToolResult {
                ok: false,
                text: "mock command failed".into(),
            })
        },
    )
    .unwrap();
    assert_eq!(actual, 1, "an identical failed tool must not repeat");
    assert_eq!(step, 3);
    assert!(!f.cases.exists());
}
#[test]
fn verified_auto_learning_requires_new_readonly_tool_evidence_before_saving() {
    let f = Fixture::new();
    let mut input = Cursor::new("Show how to verify Apple Developer login\n/quit\n");
    let mut output = Vec::<u8>::new();
    let mut steps = 0;
    let mut tools = 0;
    escalation_learn::run_loop(
        &mut input,
        &mut output,
        &f.config(),
        |body| {
            if draft(body) {
                return Ok(reply(CANDIDATE));
            }
            steps += 1;
            Ok(match steps {
                1 => call("cat /tmp/synthetic-status"),
                2 => reply("The owner scenario succeeded [VERIFIED]"),
                3 => call("cat /tmp/synthetic-status"),
                4 => reply("Fresh, read-only evidence confirms success [VERIFIED]"),
                _ => panic!("unexpected model turn"),
            })
        },
        |_, _, _| {
            tools += 1;
            Ok(ToolResult {
                ok: true,
                text: if tools == 1 {
                    "initial fixture".into()
                } else {
                    "verified fixture is still present".into()
                },
            })
        },
    )
    .unwrap();
    assert_eq!(tools, 2);
    let record = f.stored();
    assert_eq!(record["outcome"], "taught");
    assert_eq!(record["tool_verified"], true);
    assert_eq!(record["observation"]["calls"], 2);
    assert_eq!(
        record["verification_evidence"],
        "verified fixture is still present"
    );
    let shown = String::from_utf8(output).unwrap();
    assert!(shown.contains("Verified and recorded"));
}
#[test]
fn forged_verified_words_without_fresh_readonly_tool_observation_cannot_save() {
    let f = Fixture::new();
    let mut input = Cursor::new("Explain tool verification\n/quit\n");
    let mut output = Vec::<u8>::new();
    let mut step = 0;
    escalation_learn::run_loop(
        &mut input,
        &mut output,
        &f.config(),
        |_| {
            step += 1;
            Ok(match step {
                1 => call("cat /tmp/synthetic-status"),
                2 => reply("[VERIFIED]"),
                3 => reply("[VERIFIED] without an independent tool call"),
                _ => panic!("unexpected verification turn"),
            })
        },
        |_, _, _| {
            Ok(ToolResult {
                ok: true,
                text: "initial evidence".into(),
            })
        },
    )
    .unwrap();
    assert!(!f.cases.exists());
    assert!(String::from_utf8(output).unwrap().contains("Not verified"));
}
#[test]
fn learning_cli_non_tty_refuses_before_starting_any_model_or_recording_cases() {
    let f = Fixture::new();
    let output = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        .args(["escalation", "learn"])
        .stdin(Stdio::null())
        .env("HOME", f.temp.path())
        .env("NEO_ESCALATION_CASES_DIR", &f.cases)
        .env("NEO_ESCALATION_ENGINE", "invalid-fake-engine")
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("interactive terminal"));
    assert!(!f.cases.exists());
}
