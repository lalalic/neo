//! Native, explicitly limited NeoY MCP CLI facade. All effects are owned by
//! the already-running native NeoY Gateway on loopback, never by Harness.
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

const ALLOWED_MCP: &[&str] = &["markcut.preview", "review.preview", "askquestions"];
const ALLOWED_COMPUTER: &[&str] = &[
    "list_apps",
    "get_app_state",
    "click",
    "drag",
    "key",
    "scroll",
    "type",
    "select_text",
    "set_value",
    "perform_secondary_action",
];

fn deployment_path() -> Result<PathBuf, String> {
    Ok(crate::workspace::home()?.join("Library/Application Support/NeoY/deployment.json"))
}
fn local_endpoint() -> Result<String, String> {
    let path = deployment_path()?;
    let port = match fs::read_to_string(&path) {
        Ok(raw) => {
            let settings: Value = serde_json::from_str(&raw)
                .map_err(|e| format!("Cannot load Neo.app MCP settings: {e}"))?;
            settings.get("mcpPort").cloned().unwrap_or(json!(6767))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!(6767),
        Err(e) => return Err(format!("Cannot load Neo.app MCP settings: {e}")),
    };
    let parsed = port
        .as_u64()
        .filter(|n| *n > 0 && *n <= 65535)
        .ok_or("Invalid Neo.app local MCP port")?;
    let port = if parsed == 9224 { 6767 } else { parsed };
    Ok(format!("http://127.0.0.1:{port}/mcp"))
}
fn rpc(method: &str, params: &Value, is_computer: bool) -> Result<Value, String> {
    let endpoint = local_endpoint()?;
    if !endpoint.starts_with("http://127.0.0.1:") || !endpoint.ends_with("/mcp") {
        return Err("Neo CLI MCP requires a local Neo.app listener".into());
    }
    let request = json!({"jsonrpc":"2.0","id":1,"method":method,"params":params});
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(120)))
        .max_redirects(0)
        .max_redirects_will_error(true)
        .http_status_as_error(false)
        .build()
        .new_agent();
    let mut response = agent
        .post(&endpoint)
        .header("content-type", "application/json")
        .header("accept", "application/json")
        .send_json(&request)
        .map_err(|e| {
            format!(
                "Cannot reach local Neo.app {}: {e}",
                if is_computer { "Computer Use" } else { "MCP" }
            )
        })?;
    if !(200..300).contains(&response.status().as_u16()) {
        return Err(format!(
            "Neo.app MCP returned HTTP {}",
            response.status().as_u16()
        ));
    }
    let decoded: Value = response
        .body_mut()
        .read_json()
        .map_err(|_| "Neo.app MCP returned invalid JSON".to_string())?;
    if let Some(error) = decoded.get("error").filter(|x| !x.is_null()) {
        return Err(format!(
            "Neo.app MCP error {}: {}",
            error["code"],
            error["message"].as_str().unwrap_or("unknown")
        ));
    }
    if decoded["id"] != 1 || !decoded.get("result").is_some_and(Value::is_object) {
        return Err("Neo.app MCP returned an invalid JSON-RPC result".into());
    }
    Ok(decoded["result"].clone())
}
fn argument_file(path: &str) -> Result<Value, String> {
    if path.is_empty() || path.starts_with('-') {
        return Err("--args-file requires a file path".into());
    }
    let data = fs::read_to_string(Path::new(path))
        .map_err(|e| format!("Cannot read --args-file JSON: {e}"))?;
    let parsed: Value =
        serde_json::from_str(&data).map_err(|e| format!("Cannot read --args-file JSON: {e}"))?;
    if !parsed.is_object() {
        return Err("--args-file must contain a JSON object".into());
    }
    Ok(parsed)
}
fn optional_args_file(args: &[String]) -> Result<Value, String> {
    if args.is_empty() {
        return Ok(json!({}));
    }
    if args.len() != 2 || args[0] != "--args-file" {
        return Err("Expected optional --args-file PATH".into());
    }
    argument_file(&args[1])
}
fn required_relay(relay: &Value) -> bool {
    let Some(object) = relay.as_object() else {
        return false;
    };
    let id = |key: &str| {
        object.get(key).is_some_and(|v| {
            v.as_str().is_some_and(|s| !s.is_empty()) || v.as_u64().is_some_and(|n| n > 0)
        })
    };
    id("jobId")
        && id("taskId")
        && object
            .get("executionId")
            .and_then(Value::as_str)
            .is_some_and(|s| !s.is_empty())
}
fn validate_call(name: &str, args: &Value) -> Result<(), String> {
    let object = args
        .as_object()
        .ok_or("Neo MCP arguments must be a JSON object")?;
    if name == "review.preview" {
        if !object
            .get("path")
            .and_then(Value::as_str)
            .is_some_and(|p| p.starts_with('/'))
        {
            return Err("review.preview requires an absolute media or Markdown path".into());
        }
        if object
            .keys()
            .any(|key| !matches!(key.as_str(), "path" | "title" | "relay"))
        {
            return Err("review.preview only accepts path, optional title and relay".into());
        }
        if object.get("relay").is_some_and(|v| !required_relay(v)) {
            return Err(
                "Managed review.preview requires relay.jobId, taskId and executionId".into(),
            );
        }
    } else if name == "askquestions" {
        if object
            .keys()
            .any(|key| !matches!(key.as_str(), "title" | "questions" | "relay"))
        {
            return Err("askquestions accepts only title, questions and optional relay".into());
        }
        let questions = object.get("questions").and_then(Value::as_array);
        if !questions.is_some_and(|items| {
            !items.is_empty()
                && items.len() <= 40
                && items.iter().all(|q| {
                    q.as_str()
                        .is_some_and(|s| !s.trim().is_empty() && s.encode_utf16().count() <= 10000)
                })
        }) {
            return Err("askquestions requires 1-40 non-empty Markdown questions".into());
        }
        if object.get("title").is_some_and(|v| {
            !v.as_str()
                .is_some_and(|s| !s.trim().is_empty() && s.encode_utf16().count() <= 160)
        }) {
            return Err("askquestions title must be 1-160 characters".into());
        }
        if object.get("relay").is_some_and(|v| !required_relay(v)) {
            return Err("Managed askquestions requires relay.jobId, taskId and executionId".into());
        }
    } else if name == "markcut.preview" {
        let path = object.get("path").and_then(Value::as_str).unwrap_or("");
        let extension = path.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase());
        if !path.starts_with('/')
            || !extension.as_deref().is_some_and(|e| {
                matches!(
                    e,
                    "md" | "mp4"
                        | "mov"
                        | "m4v"
                        | "webm"
                        | "png"
                        | "jpg"
                        | "jpeg"
                        | "webp"
                        | "gif"
                        | "mp3"
                        | "wav"
                        | "m4a"
                        | "aac"
                        | "flac"
                        | "ogg"
                )
            })
        {
            return Err(
                "markcut.preview requires an absolute Markdown or supported media path".into(),
            );
        }
        if object.contains_key("relay") {
            return Err("Use review.relay instead of top-level relay".into());
        }
        if object
            .get("review")
            .and_then(|x| x.get("relay"))
            .is_some_and(|v| !required_relay(v))
        {
            return Err(
                "Managed markcut.preview requires review.relay.jobId, taskId, and executionId"
                    .into(),
            );
        }
    }
    Ok(())
}
fn inventory() -> Result<Value, String> {
    let result = rpc("tools/list", &json!({}), false)?;
    let items = result
        .get("tools")
        .and_then(Value::as_array)
        .ok_or("Neo.app MCP tools/list response lacks tools")?;
    let filtered = items
        .iter()
        .filter(|v| {
            v.get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| ALLOWED_MCP.contains(&name))
        })
        .cloned()
        .collect::<Vec<_>>();
    Ok(json!({"tools":filtered}))
}
fn code(value: &Value) -> i32 {
    if value["isError"] == true {
        2
    } else {
        0
    }
}

pub(crate) fn registered_node(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 64
        || !name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err("Invalid registered Neo node name".into());
    }
    let result = rpc(
        "tools/call",
        &json!({"name":"cluster","arguments":{"command":format!("status {name}")}}),
        false,
    )
    .map_err(|_| "Cannot verify registered Neo node")?;
    if result["isError"] == true {
        return Err("Registered Neo node not found or unavailable".into());
    }
    let payload = result["content"][0]["text"]
        .as_str()
        .ok_or("Missing node status")?;
    let status: Value =
        serde_json::from_str(payload).map_err(|_| "Invalid registered node status")?;
    if status["name"] != name || status["reachable"] != true {
        return Err("Registered Neo node not reachable".into());
    }
    Ok(())
}

/// The only remote browser launch allowed by this CLI is the exact
/// one-use Neo Dashboard handoff, through a previously registered node.
pub(crate) fn open_dashboard_on_node(name: &str, url: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 64
        || !name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err("Invalid registered Neo node name".into());
    }
    let parsed = url::Url::parse(url).map_err(|_| "Invalid Dashboard handoff URL")?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/dashboard/connect"
        || parsed.query().is_some()
        || !parsed.fragment().is_some_and(|s| {
            (32..=128).contains(&s.len())
                && s.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        })
        || url.contains('\'')
        || url.contains('\n')
        || url.contains('\r')
    {
        return Err("Invalid Dashboard handoff URL".into());
    }
    let command = format!("invoke {name} exec -- run --timeout-ms 10000 -- /usr/bin/open '{url}'");
    let result = rpc(
        "tools/call",
        &json!({"name":"cluster","arguments":{"command":command}}),
        false,
    )
    .map_err(|_| "Registered node Dashboard launch failed")?;
    if result["isError"] == true {
        return Err("Registered node rejected Dashboard launch".into());
    }
    let payload = result["content"][0]["text"]
        .as_str()
        .ok_or("Missing node launch receipt")?;
    let receipt: Value =
        serde_json::from_str(payload).map_err(|_| "Invalid node launch receipt")?;
    let nested = receipt["result"]
        .as_str()
        .ok_or("Missing remote command receipt")?;
    let remote: Value =
        serde_json::from_str(nested).map_err(|_| "Invalid remote command receipt")?;
    if remote["exitCode"] != 0 || remote["timedOut"] == true {
        return Err("Remote browser launch not confirmed".into());
    }
    Ok(())
}

pub fn mcp(args: &[String]) -> Result<(Value, i32), String> {
    let Some((action, rest)) = args.split_first() else {
        return Err("usage: neo mcp tools|call|token".into());
    };
    if action == "tools" && rest.is_empty() {
        return Ok((inventory()?, 0));
    }
    if action == "call" && rest.first().is_some_and(|n| !n.starts_with('-')) {
        let name = rest[0].as_str();
        if rest.len() != 3 || rest[1] != "--args-file" {
            return Err("neo mcp call requires --args-file PATH".into());
        }
        if !ALLOWED_MCP.contains(&name) {
            return Err(format!("Neo MCP CLI tool is not exposed: {name}"));
        }
        let params = argument_file(&rest[2])?;
        validate_call(name, &params)?;
        let tools = inventory()?;
        if !tools["tools"]
            .as_array()
            .is_some_and(|items| items.iter().any(|row| row["name"] == name))
        {
            return Err(format!("Neo.app MCP tool not currently registered: {name}"));
        }
        let result = rpc(
            "tools/call",
            &json!({"name":name,"arguments":params}),
            false,
        )?;
        let exit = code(&result);
        return Ok((result, exit));
    }
    Err("Usage: neo mcp tools | neo mcp call askquestions --args-file PATH".into())
}
fn help_filter(result: Value) -> Result<Value, String> {
    if result["isError"] == true {
        return Ok(result);
    }
    let text = result["content"]
        .as_array()
        .and_then(|items| items.iter().find(|v| v["type"] == "text"))
        .and_then(|v| v["text"].as_str())
        .ok_or("Neo.app Computer Use help returned invalid JSON")?;
    let parsed: Value = serde_json::from_str(text)
        .map_err(|_| "Neo.app Computer Use help returned invalid JSON")?;
    let commands = parsed["commands"]
        .as_array()
        .ok_or("Neo.app Computer Use help has no commands")?;
    let filtered = commands
        .iter()
        .filter(|row| {
            row["command"]
                .as_str()
                .is_some_and(|n| ALLOWED_COMPUTER.contains(&n))
        })
        .cloned()
        .collect::<Vec<_>>();
    let mut result = result;
    result["content"] = json!([{"type":"text","text":serde_json::to_string(&json!({"commands":filtered})).map_err(|e|e.to_string())?}]);
    Ok(result)
}
pub fn computer(args: &[String]) -> Result<(Value, i32), String> {
    let command = if args == ["help"] {
        "help"
    } else if args.len() >= 2 && args[0] == "call" && !args[1].starts_with('-') {
        args[1].as_str()
    } else {
        return Err(
            "Usage: neo computer-use help | neo computer-use call COMMAND [--args-file PATH]"
                .into(),
        );
    };
    if command != "help" && !ALLOWED_COMPUTER.contains(&command) {
        return Err(format!("Computer Use command is not allowed: {command}"));
    }
    let options = if command == "help" {
        json!({})
    } else {
        optional_args_file(&args[2..])?
    };
    let arguments = if command == "help" {
        json!({"command":"help"})
    } else {
        json!({"command":command,"args":options})
    };
    let result = rpc(
        "tools/call",
        &json!({"name":"computer","arguments":arguments}),
        true,
    )?;
    let value = if command == "help" {
        help_filter(result)?
    } else {
        result
    };
    let exit = code(&value);
    Ok((value, exit))
}

/// Invoke the same restricted native Computer Use facade directly from the
/// stateless Tool Executor without writing model-provided JSON to disk.
pub fn computer_direct(command: &str, args: &Value) -> Result<Value, String> {
    if !ALLOWED_COMPUTER.contains(&command) {
        return Err(format!("Computer Use command is not allowed: {command}"));
    }
    if !args.is_object() {
        return Err("Computer Use arguments must be a JSON object".into());
    }
    rpc(
        "tools/call",
        &json!({"name":"computer","arguments":{"command":command,"args":args}}),
        true,
    )
}
