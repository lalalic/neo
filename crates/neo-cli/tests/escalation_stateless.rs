use neo_harness_cli::{
    escalation_contract::{self, Config, Request},
    escalation_stateless::{self, ToolResult},
};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Command,
};
fn config() -> Config {
    Config {
        engine: "external".into(),
        model: "test".into(),
        context: 65536,
        budget_seconds: 30,
        max_turns: 5,
        startup_ms: 2000,
        server_command: "mock".into(),
        base_url: Some("http://127.0.0.1:12121/v1".into()),
    }
}
fn request() -> Request {
    Request {
        handoff: "Find the mock marker and verify it".into(),
        on_needs_user: "Do not notify during tests".into(),
        cwd: PathBuf::from("/tmp"),
        correlation_id: None,
    }
}
fn done() -> Value {
    json!({"status":"resolved","summary":"Mock target configured", "reason":null,
 "user_action":null,"evidence":["mock target validated"],"notification":null})
}
fn message(value: Value) -> Value {
    json!({"choices":[{"message":value}]})
}
fn call(id: &str, command: &str) -> Value {
    json!({"id":id,"type":"function","function":{"name":"shell","arguments":format!("{{\"command\":\"{command}\"}}")}})
}
fn events(text: &str) -> Vec<Value> {
    text.lines()
        .filter(|line| !line.is_empty())
        .map(|s| serde_json::from_str(s).unwrap())
        .collect()
}
#[test]
fn native_stateless_one_tool_result_and_decision_match_node_reference_events() {
    let input = request();
    let mut count = 0;
    let mut received = Vec::<Value>::new();
    let result=escalation_stateless::run_with("http://127.0.0.1:12121/v1","Local rules",&input,&config(),
  |body|{
   received.push(body.clone());let step=count;count+=1;
   Ok(if step==0{message(json!({"role":"assistant","content":null,"tool_calls":[call("c1","mock-source-read")]}))}
       else{message(json!({"role":"assistant","content":done().to_string()}))})
  },
  |name,args,cwd|{
   assert_eq!(name,"shell");assert_eq!(args["command"],"mock-source-read");assert_eq!(cwd,Path::new("/tmp"));
   Ok(ToolResult{ok:true,text:"mock-secret: a-short-secret-value".into()})
  }).unwrap();
    assert_eq!(received.len(), 2);
    assert_eq!(received[0]["tool_choice"], "auto");
    assert_eq!(received[1]["tool_choice"], "none");
    let reply = events(&result);
    assert_eq!(reply.len(), 3);
    assert_eq!(reply[0]["type"], "tool_use");
    assert_eq!(reply[1]["is_error"], false);
    assert_eq!(reply[2]["type"], "result");
    let (parsed, _) = escalation_contract::parse_session(&result).unwrap();
    assert_eq!(parsed, done());
    let node_reference = r#"
import {runStatelessAgent} from './.bin/neo-stateless-agent.mjs';
const done={status:'resolved',summary:'Mock target configured',reason:null,user_action:null,evidence:['mock target validated'],notification:null};
let count=0;const out=await runStatelessAgent({baseUrl:'http://127.0.0.1:12121/v1',agentPrompt:'Local rules',
 request:{cwd:'/tmp',handoff:'Find the mock marker and verify it',onNeedsUser:'Do not notify during tests'},
 config:{maxTurns:5,budgetSeconds:30},
 askModel:async()=>Response.json({choices:[{message:count++===0?
 {role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',function:{name:'shell',arguments:'{"command":"mock-source-read"}'}}]}:
 {role:'assistant',content:JSON.stringify(done)}}]}),
 callTool:async()=>({ok:true,text:'mock-secret: a-short-secret-value'})});
console.log(JSON.stringify(out.split('\n').map(JSON.parse)));
"#;
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let node = Command::new("node")
        .args(["--input-type=module", "-e", node_reference])
        .current_dir(root)
        .output()
        .unwrap();
    assert!(
        node.status.success(),
        "{}",
        String::from_utf8_lossy(&node.stderr)
    );
    let reference: Value = serde_json::from_slice(&node.stdout).unwrap();
    assert_eq!(json!(reply), reference);
}
#[test]
fn decision_continue_restores_tools_and_invalid_json_status_cannot_complete() {
    for invalid in [false, true] {
        let mut count = 0;
        let mut modes = Vec::new();
        let mut tool_count = 0;
        let outcome=escalation_stateless::run_with("http://127.0.0.1:12121/v1","Rules",&request(),&config(),
   |body|{
    modes.push(body["tool_choice"].as_str().unwrap().to_string());
    let step=count;count+=1;
    Ok(match step {
     0|2=>message(json!({"content":null,"tool_calls":[call("c1","pwd")]})),
     1=>message(json!({"content":if invalid{"{\"done\":false}"}else{"{\"continue\":true,\"reason\":\"verify target\"}"}})),
     _=>message(json!({"content":done().to_string()}))
    })
   },
   |_,_,_|{tool_count+=1;Ok(ToolResult{ok:true,text:"verified".into()})}
  ).unwrap();
        assert_eq!(tool_count, 2);
        assert_eq!(modes, vec!["auto", "none", "auto", "none"]);
        let parsed = events(&outcome);
        assert_eq!(parsed.iter().filter(|v| v["type"] == "tool_use").count(), 2);
        assert_eq!(parsed.last().unwrap()["type"], "result");
    }
}
#[test]
fn resolved_without_real_tool_evidence_never_completes() {
    let result = escalation_stateless::run_with(
        "http://127.0.0.1:12121/v1",
        "Rules",
        &request(),
        &config(),
        |_| Ok(message(json!({"content":done().to_string()}))),
        |_, _, _| panic!("tool must not be called"),
    );
    assert!(result
        .unwrap_err()
        .contains("without a successful tool result"));
}
#[test]
fn unknown_model_requested_tool_fails_closed_before_external_tool_executor() {
    let mut step = 0;
    let result = escalation_stateless::run_with(
        "http://127.0.0.1:12121/v1",
        "Rules",
        &request(),
        &config(),
        |_| {
            step += 1;
            Ok(if step == 1 {
                message(
                    json!({"content":null,"tool_calls":[{"id":"unapproved","function":{"name":"system_shell","arguments":"{}"}}]}),
                )
            } else {
                message(
                    json!({"content":"{\"status\":\"failed\",\"summary\":\"Tool not allowed\",\"evidence\":[]}"}),
                )
            })
        },
        |_, _, _| panic!("unapproved tools must never call executor"),
    );
    assert!(result.is_ok());
    let parsed = events(&result.unwrap());
    assert_eq!(parsed[1]["is_error"], true);
    assert_eq!(parsed[1]["output"], "Unapproved local tool name");
}
#[test]
fn batch_tool_calls_are_capped_at_four_with_matching_results() {
    let mut count = 0;
    let mut used = 0;
    let output=escalation_stateless::run_with("http://127.0.0.1:12121/v1","Rules",&request(),&config(),
  |_|{
   count+=1;
   Ok(if count==1 {message(json!({"content":null,"tool_calls":(0..7).map(|n|call(&format!("id-{n}"),"pwd")).collect::<Vec<_>>()}))}
       else{message(json!({"content":done().to_string()}))})
  },
  |_,_,_|{used+=1;Ok(ToolResult{ok:true,text:"verified".into()})}
 ).unwrap();
    assert_eq!(used, 4);
    let items = events(&output);
    assert_eq!(items.iter().filter(|v| v["type"] == "tool_use").count(), 4);
    assert_eq!(
        items.iter().filter(|v| v["type"] == "tool_result").count(),
        4
    );
}
#[test]
fn remote_endpoints_and_incomplete_decision_blocks_are_rejected() {
    let bad = escalation_stateless::run_with(
        "https://example.com/v1",
        "Rules",
        &request(),
        &config(),
        |_| panic!("remote request must not happen"),
        |_, _, _| panic!("no tools"),
    );
    assert!(bad.unwrap_err().contains("loopback"));
    let config = Config {
        max_turns: 1,
        ..config()
    };
    let failure = escalation_stateless::run_with(
        "http://127.0.0.1:12121/v1",
        "Rules",
        &request(),
        &config,
        |body| {
            Ok(if body["tool_choice"] == "auto" {
                message(json!({"content":null,"tool_calls":[call("c1","pwd")]}))
            } else {
                message(json!({"content":"{\"continue\":true,\"reason\":\"do more\"}"}))
            })
        },
        |_, _, _| {
            Ok(ToolResult {
                ok: true,
                text: "ok".into(),
            })
        },
    );
    assert!(failure.unwrap_err().contains("maximum tool-calling turns"));
}

#[test]
fn native_local_http_model_transport_posts_json_without_redirect_or_remote_access() {
    use std::{
        io::{BufRead, BufReader, Read, Write},
        net::TcpListener,
        thread,
        time::Duration,
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let handler = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut reader = BufReader::new(socket.try_clone().unwrap());
        let mut start = String::new();
        reader.read_line(&mut start).unwrap();
        assert!(start.starts_with("POST /v1/chat/completions HTTP/1.1"));
        let mut n = 0_usize;
        loop {
            let mut header = String::new();
            reader.read_line(&mut header).unwrap();
            if header == "\r\n" || header.is_empty() {
                break;
            }
            if header.to_ascii_lowercase().starts_with("content-length:") {
                n = header.split(':').nth(1).unwrap().trim().parse().unwrap();
            }
        }
        let mut body = vec![0; n];
        reader.read_exact(&mut body).unwrap();
        let parsed: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(parsed["model"], "neo-escalation");
        let answer = r#"{"choices":[{"message":{"content":"{\"status\":\"failed\",\"summary\":\"test\"}"}}]}"#;
        let header=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",answer.len());
        socket.write_all(header.as_bytes()).unwrap();
        socket.write_all(answer.as_bytes()).unwrap();
    });
    let endpoint = format!("http://127.0.0.1:{port}/v1");
    let output = escalation_stateless::live_model(
        &endpoint,
        &json!({"model":"neo-escalation"}),
        std::time::Duration::from_secs(2),
    )
    .unwrap();
    assert_eq!(
        output["choices"][0]["message"]["content"],
        "{\"status\":\"failed\",\"summary\":\"test\"}"
    );
    handler.join().unwrap();
    assert!(escalation_stateless::live_model(
        "http://malicious.example/v1",
        &json!({}),
        std::time::Duration::from_secs(1)
    )
    .is_err());
}
