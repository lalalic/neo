use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Command, Output},
    thread,
    time::Duration,
};

struct Fixture {
    temp: tempfile::TempDir,
    root: PathBuf,
    work: PathBuf,
    source: PathBuf,
    cases: PathBuf,
    challenges: PathBuf,
    lock: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let work = temp.path().join("workspace");
        fs::create_dir_all(&work).unwrap();
        let source = temp.path().join("handoff.md");
        fs::write(
            &source,
            "Goal: Verify synthetic local model\nBlocker: temporary local marker\n",
        )
        .unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        Self {
            work,
            source,
            root,
            cases: temp.path().join("cases"),
            challenges: temp.path().join("challenges"),
            lock: temp.path().join("lock"),
            temp,
        }
    }
    fn run(&self, engine: &str, endpoint: Option<&str>, server: Option<&Path>) -> Output {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_neo-rs"));
        cmd.args([
            "escalation",
            "--handoff-file",
            self.source.to_str().unwrap(),
            "--cwd",
            self.work.to_str().unwrap(),
            "--correlation-id",
            "fixture/task-101",
        ])
        .env_clear()
        .env("HOME", self.temp.path())
        .env("PATH", std::env::var("PATH").unwrap())
        .env("NEO_HARNESS_ROOT", &self.root)
        .env("NEO_ESCALATION_CHALLENGES_DIR", &self.challenges)
        .env("NEO_ESCALATION_CASES_DIR", &self.cases)
        .env("NEO_ESCALATION_LOCK_DIR", &self.lock)
        .env("NEO_ESCALATION_LOCK_WAIT_SECONDS", "2")
        .env("NEO_ESCALATION_ENGINE", engine)
        .env("NEO_ESCALATION_MAX_TURNS", "4")
        .env("NEO_ESCALATION_BUDGET_SECONDS", "30")
        .env("NEO_ESCALATION_STARTUP_MS", "4000")
        .current_dir(&self.work);
        if let Some(endpoint) = endpoint {
            cmd.env("NEO_ESCALATION_BASE_URL", endpoint);
        }
        if let Some(server) = server {
            cmd.env("NEO_ESCALATION_SERVER_COMMAND", server);
            cmd.env("MOCK_PORT_FILE", self.temp.path().join("port.txt"));
        }
        cmd.output().unwrap()
    }
    fn challenge(&self) -> Value {
        let folders = fs::read_dir(&self.challenges)
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect::<Vec<_>>();
        assert_eq!(folders.len(), 1);
        let file = fs::read_dir(&folders[0])
            .unwrap()
            .map(|e| e.unwrap().path())
            .find(|p| {
                p.file_name()
                    .and_then(|v| v.to_str())
                    .is_some_and(|s| s.ends_with("finished.json"))
            })
            .unwrap();
        serde_json::from_slice(&fs::read(file).unwrap()).unwrap()
    }
    fn case(&self) -> Value {
        let files = fs::read_dir(&self.cases)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|e| e == "json"))
            .collect::<Vec<_>>();
        assert_eq!(files.len(), 1);
        serde_json::from_slice(&fs::read(&files[0]).unwrap()).unwrap()
    }
    fn owned_mock_server(&self) -> PathBuf {
        let path = self.temp.path().join("mock-local-llama.cjs");
        fs::write(&path,r#"#!/usr/bin/env node
const http=require('node:http');const fs=require('node:fs');
const args=process.argv.slice(2);const port=Number(args[args.indexOf('--port')+1]);
fs.writeFileSync(process.env.MOCK_PORT_FILE,String(port));
let count=0;
const server=http.createServer((req,res)=>{
 if(req.url==='/health'){
  res.writeHead(200,{'content-type':'application/json'});return res.end('{"status":"ready"}');
 }
 let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{
  const body=JSON.parse(raw);count++;
  const call={id:'fixture-call',type:'function',function:{name:'shell',arguments:JSON.stringify({command:'echo fixture-marker confirmed'})}};
  const message=count===1?{role:'assistant',content:null,tool_calls:[call]}:
    {role:'assistant',content:JSON.stringify({status:'resolved',summary:'owned local model verified',reason:null,user_action:null,evidence:['fixture-marker'],notification:null})};
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({choices:[{message}]}));
 });
});server.listen(port,'127.0.0.1');
"#).unwrap();
        #[cfg(unix)]
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        path
    }
}
fn mock_endpoint(results: Vec<Value>) -> (String, thread::JoinHandle<Vec<Value>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let listener_thread = thread::spawn(move || {
        let mut requests = Vec::new();
        for result in results {
            let (mut conn, _) = listener.accept().unwrap();
            conn.set_read_timeout(Some(Duration::from_secs(4))).unwrap();
            let mut reader = BufReader::new(conn.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            assert!(line.starts_with("POST /v1/chat/completions HTTP/1.1"));
            let mut size = 0;
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                if line.to_ascii_lowercase().starts_with("content-length:") {
                    size = line.split(':').nth(1).unwrap().trim().parse().unwrap();
                }
            }
            let mut bytes = vec![0; size];
            reader.read_exact(&mut bytes).unwrap();
            requests.push(serde_json::from_slice::<Value>(&bytes).unwrap());
            let text = serde_json::to_string(&result).unwrap();
            let head=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",text.len());
            conn.write_all(head.as_bytes()).unwrap();
            conn.write_all(text.as_bytes()).unwrap();
        }
        requests
    });
    (format!("http://127.0.0.1:{port}/v1"), listener_thread)
}
fn reply(message: Value) -> Value {
    json!({"choices":[{"message":message}]})
}
#[test]
fn native_cli_external_local_model_executes_one_synthetic_shell_tool_and_records_redacted_result() {
    let f = Fixture::new();
    let tool = reply(
        json!({"content":null,"tool_calls":[{"id":"c1","type":"function",
   "function":{"name":"shell","arguments":"{\"command\":\"echo fixture-marker confirmed\"}"}}]}),
    );
    let done = reply(
        json!({"content":json!({"status":"resolved","summary":"verified fixture-marker",
  "reason":null,"user_action":null,"evidence":["fixture-marker confirmed"],"notification":null}).to_string()}),
    );
    let (endpoint, server) = mock_endpoint(vec![tool, done]);
    let output = f.run("external", Some(&endpoint), None);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["status"], "resolved");
    assert_eq!(result["evidence"], json!(["fixture-marker confirmed"]));
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0]["tool_choice"], "auto");
    assert_eq!(requests[1]["tool_choice"], "none");
    assert_eq!(f.challenge()["outcome"], "resolved");
    assert_eq!(f.challenge()["observed"]["calls"], 1);
    assert_eq!(f.case()["outcome"], "resolved");
    let work_files = fs::read_dir(&f.work).unwrap().count();
    assert_eq!(work_files, 0);
}
#[test]
fn native_cli_failed_model_reports_status_two_without_fabricated_tool_execution() {
    let f = Fixture::new();
    let failure = reply(
        json!({"content":json!({"status":"failed","summary":"Test target unavailable","evidence":[]}).to_string()}),
    );
    let (endpoint, model) = mock_endpoint(vec![failure]);
    let output = f.run("external", Some(&endpoint), None);
    assert_eq!(
        output.status.code(),
        Some(2),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["status"], "failed");
    assert_eq!(model.join().unwrap().len(), 1);
    assert_eq!(f.challenge()["outcome"], "failed");
    assert_eq!(f.case()["observation"]["calls"], 0);
}
#[test]
fn native_cli_invalid_config_creates_start_and_finished_without_any_model_request() {
    let f = Fixture::new();
    let output = f.run("invalid-test-engine", None, None);
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("NEO_ESCALATION_ENGINE"));
    assert_eq!(f.challenge()["outcome"], "failed");
    assert_eq!(f.challenge()["failure"]["stage"], "preflight");
}
#[test]
fn native_cli_escalation_help_matches_contract_and_learn_test_reject_safely() {
    let rust = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        .args(["escalation", "--help"])
        .output()
        .unwrap();
    assert!(rust.status.success());
    assert_eq!(rust.stdout, include_bytes!("../assets/escalation-help.txt"));
    let result = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        .args(["escalation", "learn"])
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(result.stdout.is_empty());
}
#[cfg(unix)]
#[test]
fn native_cli_owned_mock_llama_starts_and_stops_its_only_model_process() {
    let f = Fixture::new();
    let server = f.owned_mock_server();
    let output = f.run("llama", None, Some(&server));
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["status"], "resolved");
    assert_eq!(f.challenge()["outcome"], "resolved");
    assert_eq!(f.case()["outcome"], "resolved");
    let port = fs::read_to_string(f.temp.path().join("port.txt"))
        .unwrap()
        .parse::<u16>()
        .unwrap();
    let after = ureq::get(&format!("http://127.0.0.1:{port}/health")).call();
    assert!(
        after.is_err(),
        "owned model HTTP listener must disappear after completion"
    );
}
#[test]
fn native_cli_absent_owned_model_does_not_return_success_or_leave_an_unclassified_attempt() {
    let f = Fixture::new();
    let command = Path::new("/usr/bin/false");
    let output = f.run("llama", None, Some(command));
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert_eq!(f.challenge()["outcome"], "failed");
    assert_eq!(f.challenge()["failure"]["stage"], "model_startup");
    assert_eq!(f.case()["outcome"], "failed");
}

#[test]
fn native_cli_model_generated_case_uses_existing_loaded_model_without_replaying_tools() {
    let f = Fixture::new();
    let tool = reply(
        json!({"content":null,"tool_calls":[{"id":"tool-1","type":"function",
        "function":{"name":"shell","arguments":"{\"command\":\"echo fixture-ready checked\"}"}}]}),
    );
    let done = reply(
        json!({"content":json!({"status":"resolved","summary":"Fixture ready checked",
        "reason":null,"user_action":null,"evidence":["fixture-ready checked"],
        "notification":null}).to_string()}),
    );
    let captured = reply(
        json!({"content":json!({"scenario_key":"fixture_needs_check","category":"tooling",
        "symptom":"Fixture not yet confirmed","strategy_key":"check_once",
        "steps":["Inspect synthetic local fixture"],"verification":"Read tool evidence",
        "lesson":"Use verified local tool results"}).to_string()}),
    );
    let (endpoint, server) = mock_endpoint(vec![tool, done, captured]);
    let output = f.run("external", Some(&endpoint), None);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let parsed: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(parsed["status"], "resolved");
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[0]["tool_choice"], "auto");
    assert_eq!(requests[1]["tool_choice"], "none");
    assert_eq!(requests[2]["response_format"]["type"], "json_object");
    let final_prompt = requests[2]["messages"][1]["content"].as_str().unwrap();
    assert!(
        !final_prompt.contains("echo fixture-ready"),
        "recorder must not see full tool call"
    );
    assert!(final_prompt.contains("observed_tools"));
    let case = f.case();
    assert_eq!(case["source"], "postrun_model");
    assert_eq!(case["scenario"]["key"], "fixture_needs_check");
    assert_eq!(case["strategy"]["key"], "check_once");
    assert_eq!(case["observation"]["calls"], 1);
    assert_eq!(f.challenge()["outcome"], "resolved");
}
