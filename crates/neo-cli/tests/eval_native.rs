use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};
struct Fixture {
    _temp: tempfile::TempDir,
    home: PathBuf,
    root: PathBuf,
    workspace: PathBuf,
    project: PathBuf,
    bin: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        let workspace = home.join("Workspace");
        let project = workspace.join("sample");
        fs::create_dir_all(project.join(".evals")).unwrap();
        fs::create_dir_all(project.join("agents")).unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        fs::write(project.join("AGENTS.md"), "# Fixture rules").unwrap();
        fs::write(project.join("README.md"), "# Fixture").unwrap();
        fs::write(
            project.join("graph.mmd"),
            "flowchart TD\n A[agent:visioner]-->B[agent:editor]\n",
        )
        .unwrap();
        for role in ["visioner", "editor"] {
            fs::write(
                project.join(format!("agents/{role}.agent.md")),
                "# Role fixture",
            )
            .unwrap();
        }
        fs::write(project.join(".evals/cases.json"),json!([
   {"id":"visioner-choose","role":"visioner","capability":"Choose before building","task":"Plan or run?",
     "choices":["plan","run"],"expectedDecision":"plan"},
   {"id":"editor-choose","role":"editor","capability":"Choose an editing task","task":"Edit or publish?",
     "choices":["edit","publish"],"expectedDecision":"edit"}
  ]).to_string()).unwrap();
        let bin = temp.path().join("bin");
        fs::create_dir_all(&bin).unwrap();
        let code = Command::new("git")
            .args(["init", "--quiet", project.to_str().unwrap()])
            .status()
            .unwrap();
        assert!(code.success());
        Self {
            _temp: temp,
            home,
            workspace,
            root,
            project,
            bin,
        }
    }
    fn run(&self, options: &[&str]) -> Output {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_neo-rs"));
        cmd.arg("eval")
            .args(options)
            .env("HOME", &self.home)
            .env("NEO_ROOT", &self.workspace)
            .env("NEO_HARNESS_ROOT", &self.root)
            .env("NEO_RELAY_EXECUTABLE", self.bin.join("agents-relay"))
            .env(
                "PATH",
                format!("{}:/opt/homebrew/bin:/usr/bin:/bin", self.bin.display()),
            )
            .current_dir(&self.root)
            .output()
            .unwrap()
    }
    fn json(&self, args: &[&str]) -> Value {
        let reply = self.run(args);
        assert!(
            reply.status.success(),
            "{}",
            String::from_utf8_lossy(&reply.stderr)
        );
        let string = String::from_utf8(reply.stdout).unwrap();
        let start = if args.first() == Some(&"audit") {
            string.rfind("\n{").map_or(0, |i| i + 1)
        } else {
            0
        };
        serde_json::from_str(&string[start..]).unwrap()
    }
    fn fake(&self, name: &str, text: &str) {
        let path = self.bin.join(name);
        fs::write(&path, format!("#!/bin/sh\n{text}\n")).unwrap();
        #[cfg(unix)]
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }
    fn relay(&self) {
        self.fake("agents-relay",r###"
[ "$1" = prompt ] || exit 49
out=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output ]; then out="$2"; shift 2
  else shift; fi
done
printf '{"builder":"managedWorkerInput","mode":"isolated-evaluation","agentName":"visioner","adapter":"codex","productionPrompt":"# Role\\n## Contracts\\n## Contexts\\n## Task\\n","evaluationPrompt":"[Isolated prompt evaluation mode] Choose plan or run"}' > "$out"
"###);
    }
}
#[test]
fn native_eval_list_contract_without_node_or_report_writes() {
    let f = Fixture::new();
    let native = f.json(&["list", "--project", "sample"]);
    assert_eq!(native["cases"].as_array().unwrap().len(), 2);
    assert!(!f.project.join(".evals/reports").exists());
    let pure = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        .args(["eval", "list", "--project", "sample"])
        .env("HOME", &f.home)
        .env("NEO_ROOT", &f.workspace)
        .env("NEO_HARNESS_ROOT", &f.root)
        .env("PATH", "/usr/bin:/bin")
        .output()
        .unwrap();
    assert!(
        pure.status.success(),
        "{}",
        String::from_utf8_lossy(&pure.stderr)
    );
}
#[test]
fn native_eval_dag_roles_and_smoke_selection_require_missing_roles_fail_closed() {
    let f = Fixture::new();
    let result = f.json(&["list", "--project", "sample", "--dag"]);
    assert_eq!(result["dagRoles"], json!(["visioner", "editor"]));
    assert_eq!(result["cases"].as_array().unwrap().len(), 2);
    let invalid = f.run(&["list", "--project", "sample", "--smoke"]);
    assert!(!invalid.status.success());
    assert!(String::from_utf8_lossy(&invalid.stderr).contains("--smoke requires --dag"));
}

#[test]
fn native_eval_dry_run_uses_canonical_relay_builder_without_invoking_codex() {
    let f = Fixture::new();
    f.relay();
    f.fake(
        "codex",
        "echo CODEX_CALLED > \"$HOME/codex-called\"; exit 22",
    );
    let result = f.json(&[
        "run",
        "--project",
        "sample",
        "--case",
        "visioner-choose",
        "--dry-run",
    ]);
    assert_eq!(result["mode"], "dry-run");
    assert_eq!(result["executed"], 0);
    let report: Value =
        serde_json::from_slice(&fs::read(result["report"].as_str().unwrap()).unwrap()).unwrap();
    assert_eq!(report["promptSource"], "agents-relay/managedWorkerInput");
    assert_eq!(report["results"][0]["builder"], "managedWorkerInput");
    assert_eq!(report["results"][0]["status"], "DRY_RUN");
    assert!(!f.home.join("codex-called").exists());
}
#[test]
fn native_eval_local_mock_codex_exec_checks_decision_and_reports_truthfully() {
    let f = Fixture::new();
    f.relay();
    f.fake(
        "codex",
        r#"
last=''
while [ "$#" -gt 0 ]; do
 if [ "$1" = --output-last-message ]; then last="$2"; shift 2
 else shift; fi
done
cat >/dev/null
printf '%s' '{"decision":"plan","actions":["inspect docs"],"reason":"fixture"}' > "$last"
"#,
    );
    let result = f.json(&["run", "--project", "sample", "--case", "visioner-choose"]);
    assert_eq!(result["failed"], 0);
    assert_eq!(result["passed"], 1);
    let report: Value =
        serde_json::from_slice(&fs::read(result["report"].as_str().unwrap()).unwrap()).unwrap();
    assert_eq!(report["results"][0]["actual"], "plan");
    assert_eq!(report["results"][0]["status"], "PASS");
}
#[test]
fn native_eval_audit_reports_dag_role_coverage_without_mutation() {
    let f = Fixture::new();
    let result = f.json(&["audit"]);
    assert_eq!(result["projects"], 1);
    assert_eq!(result["roles"], 2);
    assert_eq!(result["rolesWithoutCases"], json!([]));
    assert_eq!(
        result["dagCoverage"]["sample"]["agents"][0]["role"],
        "visioner"
    );
    assert!(!f.project.join(".evals/reports").exists());
}
#[test]
fn native_eval_missing_case_or_relay_binary_fails_closed() {
    let f = Fixture::new();
    let invalid = f.run(&["run", "--project", "sample", "--case", "bogus"]);
    assert!(!invalid.status.success());
    assert!(invalid.stdout.is_empty());
    assert!(!f.project.join(".evals/reports").exists());
    let missing = f.run(&[
        "run",
        "--project",
        "sample",
        "--case",
        "visioner-choose",
        "--dry-run",
    ]);
    assert!(!missing.status.success());
    assert!(
        String::from_utf8_lossy(&missing.stderr).contains("spawn error")
            || String::from_utf8_lossy(&missing.stderr).contains("Relay PromptBuilder")
    );
}

#[test]
fn native_eval_audit_remains_usable_without_removed_node_graph_parser() {
    let f = Fixture::new();
    let native = f.json(&["audit"]);
    assert_eq!(native["projects"], 1);
    assert_eq!(native["roles"], 2);
    assert_eq!(native["rolesWithCases"], 2);
    assert_eq!(
        native["dagCoverage"]["sample"]["agents"][0]["role"],
        "visioner"
    );
}
