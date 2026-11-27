//! Read-only historical Job/Task reports. Relay identifies executions and
//! supplies durable lifecycle state; raw harness JSONL supplies observed behavior.
mod builders;
pub mod compare;
mod trace;
use crate::{process_guard, workspace};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use trace::{excerpt, s};
fn cli(args: &[&str]) -> Result<Value, String> {
    let mut cmd = Command::new(crate::prompt_parts_client::relay_cli()?);
    cmd.args(args);
    let r = process_guard::capture(&mut cmd, Duration::from_secs(30), 32 * 1024 * 1024)?;
    if !r.status.success() {
        return Err(format!(
            "Relay read failed: {}",
            r.status.code().unwrap_or(-1)
        ));
    }
    serde_json::from_slice(&r.stdout).map_err(|_| "invalid Relay response".into())
}
fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 20 && s.bytes().all(|b| b.is_ascii_digit())
}
fn opts(args: &[String]) -> Result<BTreeMap<String, String>, String> {
    let mut out = BTreeMap::new();
    let mut a = args.chunks_exact(2);
    for pair in &mut a {
        if !matches!(
            pair[0].as_str(),
            "--job-id"
                | "--task-id"
                | "--execution-id"
                | "--project"
                | "--repo"
                | "--mode"
                | "--format"
        ) {
            return Err(format!("unknown report option {}", pair[0]));
        }
        if pair[1].is_empty()
            || pair[1].starts_with('-')
            || out.insert(pair[0].clone(), pair[1].clone()).is_some()
        {
            return Err("missing or repeated report option".into());
        }
    }
    if !a.remainder().is_empty() {
        return Err("report option requires a value".into());
    }
    for k in ["--job-id", "--task-id"] {
        if out.get(k).is_some_and(|v| !valid_id(v)) {
            return Err("invalid Job/Task ID".into());
        }
    }
    if let Some(id) = out.get("--execution-id") {
        if uuid::Uuid::parse_str(id).is_err() || !out.contains_key("--task-id") {
            return Err("execution ID requires exact Task and UUID".into());
        }
    }
    Ok(out)
}
// Cursor is a provider-issued opaque token, NOT a JSON string literal.
// Keep numeric cursors explicit for Relay variants that publish numeric IDs.
fn cursor_value(page: &Value) -> Option<String> {
    match page.get("nextCursor")? {
        Value::String(value) if !value.is_empty() => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}
fn event_rows(repo: &str, job: &str, task: &str) -> Value {
    let mut rows = Vec::new();
    let mut cursor = String::new();
    let mut seen = std::collections::HashSet::new();
    for _ in 0..100 {
        let mut args = vec![
            "task",
            "events",
            "--repo",
            repo,
            "--id",
            job,
            "--task-id",
            task,
            "--limit",
            "60",
            "--order",
            "asc",
        ];
        if !cursor.is_empty() {
            args.extend(["--after", &cursor]);
        }
        let Ok(page) = cli(&args) else {
            return json!({"coverage":"UNKNOWN/partial","rows":rows});
        };
        if s(&page, "jobId") != job || s(&page, "taskId") != task {
            return json!({"coverage":"identity mismatch","rows":rows});
        }
        for e in page["events"].as_array().into_iter().flatten() {
            let id = s(e, "event_id");
            if !id.is_empty() && seen.insert(id.to_owned()) {
                rows.push(json!({"id":id,"type":e["type"],"timestamp":e["timestamp"],"source":e["source"]["id"],"message":excerpt(s(e,"message"),1000)}));
            }
        }
        if page["morePossible"] != true {
            return json!({"coverage":"Relay readback","rows":rows});
        }
        let Some(next) = cursor_value(&page) else {
            break;
        };
        if next == cursor {
            break;
        }
        cursor = next;
    }
    json!({"coverage":"UNKNOWN/partial pagination","rows":rows})
}
fn duration(start: &Value, end: &Value) -> Value {
    let dt = |v: &Value| {
        v.as_str()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
    };
    match (dt(start), dt(end)) {
        (Some(a), Some(b)) if b >= a => json!((b - a).num_milliseconds()),
        _ => Value::Null,
    }
}
fn task_report(
    job: &Value,
    t: &Value,
    execution: Option<&str>,
    home: &Path,
) -> Result<Value, String> {
    let id = s(t, "id");
    let jid = s(job, "id");
    let repo = s(job, "repository");
    let events = event_rows(repo, jid, id);
    let mut histories = t["executionHistory"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if let Some(active) = t["executionId"].as_str().filter(|a| !a.is_empty()) {
        if !histories.iter().any(|h| s(h, "id") == active) {
            histories.push(json!({"id":active,"attempt":t["attempt"]}));
        }
    }
    if let Some(e) = execution {
        if !histories.iter().any(|h| s(h, "id") == e) {
            return Err("execution not recorded for selected Task".into());
        }
    }
    let total = histories.len();
    let mut attempts = Vec::new();
    for (idx, h) in histories.into_iter().enumerate() {
        let eid = s(&h, "id");
        if execution.is_some_and(|e| e != eid) {
            continue;
        }
        let binding = format!("job/{jid}/task/{id}/execution/{eid}");
        let last = idx + 1 == total;
        let thread = h["threadId"]
            .as_str()
            .filter(|s| !s.is_empty())
            .or_else(|| {
                if last {
                    t["threadId"].as_str().filter(|s| !s.is_empty())
                } else {
                    None
                }
            });
        let rows = events["rows"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|e| s(e, "source") == binding)
            .cloned()
            .collect::<Vec<_>>();
        let terminal = rows
            .iter()
            .rev()
            .find(|e| matches!(s(e, "type"), "task.completed" | "task.failed"))
            .cloned()
            .unwrap_or(Value::Null);
        let trace = builders::build(t, &h, last, thread, &binding, home);
        attempts.push(json!({"executionId":eid,"attempt":h["attempt"],"startedAt":h["startedAt"],"terminal":terminal,
            "durationMs":duration(&h["startedAt"],&terminal["timestamp"]),"threadId":thread,"events":rows,"trace":trace}));
    }
    let proof = &t["result"]["data"]["dag_result_proof"];
    let artifacts = proof["artifacts"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|a| json!({"path":a["path"],"sha256":a["sha256"]}))
        .collect::<Vec<_>>();
    let input_sha = format!("{:x}", Sha256::digest(t["input"].to_string().as_bytes()));
    Ok(
        json!({"id":id,"inputSha256":input_sha,"agent":t["agentName"],"title":excerpt(s(t,"title"),400),"state":t["state"],"adapter":t["adapter"],"reportKind":builders::task_kind(t,&attempts),
        "dependencies":t["dependencies"],"createdAt":t["createdAt"],"updatedAt":t["updatedAt"],"recordedTaskSpanMs":duration(&t["createdAt"],&t["updatedAt"]),
        "route":{"provider":t["routing"]["provider"],"profile":t["routing"]["profile"],"model":t["routing"]["model"],"reasoning":t["routing"]["reasoning"]},
        "resultSummary":excerpt(s(&t["result"],"summary"),1000),"recordedArtifacts":artifacts,"recordedOutputProof":proof["resultSha256"],
        "eventCoverage":events["coverage"],"attempts":attempts}),
    )
}
fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
fn val(v: &Value) -> String {
    if v.is_null() {
        "UNKNOWN".into()
    } else if let Some(s) = v.as_str() {
        esc(s)
    } else {
        esc(&v.to_string())
    }
}
fn html(report: &Value) -> String {
    use std::fmt::Write;
    let mut h=String::from("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width, initial-scale=1'><title>Agent execution report</title><style>body{font:15px system-ui;max-width:1200px;margin:24px auto;padding:0 16px;color:#222}table{border-collapse:collapse;width:100%;table-layout:auto}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;padding:8px}summary{cursor:pointer}details{margin:12px 0}small{color:#555}input{padding:8px;width:90%}textarea{width:95%;min-height:80px}section{border-top:1px solid #bbb;padding:15px 0}.path{font-family:monospace;font-size:12px}</style>");
    let _=write!(h,"<h1>Job {} · {}</h1><p>State: {} · Capture: {} · Recorded job span (ms): {}</p><p>Raw JSONL is the source of observed Agent behavior. Relay records identify execution and durable lifecycle. File operands are inferred from recorded commands, not filesystem audit. Unknown coverage is not zero. Reasons are hypotheses for human review.</p><input id=filter placeholder='Filter file inventory by path or category'><h2>Tasks</h2><table><tr><th>Task / Agent</th><th>State / report kind</th><th>Dependencies</th><th>Recorded span ms</th><th>Attempts</th></tr>",val(&report["job"]["id"]),val(&report["job"]["title"]),val(&report["job"]["state"]),val(&report["capturedAt"]),val(&report["job"]["recordedSpanMs"]));
    for t in report["tasks"].as_array().into_iter().flatten() {
        let _=write!(h,"<tr><td><a href='#task-{}'>{} {}</a></td><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>",val(&t["id"]),val(&t["id"]),val(&t["agent"]),format!("{} / {}",val(&t["state"]),val(&t["reportKind"])),val(&t["dependencies"]),val(&t["recordedTaskSpanMs"]),t["attempts"].as_array().map_or(0,Vec::len));
    }
    h.push_str("</table>");
    for t in report["tasks"].as_array().into_iter().flatten() {
        let _=write!(h,"<section id='task-{}'><h2>Task {} · {}</h2><p>{} · {} · {}</p><p>Recorded result: {}</p><details><summary>Recorded artifact proof (historical; not revalidated)</summary><pre>{}</pre></details>",val(&t["id"]),val(&t["id"]),val(&t["agent"]),val(&t["state"]),val(&t["route"]),val(&t["eventCoverage"]),val(&t["resultSummary"]),val(&t["recordedArtifacts"]));
        for a in t["attempts"].as_array().into_iter().flatten() {
            let tr = &a["trace"];
            let prefix = format!("{}-{}", s(t, "id"), s(a, "executionId"));
            let _=write!(h,"<h3>Attempt {} · {}</h3><p>Builder: {} · harness: {} · provenance: {}<br>Duration from recorded start to terminal (ms): {} · coverage: {} · tool calls: {} · compactions: {} · unclassified: {} · unmatched calls: {}</p><p>{}</p><details><summary>Relay lifecycle events</summary><pre>{}</pre></details>",val(&a["attempt"]),val(&a["executionId"]),val(&tr["reportBuilder"]),val(&tr["harness"]),val(&tr["harnessProvenance"]),val(&a["durationMs"]),val(&tr["toolCoverage"]),val(&tr["toolCalls"]),tr["compactions"].as_array().map(|v|v.len().to_string()).unwrap_or("UNKNOWN".into()),val(&tr["unclassifiedCalls"]),val(&tr["unmatchedCalls"]),val(&tr["reason"]),val(&a["events"]));
            if !tr["calls"].is_array() {
                continue;
            }
            let _=write!(h,"<p>Raw trace: <span class=path>{}</span><br>SHA256: {} · captured bytes: {} · lines: {} · malformed: {}<br>Tools: {}<br>Reported cumulative tokens: {}</p><details><summary>Observed startup messages</summary>",val(&tr["source"]),val(&tr["sha256"]),val(&tr["sourceBytes"]),val(&tr["records"]),val(&tr["malformed"]),val(&tr["byTool"]),val(&tr["tokenUsage"]));
            for c in tr["startup"].as_array().into_iter().flatten() {
                let _=write!(h,"<details><summary>Line {} · {} · {} · {} characters</summary><pre>{}</pre></details>",val(&c["line"]),val(&c["role"]),val(&c["kind"]),val(&c["characters"]),val(&c["excerpt"]));
            }
            h.push_str("</details><h4>File inventory · observed operands, not confirmed reads</h4><table class=files><tr><th>Path</th><th>Kind / operation</th><th>Calls</th><th>Across compaction</th><th>Inferred cause</th><th>Evidence</th></tr>");
            for f in tr["files"].as_array().into_iter().flatten() {
                let links = f["evidence"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|e| {
                        format!(
                            "<a href='#call-{}-{}'>L{}</a>",
                            esc(&prefix),
                            val(&e["line"]),
                            val(&e["line"])
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(" ");
                let _=write!(h,"<tr class=file><td class=path>{}</td><td>{} / {}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>",val(&f["path"]),val(&f["category"]),val(&f["operation"]),val(&f["callCount"]),val(&f["repeatedAcrossCompaction"]),val(&f["inferredReason"]),links);
            }
            h.push_str("</table><details open><summary>Observed tool timeline · expand individual calls</summary>");
            for c in tr["calls"].as_array().into_iter().flatten() {
                let _=write!(h,"<details id='call-{}-{}'><summary>L{} · {} · {} · window {} · {}</summary><p>Call ID: {} · result line {} · bytes {}</p><p>Preceding public message (not proof of motive):</p><pre>{}</pre><p>Arguments:</p><pre>{}</pre><p>Recorded result:</p><pre>{}</pre></details>",esc(&prefix),val(&c["line"]),val(&c["line"]),val(&c["time"]),val(&c["tool"]),val(&c["window"]),val(&c["result"]["status"]),val(&c["id"]),val(&c["result"]["line"]),val(&c["result"]["returnedBytes"]),val(&c["priorPublicMessage"]["text"]),val(&c["arguments"]),val(&c["result"]["excerpt"]));
            }
            h.push_str("</details>");
        }
        h.push_str("</section>");
    }
    h.push_str(r##"<h2>Human findings</h2><p>Record evidence line / Task, issue, proposed owner and decision. Download separate private review JSON; the source report remains unchanged.</p><textarea id=notes placeholder='Evidence / finding / proposed change'></textarea><select id=verdict><option>NOT_REVIEWED</option><option>PASS</option><option>CHANGE_REQUIRED</option><option>UNKNOWN</option></select><button id=save>Save review JSON</button><script>document.querySelector('#filter').oninput=e=>document.querySelectorAll('tr.file').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(e.target.value.toLowerCase()));document.querySelectorAll('a[href^="#call-"]').forEach(a=>a.onclick=()=>{let d=document.getElementById(a.hash.slice(1));if(d){d.open=true;let p=d.parentElement;if(p.tagName==='DETAILS')p.open=true}});document.querySelector('#save').onclick=()=>{let data={source:location.pathname,reviewedAt:new Date().toISOString(),verdict:document.querySelector('#verdict').value,findings:document.querySelector('#notes').value};let a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='agent-review.json';a.click();URL.revokeObjectURL(a.href)};</script>"##);
    h
}
fn private_report(base: &Path, report: &Value, rendered: &str) -> Result<PathBuf, String> {
    // Refuse redirected report roots. Non-Neo repository reports live outside
    // Git in a private per-user directory.
    for p in [base.parent().ok_or("Invalid report directory")?, base] {
        match fs::symlink_metadata(p) {
            Ok(m) if m.is_dir() && !m.file_type().is_symlink() => {}
            Ok(_) => return Err("unsafe report directory".into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let mut builder = fs::DirBuilder::new();
                #[cfg(unix)]
                {
                    use std::os::unix::fs::DirBuilderExt;
                    builder.mode(0o700);
                }
                builder.create(p).map_err(|e| e.to_string())?
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    let p = base.join(format!(
        "execution-{}-{}",
        chrono::Utc::now().format("%Y%m%dT%H%M%SZ"),
        uuid::Uuid::new_v4().simple()
    ));
    fs::create_dir(&p).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&p, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
        use std::io::Write;
        let mut opt = fs::OpenOptions::new();
        opt.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opt.mode(0o600);
        }
        let mut f = opt.open(path).map_err(|e| e.to_string())?;
        f.write_all(bytes)
            .and_then(|_| f.sync_all())
            .map_err(|e| e.to_string())
    }
    write(
        &p.join("report.json"),
        &serde_json::to_vec_pretty(report).map_err(|e| e.to_string())?,
    )?;
    write(&p.join("report.html"), rendered.as_bytes())?;
    Ok(p)
}
// The latest snapshot must match the exact requested scope. A single-task
// snapshot is never reused as a Job report; historical reports without a
// recorded selection are intentionally not guessed.
fn latest_report(
    base: &Path,
    root: &Path,
    job: &Value,
    opt: &BTreeMap<String, String>,
) -> Result<PathBuf, String> {
    for p in [base.parent().ok_or("Invalid report directory")?, base] {
        if !fs::symlink_metadata(p).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink()) {
            return Err("No saved report for this scope".into());
        }
    }
    let mut dirs = fs::read_dir(base)
        .map_err(|_| "No saved report for this scope")?
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("execution-"))
        .map(|e| e.path())
        .collect::<Vec<_>>();
    dirs.sort();
    dirs.reverse();
    let selection = json!({"taskId":opt.get("--task-id"),"executionId":opt.get("--execution-id")});
    for p in dirs {
        if !fs::symlink_metadata(&p).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink()) {
            continue;
        }
        let data = p.join("report.json");
        let html = p.join("report.html");
        if ![&data, &html].iter().all(|f| {
            fs::symlink_metadata(f).is_ok_and(|m| {
                m.is_file() && !m.file_type().is_symlink() && m.len() <= 32 * 1024 * 1024
            })
        }) {
            continue;
        }
        let Ok(v) = fs::read(data)
            .map_err(|_| ())
            .and_then(|b| serde_json::from_slice::<Value>(&b).map_err(|_| ()))
        else {
            continue;
        };
        if v["schema"] == "neo.execution-report.v1"
            && v["job"]["id"] == job["id"]
            && v["job"]["repository"] == job["repository"]
            && v["job"]["projectRoot"] == json!(root)
            && v["selection"] == selection
        {
            return Ok(p);
        }
    }
    Err("No saved report for this scope; generate one first".into())
}
// Viewer transport re-renders normalized JSON, never serves arbitrary
// saved HTML. The caller still must sandbox the generated HTML.
fn print_receipt(dir: &Path, report: &Value, viewer: bool) -> Result<(), String> {
    let mut result = json!({"jobId":report["job"]["id"],"repository":report["job"]["repository"],"selection":report["selection"],
        "capturedAt":report["capturedAt"],"taskCount":report["tasks"].as_array().map_or(0,Vec::len),
        "report":dir.join("report.html"),"data":dir.join("report.json")});
    if viewer {
        let page = html(report);
        if page.len() > 16 * 1024 * 1024 {
            return Err("Viewer report exceeds 16 MiB; use local HTML".into());
        }
        result["html"] = json!(page);
    }
    println!("{}", result);
    Ok(())
}
pub fn run(args: &[String]) -> Result<i32, String> {
    let opt = opts(args)?;
    let id = opt.get("--job-id").ok_or("report requires --job-id")?;
    let mut lookup = vec!["job", "show", "--id", id.as_str()];
    if let Some(repo) = opt.get("--repo") {
        lookup.extend(["--repo", repo.as_str()]);
    }
    let job = cli(&lookup)?;
    if opt
        .get("--repo")
        .is_some_and(|repo| s(&job, "repository") != repo)
    {
        return Err("Job repository mismatch".into());
    }
    if s(&job, "id") != id {
        return Err("Job identity mismatch".into());
    }
    let root = PathBuf::from(s(&job, "projectRoot"))
        .canonicalize()
        .map_err(|_| "Job project unavailable")?;
    let ws = workspace::load()?;
    // Relay Jobs also target ordinary Git repositories (including Relay and
    // Neo themselves). Verify the exact canonical Git root supplied by Relay;
    // never use a browser-supplied path or write trace artifacts into those repos.
    let mut git = Command::new("git");
    git.arg("-C").arg(&root).args(["rev-parse", "--show-toplevel"]);
    let result = process_guard::capture(&mut git, Duration::from_secs(10), 16 * 1024)?;
    let actual = String::from_utf8_lossy(&result.stdout);
    if !result.status.success()
        || PathBuf::from(actual.trim()).canonicalize().ok().as_ref() != Some(&root)
    {
        return Err("Job project is not an independent Git repository".into());
    }
    let base = if root.parent() == Some(ws.neo_root.as_path())
        && ["AGENTS.md", "README.md", "graph.mmd"].iter().all(|name| root.join(name).is_file()) {
        root.join(".evals/reports")
    } else {
        workspace::home()?
            .canonicalize()
            .map_err(|_| "Home unavailable")?
            .join(".neo-execution-reports/reports")
    };
    if opt
        .get("--project")
        .is_some_and(|p| root.file_name().and_then(|n| n.to_str()) != Some(p))
    {
        return Err("Job project mismatch".into());
    }
    if opt
        .get("--mode")
        .is_some_and(|m| m != "generate" && m != "latest")
    {
        return Err("report mode must be generate or latest".into());
    }
    if opt
        .get("--format")
        .is_some_and(|m| m != "viewer" && m != "receipt")
    {
        return Err("report format must be receipt or viewer".into());
    }
    if opt.get("--mode").is_some_and(|m| m == "latest") {
        let dir = latest_report(&base, &root, &job, &opt)?;
        let data = fs::read(dir.join("report.json")).map_err(|_| "Saved report unavailable")?;
        let report: Value = serde_json::from_slice(&data).map_err(|_| "Invalid saved report")?;
        print_receipt(
            &dir,
            &report,
            opt.get("--format").is_some_and(|m| m == "viewer"),
        )?;
        return Ok(0);
    }
    let home = env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or(workspace::home()?.join(".codex"));
    let selected = opt.get("--task-id");
    let mut tasks = Vec::new();
    for t in job["tasks"].as_array().ok_or("Job has no task array")? {
        if selected.is_some_and(|id| s(t, "id") != id) {
            continue;
        }
        if s(t, "jobId") != id || !valid_id(s(t, "id")) {
            return Err("Task binding mismatch".into());
        }
        tasks.push(task_report(
            &job,
            t,
            opt.get("--execution-id").map(String::as_str),
            &home,
        )?);
    }
    if tasks.is_empty() {
        return Err("no matching Task".into());
    }
    let report = json!({"schema":"neo.execution-report.v1","capturedAt":chrono::Utc::now().to_rfc3339(),"selection":{"taskId":selected,"executionId":opt.get("--execution-id")},"truth":{"behavior":"raw JSONL","lifecycle":"Relay readback","fileInventory":"conservative operand analysis, not filesystem audit","reasons":"inferred; human review required"},"job":{"id":id,"title":excerpt(s(&job,"title"),400),"state":job["state"],"projectRoot":root,"repository":job["repository"],"recordedSpanMs":duration(&job["createdAt"],&job["updatedAt"])},"tasks":tasks});
    let dir = private_report(&base, &report, &html(&report))?;
    print_receipt(
        &dir,
        &report,
        opt.get("--format").is_some_and(|m| m == "viewer"),
    )?;
    Ok(0)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cursor_is_sent_as_opaque_value_not_encoded_json() {
        assert_eq!(
            cursor_value(&json!({"nextCursor":"abc/def=="})),
            Some("abc/def==".into())
        );
        assert_eq!(
            cursor_value(&json!({"nextCursor":1729})),
            Some("1729".into())
        );
        assert_eq!(cursor_value(&json!({"nextCursor":null})), None);
        assert_eq!(cursor_value(&json!({})), None);
    }
    #[test]
    fn options_reject_ambiguous() {
        assert!(opts(&["--job-id".into(), "1".into(), "--job-id".into(), "2".into()]).is_err());
        assert!(opts(&["--job-id".into(), "../x".into()]).is_err());
    }
    #[test]
    fn html_escapes() {
        assert_eq!(esc("<script>&"), "&lt;script&gt;&amp;");
    }
}
