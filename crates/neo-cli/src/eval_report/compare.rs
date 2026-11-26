//! No guessed zeros: compare only matched, fully observed executions.
use super::{esc, private_report};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};
fn load(p: &Path) -> Result<Value, String> {
    if !p.is_absolute() {
        return Err("Reports must be absolute paths".into());
    }
    let meta = fs::symlink_metadata(p).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 32 * 1024 * 1024 {
        return Err("Unsafe report".into());
    }
    let v: Value = serde_json::from_slice(&fs::read(p).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if v["schema"] != "neo.execution-report.v1" || !v["tasks"].is_array() {
        return Err("Requires execution-report.v1".into());
    }
    Ok(v)
}
fn metrics(t: &Value) -> Option<Value> {
    let attempts = t["attempts"].as_array()?;
    if attempts.len() != 1 {
        return None;
    }
    let a = &attempts[0];
    let x = &a["trace"];
    if x["toolCoverage"] != "observed local records only"
        || !x["toolCalls"].is_number()
        || x["unmatchedCalls"] != 0
        || x["unmatchedOutputs"] != 0
        || x["malformed"] != 0
        || x["duplicates"] != 0
    {
        return None;
    }
    Some(
        json!({"toolCalls":x["toolCalls"],"compactions":x["compactions"].as_array()?.len(),
        "fileOperands":x["files"].as_array()?.iter().map(|f|f["callCount"].as_u64().unwrap_or(0)).sum::<u64>(),
        "unclassifiedCalls":x["unclassifiedCalls"],"durationMs":a["durationMs"],
        "reportedTokens":x["tokenUsage"],"state":t["state"]}),
    )
}
pub(crate) fn compare(a: &Value, b: &Value) -> Result<Value, String> {
    if a["job"]["projectRoot"] != b["job"]["projectRoot"]
        || a["job"]["repository"] != b["job"]["repository"]
    {
        return Err("Cannot compare reports from different projects".into());
    }
    let old = a["tasks"].as_array().ok_or("Missing baseline Tasks")?;
    let new = b["tasks"].as_array().ok_or("Missing candidate Tasks")?;
    let mut rows = vec![];
    for first in old {
        let agent = first["agent"].as_str().unwrap_or("");
        let matches = new
            .iter()
            .filter(|t| t["agent"] == first["agent"])
            .collect::<Vec<_>>();
        if agent.is_empty()
            || matches.len() != 1
            || old.iter().filter(|t| t["agent"] == first["agent"]).count() != 1
        {
            rows.push(json!({"agent":agent,"comparable":false,"reason":"Missing or ambiguous Agent role"}));
            continue;
        }
        let second = matches[0];
        let same = first["inputSha256"].as_str().is_some_and(|x| !x.is_empty())
            && first["inputSha256"] == second["inputSha256"]
            && first["route"] == second["route"];
        let left = metrics(first);
        let right = metrics(second);
        let comparable = same && left.is_some() && right.is_some();
        let mut delta = serde_json::Map::new();
        if let (true, Some(l), Some(r)) = (comparable, &left, &right) {
            for key in [
                "toolCalls",
                "compactions",
                "fileOperands",
                "unclassifiedCalls",
                "durationMs",
            ] {
                if let (Some(a), Some(b)) = (l[key].as_i64(), r[key].as_i64()) {
                    delta.insert(key.into(), json!(b - a));
                }
            }
        }
        rows.push(json!({"agent":agent,"baselineTask":first["id"],"candidateTask":second["id"],
            "comparable":comparable,"reason":if !same{"Different input or model route"}else if !comparable{"Incomplete raw JSONL"}else{"Matched"},
            "baseline":left,"candidate":right,"candidateMinusBaseline":delta}));
    }
    Ok(
        json!({"schema":"neo.execution-comparison.v1","projectRoot":a["job"]["projectRoot"],
        "baselineJob":a["job"]["id"],"candidateJob":b["job"]["id"],
        "rows":rows,"matched":rows.iter().filter(|r|r["comparable"]==true).count()}),
    )
}
fn html(report: &Value) -> String {
    use std::fmt::Write;
    let mut h=String::from("<!doctype html><meta charset=utf-8><title>Execution comparison</title><style>body{font:15px system-ui;margin:3rem auto;max-width:1100px;padding:1rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:10px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Execution comparison</h1><p>Only matched Agent/input/route and complete observable JSONL are comparable. Missing traces are UNKNOWN, not zero. Outcome quality requires independent review.</p><table><tr><th>Agent</th><th>Comparable</th><th>Baseline</th><th>Candidate</th><th>Δ candidate - baseline</th></tr>");
    for row in report["rows"].as_array().into_iter().flatten() {
        let _=write!(h,"<tr><td>{}</td><td>{} ({})</td><td><pre>{}</pre></td><td><pre>{}</pre></td><td><pre>{}</pre></td></tr>",
            super::val(&row["agent"]),super::val(&row["comparable"]),super::val(&row["reason"]),
            esc(&row["baseline"].to_string()),esc(&row["candidate"].to_string()),esc(&row["candidateMinusBaseline"].to_string()));
    }
    h.push_str("</table>");
    h
}
pub fn run(args: &[String]) -> Result<i32, String> {
    if args.len() != 4 || args[0] != "--baseline" || args[2] != "--candidate" {
        return Err(
            "usage: neo eval compare --baseline ABS/report.json --candidate ABS/report.json".into(),
        );
    }
    let a = load(Path::new(&args[1]))?;
    let b = load(Path::new(&args[3]))?;
    let report = compare(&a, &b)?;
    let root = PathBuf::from(
        report["projectRoot"]
            .as_str()
            .ok_or("Invalid projectRoot")?,
    );
    let folder = private_report(&root, &report, &html(&report))?;
    println!(
        "{}",
        json!({"comparison":folder.join("report.html"),"data":folder.join("report.json"),"matched":report["matched"]})
    );
    Ok(0)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matched_and_unknown_are_distinct() {
        let f = |input: &str, calls: usize| {
            json!({"job":{"repository":"p","projectRoot":"/tmp/p"},
            "tasks":[{"id":"1","agent":"editor","inputSha256":input,"route":{"model":"m"},"attempts":[{
                "durationMs":100,"trace":{"toolCoverage":"observed local records only","toolCalls":calls,
                "compactions":[],"files":[],"unmatchedCalls":0,"unmatchedOutputs":0,"malformed":0,"duplicates":0}}]}]})
        };
        let r = compare(&f("same", 10), &f("same", 6)).unwrap();
        assert_eq!(r["rows"][0]["comparable"], true);
        assert_eq!(r["rows"][0]["candidateMinusBaseline"]["toolCalls"], -4);
        assert_eq!(
            compare(&f("same", 10), &f("other", 6)).unwrap()["rows"][0]["comparable"],
            false
        );
    }
}
