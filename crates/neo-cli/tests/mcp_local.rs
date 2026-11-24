use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Command, Output},
    thread,
};
struct Fixture {
    _temp: tempfile::TempDir,
    home: PathBuf,
    root: PathBuf,
    node: String,
}
impl Fixture {
    fn new(port: u16) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        let config = home.join("Library/Application Support/NeoY/deployment.json");
        fs::create_dir_all(config.parent().unwrap()).unwrap();
        fs::write(config, format!("{{\"mcpPort\":{port}}}")).unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let node = String::from_utf8(
            Command::new("node")
                .args(["-p", "process.execPath"])
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();
        Self {
            _temp: temp,
            home,
            root,
            node,
        }
    }
    fn run(&self, native: bool, args: &[&str]) -> Output {
        let mut command = if native {
            Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        } else {
            Command::new(&self.node)
        };
        if !native {
            command.arg(self.root.join(".bin/neo.mjs"));
        }
        command
            .args(args)
            .current_dir(&self.root)
            .env("HOME", &self.home)
            .env("NEO_HARNESS_ROOT", &self.root)
            .output()
            .unwrap()
    }
    fn args_file(&self, json: &str) -> PathBuf {
        let path = self.home.join("arguments.json");
        fs::write(&path, json).unwrap();
        path
    }
}
fn one_server(expected: usize) -> (u16, thread::JoinHandle<Vec<Value>>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = thread::spawn(move || {
        let mut observed = Vec::new();
        for _ in 0..expected {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut content_length = 0usize;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                if line.to_ascii_lowercase().starts_with("content-length:") {
                    content_length = line.split(':').nth(1).unwrap().trim().parse().unwrap();
                }
            }
            let mut body = vec![0; content_length];
            reader.read_exact(&mut body).unwrap();
            let request: Value = serde_json::from_slice(&body).unwrap();
            let method = request["method"].as_str().unwrap_or("");
            let result = if method == "tools/list" {
                json!({"tools":[{"name":"review.preview","description":"Native Review"},{"name":"askquestions","description":"Questions"},{"name":"markcut.preview","description":"Preview"},{"name":"computer","description":"Privileged"},{"name":"shell","description":"Unsafe"}]})
            } else if request["params"]["name"] == "computer"
                && request["params"]["arguments"]["command"] == "help"
            {
                json!({"isError":false,"content":[{"type":"text","text":"{\"commands\":[{\"command\":\"click\"},{\"command\":\"shell\"},{\"command\":\"list_apps\"}]}"}]})
            } else if request["params"]["arguments"]["command"] == "click" {
                json!({"isError":true,"content":[{"type":"text","text":"denied"}]})
            } else {
                json!({"isError":false,"content":[{"type":"text","text":"fixture-ok"}]})
            };
            observed.push(request);
            let text =
                serde_json::to_string(&json!({"jsonrpc":"2.0","id":1,"result":result})).unwrap();
            let headers=format!("HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",text.len());
            stream.write_all(headers.as_bytes()).unwrap();
            stream.write_all(text.as_bytes()).unwrap();
            stream.flush().unwrap();
        }
        observed
    });
    (port, handle)
}
#[test]
fn mcp_tool_inventory_filters_privileged_tools_with_same_reference_json() {
    for native in [false, true] {
        let (port, host) = one_server(1);
        let f = Fixture::new(port);
        let result = f.run(native, &["mcp", "tools"]);
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let value: Value = serde_json::from_slice(&result.stdout).unwrap();
        assert_eq!(value["tools"].as_array().unwrap().len(), 3);
        assert_eq!(value["tools"][0]["name"], "review.preview");
        let calls = host.join().unwrap();
        assert_eq!(calls[0]["method"], "tools/list");
    }
}
#[test]
fn mcp_allowlisted_call_requires_registered_tool_and_json_object_file() {
    for native in [false, true] {
        let (port, host) = one_server(2);
        let f = Fixture::new(port);
        let file = f.args_file(r#"{"title":"Test","questions":["What changed?"]}"#);
        let result = f.run(
            native,
            &[
                "mcp",
                "call",
                "askquestions",
                "--args-file",
                file.to_str().unwrap(),
            ],
        );
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let value: Value = serde_json::from_slice(&result.stdout).unwrap();
        assert_eq!(value["isError"], false);
        let calls = host.join().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[1]["method"], "tools/call");
        assert_eq!(calls[1]["params"]["name"], "askquestions");
        assert_eq!(
            calls[1]["params"]["arguments"]["questions"][0],
            "What changed?"
        );
    }
}
#[test]
fn computer_help_filters_privileged_subcommands_and_denied_tool_exits_two() {
    for native in [false, true] {
        let (port, host) = one_server(2);
        let f = Fixture::new(port);
        let help = f.run(native, &["computer-use", "help"]);
        assert!(
            help.status.success(),
            "{}",
            String::from_utf8_lossy(&help.stderr)
        );
        let value: Value = serde_json::from_slice(&help.stdout).unwrap();
        let content = value["content"][0]["text"].as_str().unwrap();
        let listed: Value = serde_json::from_str(content).unwrap();
        let names = listed["commands"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v["command"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["click", "list_apps"]);
        let denied = f.run(native, &["computer-use", "call", "click"]);
        assert_eq!(denied.status.code(), Some(2));
        let state: Value = serde_json::from_slice(&denied.stdout).unwrap();
        assert_eq!(state["isError"], true);
        let calls = host.join().unwrap();
        assert_eq!(calls[0]["params"]["arguments"]["command"], "help");
        assert_eq!(calls[1]["params"]["arguments"]["command"], "click");
    }
}
#[test]
fn mcp_and_computer_use_reject_unlisted_operations_before_any_network() {
    let f = Fixture::new(65530);
    for args in [
        vec!["mcp", "call", "shell", "--args-file", "/tmp/invalid"],
        vec!["computer-use", "call", "shell"],
        vec!["computer-use", "call", "setup"],
        vec!["mcp", "call", "review.preview"],
    ] {
        let result = f.run(true, &args);
        assert!(
            !result.status.success(),
            "dangerous operation succeeded: {args:?}"
        );
        assert!(result.stdout.is_empty());
    }
}

fn response_server(status: u16, body: &str, extra_header: &str) -> (u16, thread::JoinHandle<()>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let body = body.to_owned();
    let extra = extra_header.to_owned();
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut size = 0usize;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" || line.is_empty() {
                break;
            }
            if line.to_ascii_lowercase().starts_with("content-length:") {
                size = line.split(':').nth(1).unwrap().trim().parse().unwrap();
            }
        }
        let mut ignored = vec![0; size];
        reader.read_exact(&mut ignored).unwrap();
        let msg=format!("HTTP/1.1 {status} Test\r\ncontent-type: application/json\r\ncontent-length: {}\r\n{extra}connection: close\r\n\r\n{body}",body.len());
        stream.write_all(msg.as_bytes()).unwrap();
    });
    (port, handle)
}

#[test]
fn native_mcp_jsonrpc_http_and_redirect_failures_are_not_claimed_success() {
    let responses = [
        (403, r#"{"message":"denied"}"#, "", "HTTP 403"),
        (
            200,
            r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32003,"message":"Feature disabled"}}"#,
            "",
            "Feature disabled",
        ),
        (
            200,
            r#"{"jsonrpc":"2.0","id":9,"result":{}}"#,
            "",
            "invalid JSON-RPC",
        ),
        (200, "invalid", "", "invalid JSON"),
        (
            302,
            "",
            "location: http://127.0.0.1:1234/forbidden\r\n",
            "HTTP 302",
        ),
    ];
    for (status, body, headers, error) in responses {
        let (port, host) = response_server(status, body, headers);
        let f = Fixture::new(port);
        let result = f.run(true, &["mcp", "tools"]);
        assert!(
            !result.status.success(),
            "response {status} must not be accepted"
        );
        assert!(result.stdout.is_empty());
        assert!(
            String::from_utf8_lossy(&result.stderr).contains(error),
            "{status}: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        host.join().unwrap();
    }
}

#[test]
fn native_mcp_rejects_invalid_local_deployment_port_before_any_request() {
    for content in [
        "{",
        r#"{"mcpPort":"https://malicious.example"}"#,
        r#"{"mcpPort":65536}"#,
        r#"{"mcpPort":0}"#,
    ] {
        let f = Fixture::new(6);
        let file = f
            .home
            .join("Library/Application Support/NeoY/deployment.json");
        fs::write(file, content).unwrap();
        let result = f.run(true, &["mcp", "tools"]);
        assert!(!result.status.success());
        assert!(result.stdout.is_empty());
        assert!(String::from_utf8_lossy(&result.stderr).contains("Neo.app"));
    }
}

#[test]
fn native_mcp_rejects_malformed_or_privileged_call_args_before_any_request() {
    let f = Fixture::new(65530);
    let attempts = [
        ("review.preview", r#"{"path":"relative.mp4"}"#),
        (
            "review.preview",
            r#"{"path":"/tmp/a.mp4","unapproved":true}"#,
        ),
        (
            "review.preview",
            r#"{"path":"/tmp/a.mp4","relay":{"jobId":"1","taskId":"2"}}"#,
        ),
        ("askquestions", r#"{"questions":[]}"#),
        ("askquestions", r#"{"questions":[42]}"#),
        ("markcut.preview", r#"{"path":"/tmp/a.exe"}"#),
        (
            "markcut.preview",
            r#"{"path":"/tmp/a.md","relay":{"jobId":"1"}}"#,
        ),
        (
            "markcut.preview",
            r#"{"path":"/tmp/a.md","review":{"relay":{"jobId":"1","taskId":"2"}}}"#,
        ),
    ];
    for (name, body) in attempts {
        let path = f.args_file(body);
        let result = f.run(
            true,
            &["mcp", "call", name, "--args-file", path.to_str().unwrap()],
        );
        assert!(!result.status.success(), "unsafe {name} accepted: {body}");
        assert!(result.stdout.is_empty());
    }
    let file = f.args_file("[]");
    let result = f.run(
        true,
        &[
            "mcp",
            "call",
            "review.preview",
            "--args-file",
            file.to_str().unwrap(),
        ],
    );
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr).contains("JSON object"));
}
