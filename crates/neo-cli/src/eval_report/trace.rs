//! Offline projection of actual Codex JSONL; never execute historical commands.
use regex::Regex;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
};
pub(super) fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}
pub(super) fn excerpt(v: &str, n: usize) -> String {
    let sensitive=Regex::new(r"(?i)(bearer\s+\S|authorization\s*[:=]|(?:api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token|cookie)\s*[:=]|sk-[a-z0-9_-]{12,}|/mcp/rest/[^/\s]+/|BEGIN [A-Z ]*PRIVATE KEY)").unwrap();
    if sensitive.is_match(v) {
        return "[credential-like evidence withheld]".into();
    }
    let mut out = v.chars().take(n).collect::<String>();
    if v.chars().count() > n {
        out.push_str(" … [truncated]");
    }
    out
}
fn regular(p: &Path) -> bool {
    fs::symlink_metadata(p).is_ok_and(|m| m.is_file() && !m.file_type().is_symlink())
}
pub(super) fn locate(home: &Path, id: &str) -> Result<PathBuf, String> {
    if id.len() != 36 || uuid::Uuid::parse_str(id).is_err() {
        return Err("invalid thread ID".into());
    }
    fn scan(root: &Path, suffix: &str, depth: u8, found: &mut Vec<PathBuf>) {
        if !fs::symlink_metadata(root).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink()) {
            return;
        }
        if let Ok(entries) = fs::read_dir(root) {
            for e in entries.flatten() {
                let n = e.file_name();
                let n = n.to_string_lossy();
                let p = e.path();
                if n.starts_with("rollout-") && n.ends_with(suffix) && regular(&p) {
                    found.push(p)
                } else if depth > 0 && n.bytes().all(|b| b.is_ascii_digit()) {
                    scan(&p, suffix, depth - 1, found)
                }
            }
        }
    }
    let mut found = vec![];
    let suffix = format!("-{id}.jsonl");
    scan(&home.join("sessions"), &suffix, 3, &mut found);
    scan(&home.join("archived_sessions"), &suffix, 0, &mut found);
    if found.len() == 1 {
        Ok(found.remove(0))
    } else {
        Err(format!(
            "local trace count {}; expected exactly one",
            found.len()
        ))
    }
}
fn text(y: &Value) -> String {
    y["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| c["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n")
}
fn category(p: &str) -> &'static str {
    let p = p.to_lowercase();
    if p.ends_with("agents.md") {
        "policy"
    } else if p.ends_with(".agent.md") || p.contains("/prompt-references/") {
        "agent"
    } else if p.ends_with("/skill.md") {
        "skill"
    } else if p.contains("/contracts/") || p.ends_with("protocol.md") {
        "contract"
    } else if p.contains("/qa/") || p.contains("/output/") {
        "generated/QA"
    } else if p.contains("/runs/") {
        "domain/run"
    } else if p.contains("/src/")
        || p.ends_with(".mjs")
        || p.ends_with(".ts")
        || p.ends_with(".tsx")
        || p.ends_with(".rs")
    {
        "source code"
    } else if p.contains("/docs/") {
        "documentation"
    } else {
        "other"
    }
}
fn path(p: &str, cwd: &str) -> Option<String> {
    if p.is_empty() || p.starts_with('~') || p.contains(['$', '*', '?', '[', ']', '`', '\n']) {
        return None;
    }
    let p = Path::new(p);
    if p.is_absolute() {
        Some(p.to_string_lossy().into_owned())
    } else if Path::new(cwd).is_absolute() {
        Some(Path::new(cwd).join(p).to_string_lossy().into_owned())
    } else {
        None
    }
}
// Conservative lexer. It does not evaluate shell substitutions, globbing,
// control flow, scripts or aliases. Quoted pipes are not shell separators.
fn segments(cmd: &str) -> Option<Vec<Vec<String>>> {
    if cmd.contains("<<") || cmd.contains("$(") || cmd.contains('`') {
        return None;
    }
    let mut rows = vec![];
    let mut row = vec![];
    let mut word = String::new();
    let mut q = None;
    let mut active = false;
    let mut it = cmd.chars().peekable();
    fn push(w: &mut String, r: &mut Vec<String>, a: &mut bool) {
        if *a {
            r.push(std::mem::take(w));
            *a = false;
        }
    }
    while let Some(c) = it.next() {
        if c == '\\' && q != Some('\'') {
            let n = it.next()?;
            if n != '\n' {
                word.push(n);
                active = true
            }
        } else if let Some(quote) = q {
            if c == quote {
                q = None
            } else {
                word.push(c)
            }
        } else if c == '\'' || c == '"' {
            q = Some(c);
            active = true
        } else if matches!(c, ';' | '|' | '&' | '\n') {
            push(&mut word, &mut row, &mut active);
            if !row.is_empty() {
                rows.push(std::mem::take(&mut row));
            }
        } else if matches!(c, '<' | '>') {
            // An adjacent unquoted numeric token is a shell file descriptor
            // (2>/dev/null), not an operand to the read command.
            if active && !word.is_empty() && word.bytes().all(|b| b.is_ascii_digit()) {
                word.clear();
                active = false;
            }
            push(&mut word, &mut row, &mut active);
            let mut op = c.to_string();
            if it.peek() == Some(&c) {
                op.push(it.next().unwrap())
            }
            row.push(op)
        } else if c.is_whitespace() {
            push(&mut word, &mut row, &mut active)
        } else {
            word.push(c);
            active = true
        }
    }
    if q.is_some() {
        return None;
    }
    push(&mut word, &mut row, &mut active);
    if !row.is_empty() {
        rows.push(row)
    }
    Some(rows)
}
fn shell_reads(cmd: &str, cwd: &str) -> (Vec<String>, bool) {
    let Some(rows) = segments(cmd) else {
        return (vec![], true);
    };
    let mut paths = vec![];
    let mut unknown = false;
    let mut cwd_known = true;
    // Variables are deliberately not expanded: quoted shell context and
    // execution-dependent assignments are not faithfully recoverable.
    for row in rows {
        let Some(command) = row.first() else { continue };
        let name = command.rsplit('/').next().unwrap_or(command);
        if name == "cd" || name == "pushd" || name == "popd" {
            // A prior cwd change may be conditional; do not invent the cwd
            // for subsequent relative operands.
            cwd_known = false;
        }
        if !matches!(name, "cat" | "sed" | "nl" | "head" | "tail" | "jq") {
            if !matches!(name, "printf" | "echo" | "true" | "false" | ":") {
                unknown = true
            }
            continue;
        }
        if row.iter().any(|v| {
            matches!(
                v.as_str(),
                "-i" | "-f" | "--arg" | "--argjson" | "--slurpfile" | "--rawfile" | "--from-file"
            ) || v.starts_with("-i.")
        }) {
            unknown = true;
            continue;
        }
        let mut program = matches!(name, "sed" | "jq");
        let mut skip = false;
        for a in row.iter().skip(1) {
            if skip {
                skip = false;
                continue;
            }
            if matches!(a.as_str(), ">" | ">>" | "<") {
                skip = true;
                unknown = true;
                continue;
            }
            if a == "-" {
                continue;
            }
            if a.starts_with('-') {
                if matches!(a.as_str(), "-e" | "--expression") && program {
                    skip = true;
                    program = false
                }
                if matches!(name, "head" | "tail" | "nl")
                    && matches!(a.as_str(), "-n" | "-c" | "-w" | "-s" | "-v")
                {
                    skip = true
                }
                continue;
            }
            if program {
                program = false;
                continue;
            }
            if !cwd_known && !Path::new(a).is_absolute() {
                unknown = true;
                continue;
            }
            if let Some(p) = path(a, cwd) {
                paths.push(p)
            } else {
                unknown = true
            }
        }
    }
    paths.sort();
    paths.dedup();
    (paths, unknown)
}
pub(super) fn analyze(file: &Path, thread: &str, binding: &str) -> Result<Value, String> {
    if !regular(file) {
        return Err("trace is not a regular file".into());
    }
    let f = fs::File::open(file).map_err(|e| e.to_string())?;
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    if len > 256 * 1024 * 1024 {
        return Err("trace exceeds 256 MiB analysis limit".into());
    }
    let mut reader = BufReader::new(f.take(len));
    let mut buf = vec![];
    let mut line = 0u64;
    let mut hash = Sha256::new();
    let mut malformed = 0u64;
    let mut window = 0u64;
    let mut duplicates = 0u64;
    let mut calls = Vec::<Value>::new();
    let mut index = HashMap::<String, usize>::new();
    let mut pending = HashMap::<String, Value>::new();
    let mut context = vec![];
    let mut messages = vec![];
    let mut compactions = vec![];
    let mut prior = Value::Null;
    let mut usage = Value::Null;
    let mut meta = Value::Null;
    let mut cwd = String::new();
    let mut start = String::new();
    let mut end = String::new();
    let mut bindings = HashSet::new();
    let binding_re = Regex::new(r"job/[0-9]+/task/[0-9]+/execution/[A-Za-z0-9-]+").unwrap();
    loop {
        buf.clear();
        if reader
            .read_until(b'\n', &mut buf)
            .map_err(|e| e.to_string())?
            == 0
        {
            break;
        }
        line += 1;
        hash.update(&buf);
        let Ok(x) = serde_json::from_slice::<Value>(&buf) else {
            malformed += 1;
            continue;
        };
        let ts = s(&x, "timestamp");
        if start.is_empty() {
            start = ts.into()
        }
        if !ts.is_empty() {
            end = ts.into()
        }
        let y = &x["payload"];
        match s(&x, "type") {
            "session_meta" => {
                if s(y, "id") != thread && s(y, "session_id") != thread {
                    return Err("session identity mismatch".into());
                }
                cwd = s(y, "cwd").into();
                meta = json!({"thread":thread,"cwd":cwd,"provider":y["model_provider"],"cliVersion":y["cli_version"],"line":line});
                let base = y["base_instructions"].as_str().unwrap_or("");
                context.push(json!({"line":line,"role":"native base","kind":"native base","characters":base.chars().count(),"sha256":format!("{:x}",Sha256::digest(base.as_bytes()))}));
            }
            "turn_context" => {
                if meta.is_object() {
                    meta["model"] = y["model"].clone();
                    meta["effort"] = y["effort"].clone();
                }
            }
            "compacted" => {
                window += 1;
                compactions.push(json!({"line":line,"time":ts,"window":window}));
            }
            "event_msg" if s(y, "type") == "token_count" => {
                if y["info"]["total_token_usage"].is_object() {
                    usage = y["info"]["total_token_usage"].clone();
                }
            }
            "response_item" => {
                match s(y, "type") {
                    "message" => {
                        let role = s(y, "role");
                        let t = text(y);
                        if role == "user" {
                            for m in binding_re.find_iter(&t) {
                                bindings.insert(m.as_str().to_owned());
                            }
                        }
                        if matches!(role, "user" | "developer") && calls.is_empty() && window == 0 {
                            let kind = if t.contains("AGENTS.md instructions for") {
                                "native AGENTS.md"
                            } else if t.contains("<skills_instructions>") {
                                "skill catalog"
                            } else if t.contains(binding) {
                                "Relay assignment"
                            } else {
                                "other startup"
                            };
                            context.push(json!({"line":line,"role":role,"kind":kind,"characters":t.chars().count(),"sha256":format!("{:x}",Sha256::digest(t.as_bytes())),"excerpt":if role=="user"{excerpt(&t,12000)}else{"[developer body withheld]".into()}}));
                        }
                        if role == "assistant" && !t.trim().is_empty() {
                            prior = json!({"line":line,"time":ts,"text":excerpt(&t,900)});
                            messages.push(prior.clone());
                        }
                    }
                    "function_call" | "custom_tool_call" => {
                        let id = s(y, "call_id");
                        if id.is_empty() || index.contains_key(id) {
                            duplicates += 1;
                            continue;
                        }
                        let arg = y["arguments"]
                            .as_str()
                            .or(y["input"].as_str())
                            .unwrap_or("");
                        let a = serde_json::from_str::<Value>(arg).unwrap_or(Value::Null);
                        let tool = s(y, "name");
                        let workdir = a["workdir"].as_str().unwrap_or(&cwd);
                        let (reads, mut unknown) = if tool == "exec_command" && a["cmd"].is_string()
                        {
                            shell_reads(s(&a, "cmd"), workdir)
                        } else {
                            (vec![], tool != "view_image")
                        };
                        let mut files=reads.into_iter().map(|p|json!({"path":p,"category":category(&p),"operation":"direct-read operand"})).collect::<Vec<_>>();
                        if tool == "view_image" {
                            if let Some(p) = path(s(&a, "path"), workdir) {
                                files.push(json!({"path":p,"category":category(&p),"operation":"image view"}))
                            } else {
                                unknown = true;
                            }
                        }
                        let output = pending.remove(id).unwrap_or(Value::Null);
                        index.insert(id.into(), calls.len());
                        calls.push(json!({"line":line,"id":id,"time":ts,"window":window,"tool":tool,"arguments":excerpt(arg,2200),"files":files,"unclassified":unknown,"priorPublicMessage":prior,"result":output}));
                    }
                    "function_call_output" | "custom_tool_call_output" => {
                        let id = s(y, "call_id");
                        let raw = y["output"]
                            .as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| y["output"].to_string());
                        let exit = raw
                            .lines()
                            .take(6)
                            .find_map(|l| l.strip_prefix("Process exited with code "))
                            .and_then(|n| n.trim().parse::<i32>().ok());
                        let status = match exit {
                            Some(0) => "exit 0",
                            Some(_) => "nonzero exit",
                            None => "recorded output; exit unknown",
                        };
                        let result = json!({"line":line,"time":ts,"status":status,"returnedBytes":raw.len(),"truncated":raw.contains("truncated output"),"excerpt":if y["output"].is_string(){excerpt(&raw,700)}else{"[structured output omitted]".into()}});
                        if let Some(i) = index.get(id) {
                            if calls[*i]["result"].is_null() {
                                calls[*i]["result"] = result
                            } else {
                                duplicates += 1
                            }
                        } else if pending.insert(id.into(), result).is_some() {
                            duplicates += 1
                        }
                    }
                    _ => {} // Never expose private reasoning or compaction replacement history.
                }
            }
            _ => {}
        }
    }
    if meta.is_null() || bindings.len() != 1 || !bindings.contains(binding) {
        return Err("exact single execution binding not established in raw trace".into());
    }
    let mut tools = BTreeMap::<String, u64>::new();
    let mut paths = BTreeMap::<(String, String), Vec<Value>>::new();
    for c in &calls {
        *tools.entry(s(c, "tool").into()).or_default() += 1;
        for f in c["files"].as_array().into_iter().flatten() {
            paths.entry((s(f,"path").into(),s(f,"operation").into())).or_default().push(json!({"callId":c["id"],"line":c["line"],"window":c["window"],"resultLine":c["result"]["line"],"resultStatus":c["result"]["status"]}));
        }
    }
    let mut files=paths.into_iter().map(|((p,op),e)|{
        let cat=category(&p);let reason=if p.contains("worker-self-review")||p.contains("ponytail"){"Possible implementation policy; review Agent scope"}else if cat=="contract"{"Possible execution contract; compare startup assignment and compaction"}else if cat=="source code"{"Possible implementation exploration; review documented interface"}else{"Review prior public message and command; cause unknown"};
        json!({"path":p,"operation":op,"category":cat,"callCount":e.len(),"repeatedAcrossCompaction":e.windows(2).any(|w|w[0]["window"]!=w[1]["window"]),"inferredReason":reason,"evidence":e})
    }).collect::<Vec<_>>();
    files.sort_by_key(|v| std::cmp::Reverse(v["callCount"].as_u64().unwrap_or(0)));
    Ok(
        json!({"source":file,"sourceBytes":len,"sha256":format!("{:x}",hash.finalize()),"records":line,"malformed":malformed,
        "metadata":meta,"binding":binding,"firstTimestamp":start,"lastTimestamp":end,
        "toolCoverage":if calls.is_empty(){"UNKNOWN"}else{"observed local records only"},"toolCalls":if calls.is_empty(){Value::Null}else{json!(calls.len())},
        "byTool":tools,"unmatchedCalls":calls.iter().filter(|c|c["result"].is_null()).count(),"unmatchedOutputs":pending.len(),"duplicates":duplicates,
        "unclassifiedCalls":calls.iter().filter(|c|c["unclassified"]==true).count(),
        "compactions":compactions,"tokenUsage":usage,"startup":context,"publicMessages":messages,"files":files,"calls":calls}),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conservative_reads() {
        let (v, u) = shell_reads(
            "cat /x/a.md && sed -n '1,20p' b.md | head -5; rg foo /x",
            "/tmp",
        );
        assert_eq!(v, vec!["/tmp/b.md", "/x/a.md"]);
        assert!(u);
        assert!(shell_reads("cat $X/a.md", "/tmp").1);
        assert!(shell_reads("cat <<EOF", "/tmp").1);
        assert_eq!(shell_reads("cat a.md > b.md", "/tmp").0, vec!["/tmp/a.md"]);
    }
    #[test]
    fn file_descriptor_and_cwd_do_not_invent_reads() {
        assert_eq!(
            shell_reads("cat a.md 2>/dev/null", "/tmp").0,
            vec!["/tmp/a.md"]
        );
        assert!(shell_reads("cd /x && cat a.md", "/tmp").0.is_empty());
        assert_eq!(
            shell_reads("cd /x && cat /x/a.md", "/tmp").0,
            vec!["/x/a.md"]
        );
    }
    #[test]
    fn raw_trace_exact_binding_and_pairing() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("trace.jsonl");
        let mut file = std::fs::File::create(&path).unwrap();
        let thread = "11111111-1111-4111-8111-111111111111";
        let binding = "job/1/task/2/execution/abc";
        let records = [
            json!({"type":"session_meta","payload":{"id":thread,"cwd":"/tmp"}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":binding}]}}),
            json!({"type":"response_item","payload":{"type":"reasoning","summary":[{"text":"must not be exported"}]}}),
            json!({"type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c1","arguments":"{\"cmd\":\"cat /tmp/contract.md\"}"}}),
            json!({"type":"response_item","payload":{"type":"function_call_output","call_id":"c1","output":"Chunk ID: x\nProcess exited with code 0\nOutput:\nhello"}}),
            json!({"type":"compacted","payload":{}}),
            json!({"type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c2","arguments":"{\"cmd\":\"cat /tmp/contract.md\"}"}}),
        ];
        for row in records {
            writeln!(file, "{}", row).unwrap();
        }
        drop(file);
        let r = analyze(&path, thread, binding).unwrap();
        assert_eq!(r["toolCalls"], 2);
        assert_eq!(r["unmatchedCalls"], 1);
        assert_eq!(r["files"][0]["callCount"], 2);
        assert_eq!(r["files"][0]["repeatedAcrossCompaction"], true);
        assert_eq!(r["calls"][0]["result"]["line"], 5);
        assert!(!r.to_string().contains("must not be exported"));
        assert!(analyze(&path, thread, "job/1/task/3/execution/abc").is_err());
    }
}
