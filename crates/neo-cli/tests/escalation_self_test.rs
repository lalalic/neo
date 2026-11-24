use neo_harness_cli::{escalation_contract::Config, escalation_self_test};
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{fs, path::Path, process::Command};
fn config() -> Config {
    Config {
        engine: "external".into(),
        model: "fixture-only".into(),
        context: 65536,
        budget_seconds: 20,
        max_turns: 3,
        startup_ms: 1500,
        server_command: "none".into(),
        base_url: Some("http://127.0.0.1:10101/v1".into()),
    }
}
fn reply(message: Value) -> Value {
    json!({"choices":[{"message":message}]})
}
#[test]
fn nonce_is_unseen_until_a_real_read_only_tool_result_and_never_appears_in_report() {
    let dir = tempfile::tempdir().unwrap();
    let nonce = "abcdef0123456789abcdef0123456789";
    let mut turn = 0;
    let mut command = String::new();
    let report=escalation_self_test::prove_with(&config(),"http://127.0.0.1:10101/v1",nonce,dir.path(),
  |request|{
   turn+=1;
   if turn==1{
    assert_eq!(request["tool_choice"],"auto");
    let input=request["messages"][1]["content"].as_str().unwrap();
    assert!(!input.contains(nonce));
    assert!(input.contains("Do not contact anyone"));
    let relative=input.split('`').nth(1).unwrap();
    assert!(relative.starts_with("cat "));
    command=relative.into();
    return Ok(reply(json!({"content":null,"tool_calls":[{"id":"tool-1","type":"function",
      "function":{"name":"shell","arguments":json!({"command":command}).to_string()}}]})));
   }
   assert_eq!(request["tool_choice"],"none");
   let tool=request["messages"].as_array().unwrap().iter().find(|x|x["role"]=="tool").unwrap();
   let content=tool["content"].as_str().unwrap();
   assert!(content.contains(nonce));
   Ok(reply(json!({"content":json!({"status":"resolved","summary":"Observed private fixture value",
     "evidence":[nonce],"notification":null}).to_string()})))
  }).unwrap();
    assert_eq!(turn, 2);
    assert_eq!(report["status"], "pass");
    assert_eq!(report["checks"]["unknown_value_verified"], true);
    assert_eq!(report["checks"]["shell_tool_execution"], true);
    assert_eq!(report["checks"]["model_process_released"], Value::Null);
    assert!(!report.to_string().contains(nonce));
    let data = fs::read_to_string(dir.path().join("nonce.txt")).unwrap();
    assert_eq!(data, format!("{nonce}\n"));
    #[cfg(unix)]
    assert_eq!(
        fs::metadata(dir.path().join("nonce.txt"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
}
#[test]
fn no_tool_evidence_or_guessed_self_test_value_cannot_pass() {
    let temp = tempfile::tempdir().unwrap();
    let status = escalation_self_test::prove_with(
        &config(),
        "http://127.0.0.1:10101/v1",
        "abcdef0123456789abcdef0123456789",
        temp.path(),
        |_| {
            Ok(reply(
                json!({"content":json!({"status":"resolved","summary":"Guess","evidence":["abcdef0123456789abcdef0123456789"]}).to_string()}),
            ))
        },
    );
    assert!(status.is_err());
    assert!(status
        .unwrap_err()
        .contains("without a successful tool result"));
}
#[test]
fn unknown_or_mutating_model_tools_fail_the_strict_self_test() {
    let temp = tempfile::tempdir().unwrap();
    let mut step = 0;
    let result = escalation_self_test::prove_with(
        &config(),
        "http://127.0.0.1:10101/v1",
        "abcdef0123456789abcdef0123456789",
        temp.path(),
        |_| {
            step += 1;
            Ok(if step == 1 {
                reply(json!({"content":null,"tool_calls":[{"id":"bad","function":{
         "name":"shell","arguments":"{\"command\":\"rm -rf /tmp/should-not-run\"}"}}]}))
            } else {
                reply(
                    json!({"content":json!({"status":"resolved","summary":"Fake success","evidence":["abcdef0123456789abcdef0123456789"]}).to_string()}),
                )
            })
        },
    );
    assert!(result.is_err());
    assert!(!temp.path().join("should-not-run").exists());
}
#[test]
fn invalid_self_test_nonce_and_remote_endpoint_reject_before_shell_or_model() {
    let temp = tempfile::tempdir().unwrap();
    for nonce in ["short", "123456789012345678901234567890GH"] {
        let result = escalation_self_test::prove_with(
            &config(),
            "http://127.0.0.1:10101/v1",
            nonce,
            temp.path(),
            |_| panic!("model must not receive invalid secret challenge"),
        );
        assert!(result.is_err());
    }
    let second = tempfile::tempdir().unwrap();
    let remote = escalation_self_test::prove_with(
        &config(),
        "https://example.com/v1",
        "abcdef0123456789abcdef0123456789",
        second.path(),
        |_| panic!("remote model may not be contacted"),
    );
    assert!(remote.is_err());
}
#[test]
fn test_cli_rejects_extra_args_without_model_or_private_state() {
    for args in [
        vec!["escalation", "test", "--bad"],
        vec!["escalation", "test", "--help"],
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
            .args(args)
            .output()
            .unwrap();
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
    }
}

#[test]
fn native_escalation_test_cli_proves_secret_read_against_live_loopback_mock_model() {
    use std::{
        io::{BufRead, BufReader, Read, Write},
        net::TcpListener,
        thread,
        time::{Duration, Instant},
    };
    let home = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let port = listener.local_addr().unwrap().port();
    let response_thread = thread::spawn(move || {
        let since = Instant::now();
        let mut requests = Vec::new();
        for turn in 0..2 {
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(e)
                        if e.kind() == std::io::ErrorKind::WouldBlock
                            && since.elapsed() < Duration::from_secs(5) =>
                    {
                        thread::sleep(Duration::from_millis(30));
                    }
                    Err(e) => panic!("self-test model request not received: {e}"),
                }
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            assert!(line.starts_with("POST /v1/chat/completions HTTP/1.1"));
            let mut size = 0usize;
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                if line.to_lowercase().starts_with("content-length:") {
                    size = line.split(':').nth(1).unwrap().trim().parse().unwrap();
                }
            }
            let mut raw = vec![0; size];
            reader.read_exact(&mut raw).unwrap();
            let body: Value = serde_json::from_slice(&raw).unwrap();
            requests.push(body.clone());
            let answer = if turn == 0 {
                assert_eq!(body["tool_choice"], "auto");
                let handoff = body["messages"][1]["content"].as_str().unwrap();
                let command = handoff.split('`').nth(1).unwrap();
                assert!(command.starts_with("cat "));
                json!({"choices":[{"message":{"content":null,"tool_calls":[{
                   "id":"fixture-file-read","function":{"name":"shell","arguments":json!({"command":command}).to_string()}
                }]}}]})
            } else {
                assert_eq!(body["tool_choice"], "none");
                let last = body["messages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|m| m["role"] == "tool")
                    .unwrap();
                let parsed: Value =
                    serde_json::from_str(last["content"].as_str().unwrap()).unwrap();
                let nonce = parsed["output"].as_str().unwrap().trim();
                assert_eq!(nonce.len(), 32);
                assert!(nonce.bytes().all(|v| v.is_ascii_hexdigit()));
                json!({"choices":[{"message":{"content":json!({
        "status":"resolved","summary":"Read and verified fixture with local tool",
        "evidence":[nonce],"reason":null,"user_action":null,"notification":null
      }).to_string()}}]})
            };
            let text = answer.to_string();
            let headers=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",text.len());
            stream.write_all(headers.as_bytes()).unwrap();
            stream.write_all(text.as_bytes()).unwrap();
        }
        requests
    });
    let result = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        .args(["escalation", "test"])
        .env_clear()
        .env("HOME", home.path())
        .env(
            "NEO_HARNESS_ROOT",
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."),
        )
        .env("NEO_ESCALATION_ENGINE", "external")
        .env(
            "NEO_ESCALATION_BASE_URL",
            format!("http://127.0.0.1:{port}/v1"),
        )
        .env("NEO_ESCALATION_LOCK_DIR", home.path().join("lock"))
        .env("NEO_ESCALATION_LOCK_WAIT_SECONDS", "2")
        .env("NEO_ESCALATION_BUDGET_SECONDS", "20")
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let summary: Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(summary["status"], "pass");
    assert_eq!(summary["checks"]["shell_tool_execution"], true);
    assert_eq!(summary["checks"]["unknown_value_verified"], true);
    assert_eq!(summary["checks"]["no_human_notification_requested"], true);
    assert_eq!(summary["checks"]["model_process_released"], Value::Null);
    assert_eq!(response_thread.join().unwrap().len(), 2);
    assert!(!home
        .path()
        .join(".local/share/neo/escalation/challenges")
        .exists());
    assert!(!home
        .path()
        .join(".local/share/neo/escalation/cases")
        .exists());
}
