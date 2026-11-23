use serde_json::Value;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

struct Fixture {
    _dir: tempfile::TempDir,
    home: PathBuf,
    harness: PathBuf,
    project: PathBuf,
    agency: PathBuf,
}

fn put(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        let harness = dir.path().join("harness");
        let project = dir.path().join("project");
        let agency = home.join(".local/share/agency-agents/integrations/dsh");
        put(
            &harness.join("agents/reviewer.agent.md"),
            "---\nname: reviewer\ndescription: Shared code reviewer\n---\n",
        );
        put(
            &harness.join("agents/author.agent.md"),
            "---\nname: author\ndescription: Prepare a draft\ntype: worker\n---\n",
        );
        put(
            &project.join("agents/reviewer.agent.md"),
            "---\nname: reviewer\ndescription: Project-specific reviewer\n---\n",
        );
        put(&project.join("AGENTS.md"), "# Project\n");
        put(&project.join("README.md"), "# Project\n");
        put(
            &home.join(".agents/agents/reviewer.agent.md"),
            "---\nname: reviewer\ndescription: Global reviewer\n---\n",
        );
        put(&agency.join("agency-code-reviewer/SKILL.md"), "---\nname: 'agency-code-reviewer'\ndescription: 'Expert code review specialist'\n---\n");
        put(&agency.join("agency-product-strategist/SKILL.md"), "---\nname: agency-product-strategist\ndescription: Product research and strategy\n---\n");
        fs::create_dir_all(home.join("Workspace")).unwrap();
        Self {
            _dir: dir,
            home,
            harness,
            project,
            agency,
        }
    }

    fn native(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_neo-rs"))
            .args(args)
            .current_dir(&self.project)
            .env("HOME", &self.home)
            .env("NEO_HARNESS_ROOT", &self.harness)
            .env_remove("NEO_WORKSPACE_CONFIG")
            .env_remove("NEO_ROOT")
            .output()
            .unwrap()
    }

    fn oracle(&self, args: &[&str]) -> Option<Output> {
        if Command::new("node").arg("--version").output().is_err() {
            return None;
        }
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let code = r#"const {runAgentDiscovery}=await import(process.env.NEO_ORACLE_MODULE);
try {
const result=runAgentDiscovery(process.argv.slice(2), {
  neoRoot: process.env.NEO_HARNESS_ROOT,
  home: process.env.HOME,
  cwd: process.cwd(),
  agencyDirectory: process.env.NEO_AGENCY_ROOT
});
process.stdout.write(JSON.stringify(result,null,2)+'\n');
} catch(e) { console.error(e.message); process.exitCode=1; }"#;
        Some(
            Command::new("node")
                .args(["--input-type=module", "--eval", code])
                .args(args)
                .current_dir(&self.project)
                .env("HOME", &self.home)
                .env("NEO_HARNESS_ROOT", &self.harness)
                .env("NEO_AGENCY_ROOT", &self.agency)
                .env("NEO_ORACLE_MODULE", repo.join(".bin/neo-agent-catalog.mjs"))
                .output()
                .unwrap(),
        )
    }
}

fn as_json(data: &[u8]) -> Value {
    serde_json::from_slice(data)
        .unwrap_or_else(|e| panic!("invalid JSON: {e}; raw={}", String::from_utf8_lossy(data)))
}

fn parity(f: &Fixture, args: &[&str]) {
    let native = f.native(args);
    let Some(node) = f.oracle(args) else { return };
    assert_eq!(
        native.status.code(),
        node.status.code(),
        "status for {args:?}: rust={} node={}",
        String::from_utf8_lossy(&native.stderr),
        String::from_utf8_lossy(&node.stderr)
    );
    if native.status.success() {
        assert_eq!(
            as_json(&native.stdout),
            as_json(&node.stdout),
            "JSON for {args:?}"
        );
    } else {
        assert!(
            native.stdout.is_empty(),
            "native must not emit success data on error"
        );
        assert!(
            !native.stderr.is_empty(),
            "native failure must explain the cause"
        );
    }
}

#[test]
fn catalog_precedence_and_json_contract() {
    let f = Fixture::new();
    for args in [
        vec!["agent", "list"],
        vec!["agent", "list", "--source", "project"],
        vec!["agent", "list", "--source", "shared"],
        vec!["agent", "list", "--source", "agency"],
        vec!["agent", "search", "code", "review"],
        vec!["agent", "search", "review", "--limit", "1"],
        vec!["agent", "search", "draft", "--source", "shared"],
    ] {
        parity(&f, &args);
    }
    let output = f.native(&["agent", "list"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let rows = as_json(&output.stdout);
    assert_eq!(
        rows.as_array()
            .unwrap()
            .iter()
            .filter(|x| x["name"] == "reviewer" && x["effective"] == true)
            .count(),
        1
    );
    assert_eq!(
        rows.as_array()
            .unwrap()
            .iter()
            .find(|x| x["source"] == "project")
            .unwrap()["effective"],
        true
    );
}

#[test]
fn rejects_invalid_arguments_without_stdout() {
    let f = Fixture::new();
    for args in [
        vec!["agent"],
        vec!["agent", "search"],
        vec!["agent", "list", "--limit", "1"],
        vec!["agent", "list", "--source", "unknown"],
        vec!["agent", "search", "review", "--limit", "0"],
        vec!["agent", "search", "review", "--limit", "284"],
        vec!["agent", "list", "--unknown"],
    ] {
        parity(&f, &args);
    }
}

#[test]
fn missing_agency_is_explicit_failure() {
    let f = Fixture::new();
    fs::remove_dir_all(&f.agency).unwrap();
    parity(&f, &["agent", "list"]);
    let output = f.native(&["agent", "list"]);
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("Agency Agents library unavailable"));
}

#[test]
fn explicit_relative_project_path_is_lexically_normalized() {
    let f = Fixture::new();
    // Node path.resolve removes "agents/.." without resolving symlink identity.
    parity(
        &f,
        &[
            "agent",
            "list",
            "--source",
            "project",
            "--project",
            "agents/..",
        ],
    );
    parity(&f, &["agent", "search", "review", "--limit", "1.0"]);
}

#[test]
fn native_does_not_need_node_in_path() {
    let f = Fixture::new();
    let output = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        .args(["agent", "list", "--source", "shared"])
        .current_dir(&f.project)
        .env("HOME", &f.home)
        .env("NEO_HARNESS_ROOT", &f.harness)
        .env("PATH", "")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(as_json(&output.stdout).as_array().unwrap().len(), 2);
}

#[test]
fn unsupported_command_fails_closed() {
    let f = Fixture::new();
    let output = f.native(&["project", "run"]);
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("not yet supported"));
}
