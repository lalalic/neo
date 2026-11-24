//! Durable local E2E: canonical Run inputs and private Run Git are real, while
//! the external Relay CLI is a fixture preserving its JSON protocol/state.
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

const RELAY_STUB: &str = r#"#!/usr/bin/env python3
import json,os,sys,pathlib,time
args=sys.argv[1:]
root=pathlib.Path(os.environ['RELAY_FIXTURE_ROOT'])
state_path=root/'state.json'
state=json.loads(state_path.read_text()) if state_path.exists() else {'creates':0,'calls':[],'jobs':{}}
def val(flag):
    return args[args.index(flag)+1]
cmd=':'.join(args[:2]);state['calls'].append(cmd)
def persist():state_path.write_text(json.dumps(state))
if (root/('fail-'+cmd.replace(':','-'))).exists():
    persist();sys.exit(7)
if cmd=='job:create':
    if args.count('--preflight=true')!=1:
        persist();sys.stderr.write('JOB_PREFLIGHT_REQUIRED\n');sys.exit(2)
    if (root/'slow-create').exists():time.sleep(.25)
    project=val('--repo');jid=str(101+state['creates']);state['creates']+=1
    state['create_args']=args
    task={'id':'17','input':pathlib.Path(val('--coordinator-input-file')).read_text(),
      'agentGraph':pathlib.Path(val('--coordinator-graph-file')).read_text(),
      'output':{'kind':'file','path':val('--coordinator-output-path')}}
    state['jobs'][jid]={'id':jid,'repository':project,'projectRoot':val('--project-root'),
       'state':'DRAFT','task':task}
    persist();print(json.dumps({'repository':project,'pr':0,'job':'old-id' if (root/'bad-job-id').exists() else jid,
        'state':'DRAFT','taskId':'coordinator' if (root/'bad-task-id').exists() else '17'}))
elif cmd=='job:show':
    job=state['jobs'].get(val('--id'))
    persist();print(json.dumps(job or {}))
elif cmd=='task:list':
    job=state['jobs'].get(val('--id'))
    persist();print(json.dumps({'tasks':[job['task']] if job else []}))
elif cmd=='job:run':
    job=state['jobs'].get(val('--id'))
    if not job: sys.exit(4)
    job['state']='ACTIVE'
    persist()
    if '--foreground' in args:print('FOREGROUND_EVENT_JOB_'+job['id'])
    else:print(json.dumps({'scheduled':True,'state':'ACTIVE','jobId':job['id'],'taskId':'17'}))
else:
    persist();sys.stderr.write('unexpected Relay operation '+cmd+'\n');sys.exit(3)
"#;

fn put(path: &Path, s: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, s).unwrap();
}
struct Fixture {
    _tmp: tempfile::TempDir,
    home: PathBuf,
    workspace: PathBuf,
    run: PathBuf,
    config: PathBuf,
    relay: PathBuf,
    state_root: PathBuf,
    repo: PathBuf,
    node: String,
}
impl Fixture {
    fn new() -> Self {
        Self::new_named("sample")
    }
    fn new_named(name: &str) -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        let workspace = tmp.path().join("workspace");
        let project = workspace.join(name);
        let run = project.join("runs/2026-11-03-episode");
        fs::create_dir_all(&run).unwrap();
        for file in ["AGENTS.md", "README.md"] {
            put(&project.join(file), "project contract\n");
        }
        put(
            &project.join("graph.mmd"),
            "flowchart TD\n  A[agent:writer]-->B\n",
        );
        put(
            &project.join("project.run.json"),
            r#"{"schemaVersion":1,"input":{"type":"path","path":{"base":"runs","datedRunDirectory":true}},"versioning":{"mode":"local-git","template":"run-template"}}"#,
        );
        put(
            &project.join("run-template/.gitignore"),
            ".neo-project-run.json\nsource-reference.json\nneo-project-run.*\nprivate-media/\n",
        );
        assert!(Command::new("git")
            .args(["init", "-q"])
            .arg(&project)
            .output()
            .unwrap()
            .status
            .success());
        fs::create_dir_all(home.join(".agents")).unwrap();
        let config = tmp.path().join("workspace.json");
        put(
            &config,
            &format!(
                "{{\"schemaVersion\":1,\"neoRoot\":\"{}\"}}",
                workspace.display()
            ),
        );
        let state_root = tmp.path().join("stub-state");
        fs::create_dir_all(&state_root).unwrap();
        let relay = tmp.path().join("agents-relay-stub");
        put(&relay, RELAY_STUB);
        #[cfg(unix)]
        fs::set_permissions(&relay, fs::Permissions::from_mode(0o755)).unwrap();
        let node = String::from_utf8(
            Command::new("node")
                .args(["-p", "process.execPath"])
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .into();
        let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        Self {
            _tmp: tmp,
            home,
            workspace,
            run,
            config,
            relay,
            state_root,
            repo,
            node,
        }
    }
    fn call(&self, native: bool, args: &[&str]) -> Output {
        let mut cmd = if native {
            Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        } else {
            Command::new(&self.node)
        };
        if !native {
            cmd.arg(self.repo.join(".bin/neo.mjs"));
        }
        cmd.args(["project", "run"])
            .args(args)
            .env("HOME", &self.home)
            .env("NEO_WORKSPACE_CONFIG", &self.config)
            .env("NEO_ROOT", &self.workspace)
            .env("NEO_RELAY_EXECUTABLE", &self.relay)
            .env("RELAY_FIXTURE_ROOT", &self.state_root)
            .current_dir(&self.workspace)
            .output()
            .unwrap()
    }
    fn run(&self, native: bool) -> Output {
        self.call(
            native,
            &["--project", "sample", "--path", self.run.to_str().unwrap()],
        )
    }
    fn state(&self) -> Value {
        serde_json::from_slice(&fs::read(self.state_root.join("state.json")).unwrap()).unwrap()
    }
    fn assert_success(&self, result: &Output) -> Value {
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        serde_json::from_slice(&result.stdout).unwrap()
    }
    fn git(&self, args: &[&str]) -> String {
        let result = Command::new("git")
            .arg("-C")
            .arg(&self.run)
            .args(args)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "git: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        String::from_utf8_lossy(&result.stdout).trim().to_string()
    }
}

#[test]
fn rust_creates_one_bound_run_that_node_reuses_without_new_job() {
    let f = Fixture::new();
    let first = f.assert_success(&f.run(true));
    assert_eq!(first["jobId"], "101");
    assert_eq!(first["taskId"], "17");
    assert_eq!(first["status"], "ACTIVE");
    assert_eq!(f.state()["creates"], 1);
    let before = f.git(&["rev-parse", "HEAD"]);
    let other = f.assert_success(&f.run(false));
    assert_eq!(first, other);
    assert_eq!(f.state()["creates"], 1);
    assert_eq!(before, f.git(&["rev-parse", "HEAD"]));
    let bind: Value =
        serde_json::from_slice(&fs::read(f.run.join(".neo-project-run.json")).unwrap()).unwrap();
    assert_eq!(bind["repository"], "sample");
    #[cfg(unix)]
    assert_eq!(
        fs::metadata(f.run.join("source-reference.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
}
#[test]
fn node_creates_bound_run_that_rust_reuses() {
    let f = Fixture::new();
    let reference = f.assert_success(&f.run(false));
    let native = f.assert_success(&f.run(true));
    assert_eq!(reference, native);
    assert_eq!(f.state()["creates"], 1);
}
#[test]
fn failure_during_activation_reuses_same_private_binding() {
    let f = Fixture::new();
    put(&f.state_root.join("fail-job-run"), "on");
    let failed = f.run(true);
    assert!(!failed.status.success());
    assert!(String::from_utf8_lossy(&failed.stderr).contains("binding are preserved"));
    let binding: Value =
        serde_json::from_slice(&fs::read(f.run.join(".neo-project-run.json")).unwrap()).unwrap();
    assert_eq!(binding["jobId"], "101");
    assert_eq!(f.state()["jobs"]["101"]["state"], "DRAFT");
    fs::remove_file(f.state_root.join("fail-job-run")).unwrap();
    let recovered = f.assert_success(&f.run(true));
    assert_eq!(recovered["status"], "ACTIVE");
    assert_eq!(f.state()["creates"], 1);
}
#[test]
fn tampered_binding_and_git_remote_refuse_reuse() {
    let f = Fixture::new();
    f.assert_success(&f.run(true));
    let file = f.run.join(".neo-project-run.json");
    let mut binding: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    binding["taskInput"] = json!("/tmp/unsafe.md");
    put(&file, &serde_json::to_string(&binding).unwrap());
    let result = f.run(true);
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr).contains("binding does not match"));
    assert_eq!(f.state()["creates"], 1);
    let other = Fixture::new();
    other.assert_success(&other.run(true));
    let origin = Command::new("git")
        .arg("-C")
        .arg(&other.run)
        .args(["remote", "add", "origin", "https://example.org/unsafe.git"])
        .output()
        .unwrap();
    assert!(origin.status.success());
    let failed = other.run(true);
    assert!(!failed.status.success());
    assert!(String::from_utf8_lossy(&failed.stderr).contains("no remotes"));
    assert_eq!(other.state()["creates"], 1);
}
#[test]
fn failed_create_stages_inputs_once_and_preserves_git_history() {
    let f = Fixture::new();
    put(&f.state_root.join("fail-job-create"), "on");
    let failed = f.run(true);
    assert!(!failed.status.success());
    assert!(!f.run.join(".neo-project-run.json").exists());
    let first = f.git(&["rev-parse", "HEAD"]);
    let staged = fs::read(f.run.join("neo-project-run.input.md")).unwrap();
    fs::remove_file(f.state_root.join("fail-job-create")).unwrap();
    let recovered = f.assert_success(&f.run(true));
    assert_eq!(recovered["status"], "ACTIVE");
    assert_eq!(first, f.git(&["rev-parse", "HEAD"]));
    assert_eq!(
        staged,
        fs::read(f.run.join("neo-project-run.input.md")).unwrap()
    );
    assert_eq!(f.state()["creates"], 1);
}

#[test]
fn coordinator_task_tampering_blocks_replay_without_reactivation() {
    let f = Fixture::new();
    f.assert_success(&f.run(true));
    let state_file = f.state_root.join("state.json");
    let mut state = f.state();
    state["jobs"]["101"]["task"]["agentGraph"] = json!("flowchart TD\n Wrong[agent:other]");
    put(&state_file, &serde_json::to_string(&state).unwrap());
    let old_calls = f.state()["calls"].as_array().unwrap().len();
    let rejected = f.run(true);
    assert!(!rejected.status.success());
    assert!(String::from_utf8_lossy(&rejected.stderr).contains("does not match this canonical Run"));
    assert_eq!(f.state()["creates"], 1);
    assert_eq!(f.state()["calls"].as_array().unwrap().len(), old_calls + 3);
}

#[test]
fn completed_binding_returns_reused_without_running_again() {
    let f = Fixture::new();
    f.assert_success(&f.run(true));
    let state_file = f.state_root.join("state.json");
    let mut state = f.state();
    state["jobs"]["101"]["state"] = json!("COMPLETED");
    put(&state_file, &serde_json::to_string(&state).unwrap());
    let done = f.assert_success(&f.run(true));
    assert_eq!(done["status"], "COMPLETED");
    assert_eq!(done["reused"], true);
    assert_eq!(f.state()["creates"], 1);
    let runs = f.state()["calls"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c.as_str() == Some("job:run"))
        .count();
    assert_eq!(runs, 1);
}

#[test]
fn url_source_remains_private_and_never_reaches_relay_arguments() {
    let f = Fixture::new();
    put(
        &f.workspace.join("sample").join("project.run.json"),
        r#"{"schemaVersion":1,"input":{"type":"url","schemes":["https"],"resumePath":true},"versioning":{"mode":"local-git","template":"run-template"}}"#,
    );
    let result = f.call(
        true,
        &[
            "--project",
            "sample",
            "--url",
            "https://example.org/preview?token=hidden-secret",
        ],
    );
    let first = f.assert_success(&result);
    let run = PathBuf::from(first["runPath"].as_str().unwrap());
    let evidence = fs::read_to_string(run.join("source-reference.json")).unwrap();
    assert!(evidence.contains("hidden-secret"));
    assert!(!String::from_utf8_lossy(&result.stdout).contains("hidden-secret"));
    assert!(
        !fs::read_to_string(run.join("neo-project-run.objective.md"))
            .unwrap()
            .contains("hidden-secret")
    );
    assert!(!fs::read_to_string(run.join("neo-project-run.input.md"))
        .unwrap()
        .contains("hidden-secret"));
    assert!(!serde_json::to_string(&f.state())
        .unwrap()
        .contains("hidden-secret"));
    #[cfg(unix)]
    assert_eq!(
        fs::metadata(&run).unwrap().permissions().mode() & 0o777,
        0o700
    );
    let resumed = f.assert_success(&f.call(
        false,
        &["--project", "sample", "--path", run.to_str().unwrap()],
    ));
    assert_eq!(resumed["jobId"], first["jobId"]);
    assert_eq!(f.state()["creates"], 1);
}

#[test]
fn source_discovery_uses_declared_brief_with_correct_json_order() {
    let f = Fixture::new();
    put(
        &f.workspace.join("sample").join("graph-discovery.mmd"),
        "flowchart TD\n A[agent:writer]-->B\n",
    );
    put(
        &f.workspace.join("sample").join("config/brief.json"),
        "{\"schemaVersion\":1,\"zeta\":\"first\",\"alpha\":\"second\"}",
    );
    put(
        &f.workspace.join("sample").join("project.run.json"),
        r#"{"schemaVersion":1,"input":{"type":"url","schemes":["https"],"resumePath":true},"graphs":{"discovery":"graph-discovery.mmd"},"defaultDag":"discovery","dagInputs":{"discovery":{"type":"discovery","domain":"general"}},"sources":{"research":{"dag":"discovery","config":"config/brief.json","runFile":"source-brief.json"}}}"#,
    );
    let first = f.assert_success(&f.call(true, &["--project", "sample", "--source", "research"]));
    assert_eq!(first["source"], "research");
    assert_eq!(first["dag"], "discovery");
    let run = PathBuf::from(first["runPath"].as_str().unwrap());
    let brief = fs::read_to_string(run.join("source-brief.json")).unwrap();
    assert!(brief.find("zeta").unwrap() < brief.find("alpha").unwrap());
    let evidence: Value =
        serde_json::from_slice(&fs::read(run.join("source-reference.json")).unwrap()).unwrap();
    assert_eq!(evidence["kind"], "discovery");
    assert_eq!(evidence["sourceBrief"], "source-brief.json");
    let second = f.assert_success(&f.call(
        false,
        &["--project", "sample", "--path", run.to_str().unwrap()],
    ));
    assert_eq!(first, second);
    assert_eq!(f.state()["creates"], 1);
}

#[test]
fn concurrent_native_cli_calls_share_one_atomic_run_binding() {
    let f = Fixture::new();
    put(
        &f.state_root.join("slow-create"),
        "delay for collision test",
    );
    let spawn = || {
        Command::new(env!("CARGO_BIN_EXE_neo-rs"))
            .args([
                "project",
                "run",
                "--project",
                "sample",
                "--path",
                f.run.to_str().unwrap(),
            ])
            .env("HOME", &f.home)
            .env("NEO_WORKSPACE_CONFIG", &f.config)
            .env("NEO_ROOT", &f.workspace)
            .env("NEO_RELAY_EXECUTABLE", &f.relay)
            .env("RELAY_FIXTURE_ROOT", &f.state_root)
            .current_dir(&f.workspace)
            .output()
    };
    // OS advisory lock serialization is exercised by two independent
    // executables, not a mutex shared inside the Rust test process.
    let (left, right) = std::thread::scope(|scope| {
        let first = scope.spawn(spawn);
        let second = scope.spawn(spawn);
        (
            first.join().unwrap().unwrap(),
            second.join().unwrap().unwrap(),
        )
    });
    let a = f.assert_success(&left);
    let b = f.assert_success(&right);
    assert_eq!(a, b);
    assert_eq!(f.state()["creates"], 1);
    assert!(f.run.join(".neo-project-run.json").is_file());
}

#[test]
fn rust_and_node_stage_exactly_equivalent_canonical_private_inputs() {
    let rust = Fixture::new();
    rust.assert_success(&rust.run(true));
    let node = Fixture::new();
    node.assert_success(&node.run(false));
    for name in [
        "source-reference.json",
        "neo-project-run.objective.md",
        "neo-project-run.input.md",
        ".neo-project-run.json",
    ] {
        let native = fs::read_to_string(rust.run.join(name))
            .unwrap()
            .replace(rust.run.to_str().unwrap(), "<RUN>")
            .replace(rust.workspace.to_str().unwrap(), "<WORKSPACE>");
        let reference = fs::read_to_string(node.run.join(name))
            .unwrap()
            .replace(node.run.to_str().unwrap(), "<RUN>")
            .replace(node.workspace.to_str().unwrap(), "<WORKSPACE>");
        assert_eq!(native, reference, "private Run input parity: {name}");
    }
}

#[test]
fn bound_source_evidence_tampering_is_rejected_without_second_job() {
    let f = Fixture::new();
    put(
        &f.workspace.join("sample").join("graph-discovery.mmd"),
        "flowchart TD\n A[agent:writer]-->B\n",
    );
    put(
        &f.workspace.join("sample").join("config/brief.json"),
        "{\"schemaVersion\":1,\"topic\":\"story\"}",
    );
    put(
        &f.workspace.join("sample").join("project.run.json"),
        r#"{"schemaVersion":1,"input":{"type":"url","schemes":["https"],"resumePath":true},"graphs":{"discovery":"graph-discovery.mmd"},"defaultDag":"discovery","dagInputs":{"discovery":{"type":"discovery","domain":"general"}},"sources":{"research":{"dag":"discovery","config":"config/brief.json","runFile":"source-brief.json"}}}"#,
    );
    let created = f.assert_success(&f.call(true, &["--project", "sample", "--source", "research"]));
    let run = PathBuf::from(created["runPath"].as_str().unwrap());
    let evidence = run.join("source-reference.json");
    let mut data: Value = serde_json::from_slice(&fs::read(&evidence).unwrap()).unwrap();
    data["source"] = json!("different");
    put(&evidence, &serde_json::to_string_pretty(&data).unwrap());
    let denied = f.call(
        true,
        &["--project", "sample", "--path", run.to_str().unwrap()],
    );
    assert!(!denied.status.success());
    assert!(String::from_utf8_lossy(&denied.stderr).contains("source evidence does not match"));
    assert_eq!(f.state()["creates"], 1);
}

#[test]
fn private_vlog_no_review_requires_authorized_manifest_and_matches_node_bytes() {
    let a = Fixture::new_named("vlog");
    let b = Fixture::new_named("vlog");
    for f in [&a, &b] {
        put(
            &f.run.join("source-manifest.json"),
            r#"{"source_use":{"approved":true,"scope":"private only"}}"#,
        );
    }
    let args_a = [
        "--project",
        "vlog",
        "--path",
        a.run.to_str().unwrap(),
        "--no-review",
    ];
    let args_b = [
        "--project",
        "vlog",
        "--path",
        b.run.to_str().unwrap(),
        "--no-review",
    ];
    let one = a.assert_success(&a.call(true, &args_a));
    let two = b.assert_success(&b.call(false, &args_b));
    assert_eq!(one["status"], "ACTIVE");
    assert_eq!(two["status"], "ACTIVE");
    for name in [
        "source-reference.json",
        "neo-project-run.objective.md",
        "neo-project-run.input.md",
        "review-mode.json",
    ] {
        let rust = fs::read_to_string(a.run.join(name))
            .unwrap()
            .replace(a.run.to_str().unwrap(), "<RUN>");
        let node = fs::read_to_string(b.run.join(name))
            .unwrap()
            .replace(b.run.to_str().unwrap(), "<RUN>");
        assert_eq!(rust, node, "Vlog policy file parity: {name}");
    }
    let mode: Value =
        serde_json::from_slice(&fs::read(a.run.join("review-mode.json")).unwrap()).unwrap();
    assert_eq!(mode["publicationAllowed"], false);
    assert_eq!(mode["reviewStatus"], "UNREVIEWED");
    #[cfg(unix)]
    assert_eq!(
        fs::metadata(a.run.join("review-mode.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    let reread = a.assert_success(&a.call(false, &args_a));
    assert_eq!(reread["jobId"], one["jobId"]);
    assert_eq!(a.state()["creates"], 1);
    let denied = a.call(
        true,
        &["--project", "vlog", "--path", a.run.to_str().unwrap()],
    );
    assert!(!denied.status.success());
}

#[test]
fn private_vlog_no_review_rejects_missing_approval_before_relay() {
    for content in [
        None,
        Some(r#"{"source_use":{"approved":false,"scope":"private"}}"#),
        Some(r#"{"source_use":{"approved":true,"scope":"public"}}"#),
    ] {
        let f = Fixture::new_named("vlog");
        if let Some(value) = content {
            put(&f.run.join("source-manifest.json"), value);
        }
        let args = [
            "--project",
            "vlog",
            "--path",
            f.run.to_str().unwrap(),
            "--no-review",
        ];
        for native in [false, true] {
            let result = f.call(native, &args);
            assert!(
                !result.status.success(),
                "rejected manifest should not create a Job"
            );
            assert!(!f.run.join(".neo-project-run.json").exists());
        }
    }
}

#[test]
fn stage_review_flags_are_exact_node_rust_parity_and_reject_unconfigured_agents() {
    let a = Fixture::new();
    let b = Fixture::new();
    for f in [&a, &b] {
        put(
            &f.workspace.join("sample/project.run.json"),
            r#"{"schemaVersion":1,"input":{"type":"path","path":{"base":"runs","datedRunDirectory":true}},"reviewableDags":{"growth":["writer"]},"defaultDag":"growth","graphs":{"growth":"graph.mmd"}}"#,
        );
        put(&f.run.join("review-stages.json"), r#"{"writer":true}"#);
    }
    let args_a = ["--project", "sample", "--path", a.run.to_str().unwrap()];
    let args_b = ["--project", "sample", "--path", b.run.to_str().unwrap()];
    a.assert_success(&a.call(true, &args_a));
    b.assert_success(&b.call(false, &args_b));
    for name in ["neo-project-run.objective.md", "neo-project-run.input.md"] {
        let rust = fs::read_to_string(a.run.join(name))
            .unwrap()
            .replace(a.run.to_str().unwrap(), "<RUN>");
        let node = fs::read_to_string(b.run.join(name))
            .unwrap()
            .replace(b.run.to_str().unwrap(), "<RUN>");
        assert_eq!(rust, node, "Review text parity: {name}");
        assert!(rust.contains("MANDATORY STAGE-BY-STAGE HUMAN REVIEWS"));
    }
    let f = Fixture::new();
    put(
        &f.workspace.join("sample/project.run.json"),
        r#"{"schemaVersion":1,"input":{"type":"path","path":{"base":"runs","datedRunDirectory":true}},"reviewableDags":{"growth":["writer"]},"defaultDag":"growth","graphs":{"growth":"graph.mmd"}}"#,
    );
    put(&f.run.join("review-stages.json"), r#"{"unknown":true}"#);
    assert!(!f.run(true).status.success());
    assert!(!f.run.join(".neo-project-run.json").exists());
}

#[test]
fn recovering_unbound_discovery_source_preserves_exact_source_and_graph() {
    let a = Fixture::new();
    let b = Fixture::new();
    for f in [&a, &b] {
        put(
            &f.workspace.join("sample/graph-growth.mmd"),
            "flowchart TD\n A[agent:writer]-->B\n",
        );
        put(
            &f.workspace.join("sample/config/topic.json"),
            r#"{"schemaVersion":1,"zeta":1,"alpha":2}"#,
        );
        put(
            &f.workspace.join("sample/project.run.json"),
            r#"{"schemaVersion":1,"input":{"type":"url","schemes":["https"],"resumePath":true,"preparedPath":true},"graphs":{"growth":"graph-growth.mmd"},"defaultDag":"growth","dagInputs":{"growth":{"type":"discovery","domain":"general"}},"sources":{"topic":{"dag":"growth","config":"config/topic.json","runFile":"source-brief.json"}}}"#,
        );
        put(&f.state_root.join("fail-job-create"), "test interruption");
    }
    let result_a = a.call(true, &["--project", "sample", "--source", "topic"]);
    let result_b = b.call(false, &["--project", "sample", "--source", "topic"]);
    assert!(!result_a.status.success() && !result_b.status.success());
    let discovered = |f: &Fixture| {
        fs::read_dir(f.workspace.join("sample/runs"))
            .unwrap()
            .filter_map(Result::ok)
            .map(|row| row.path())
            .find(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .contains("discovery")
            })
            .unwrap()
    };
    let arun = discovered(&a);
    let brun = discovered(&b);
    fs::remove_file(a.state_root.join("fail-job-create")).unwrap();
    fs::remove_file(b.state_root.join("fail-job-create")).unwrap();
    let one = a.assert_success(&a.call(
        true,
        &["--project", "sample", "--path", arun.to_str().unwrap()],
    ));
    let two = b.assert_success(&b.call(
        false,
        &["--project", "sample", "--path", brun.to_str().unwrap()],
    ));
    assert_eq!(one["source"], "topic");
    assert_eq!(two["source"], "topic");
    assert_eq!(one["dag"], "growth");
    assert_eq!(a.state()["creates"], 1);
    for name in [
        "source-reference.json",
        "neo-project-run.objective.md",
        "neo-project-run.input.md",
        "source-brief.json",
    ] {
        let rust = fs::read_to_string(arun.join(name))
            .unwrap()
            .replace(arun.to_str().unwrap(), "<RUN>");
        let node = fs::read_to_string(brun.join(name))
            .unwrap()
            .replace(brun.to_str().unwrap(), "<RUN>");
        assert_eq!(rust, node, "Recovery file parity: {name}");
    }
}

#[test]
fn foreground_project_run_attaches_without_duplicate_scheduler_or_false_completion() {
    let f = Fixture::new();
    let args = [
        "--project",
        "sample",
        "--path",
        f.run.to_str().unwrap(),
        "--foreground",
    ];
    let result = f.call(true, &args);
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let output = String::from_utf8_lossy(&result.stdout);
    let mut lines = output.lines();
    let attached: Value = serde_json::from_str(lines.next().unwrap()).unwrap();
    assert_eq!(attached["foreground"], true);
    assert_eq!(attached["status"], "DRAFT");
    assert_eq!(lines.next(), Some("FOREGROUND_EVENT_JOB_101"));
    assert_eq!(lines.next(), None);
    assert_eq!(f.state()["creates"], 1);
    assert_eq!(
        f.state()["calls"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|x| x.as_str() == Some("job:run"))
            .count(),
        1
    );
    let second = f.call(true, &args);
    assert!(second.status.success());
    assert_eq!(f.state()["creates"], 1);
    assert_eq!(
        String::from_utf8_lossy(&second.stdout).lines().nth(1),
        Some("FOREGROUND_EVENT_JOB_101")
    );
}

#[test]
fn foreground_failure_preserves_original_binding_and_exit_failure() {
    let f = Fixture::new();
    put(&f.state_root.join("fail-job-run"), "test");
    let args = [
        "--project",
        "sample",
        "--path",
        f.run.to_str().unwrap(),
        "--foreground",
    ];
    let failed = f.call(true, &args);
    assert!(!failed.status.success());
    assert!(String::from_utf8_lossy(&failed.stderr).contains("foreground"));
    let binding: Value =
        serde_json::from_slice(&fs::read(f.run.join(".neo-project-run.json")).unwrap()).unwrap();
    assert_eq!(binding["jobId"], "101");
    fs::remove_file(f.state_root.join("fail-job-run")).unwrap();
    let resumed = f.call(true, &args);
    assert!(resumed.status.success());
    assert_eq!(f.state()["creates"], 1);
}

#[test]
fn foreground_completed_job_returns_one_terminal_response_without_reinvoking_relay() {
    let f = Fixture::new();
    f.assert_success(&f.run(true));
    let state_file = f.state_root.join("state.json");
    let mut state = f.state();
    state["jobs"]["101"]["state"] = json!("COMPLETED");
    put(&state_file, &serde_json::to_string(&state).unwrap());
    let output = f.call(
        true,
        &[
            "--project",
            "sample",
            "--path",
            f.run.to_str().unwrap(),
            "--foreground",
        ],
    );
    assert!(output.status.success());
    let raw = String::from_utf8_lossy(&output.stdout);
    assert_eq!(raw.lines().count(), 1);
    let completed: Value = serde_json::from_str(raw.trim()).unwrap();
    assert_eq!(completed["status"], "COMPLETED");
    assert_eq!(completed["reused"], true);
    assert_eq!(f.state()["creates"], 1);
    assert_eq!(
        f.state()["calls"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|x| x.as_str() == Some("job:run"))
            .count(),
        1
    );
}

#[test]
fn human_title_and_flag_forms_match_node_reference_and_preserve_resume() {
    let a = Fixture::new_named("vlog");
    let b = Fixture::new_named("vlog");
    let args_a = [
        "--project=vlog",
        "--path",
        a.run.to_str().unwrap(),
        "--title=加拿大周末随拍",
    ];
    let args_b = [
        "--path",
        b.run.to_str().unwrap(),
        "--project=vlog",
        "--title",
        "加拿大周末随拍",
    ];
    let first = a.assert_success(&a.call(true, &args_a));
    let second = b.assert_success(&b.call(false, &args_b));
    assert_eq!(first["status"], second["status"]);
    let title = |f: &Fixture| {
        let state = f.state();
        let args = state["create_args"].as_array().unwrap();
        let i = args
            .iter()
            .position(|v| v.as_str() == Some("--title"))
            .unwrap();
        args[i + 1].as_str().unwrap().to_string()
    };
    assert_eq!(title(&a), "加拿大周末随拍");
    assert_eq!(title(&a), title(&b));
    let old = a.state()["creates"].clone();
    a.assert_success(&a.call(
        true,
        &[
            "--path",
            a.run.to_str().unwrap(),
            "--project=vlog",
            "--title",
            "different on replay",
        ],
    ));
    assert_eq!(a.state()["creates"], old);
}

#[test]
fn coordinator_ids_must_be_numeric_for_new_runs() {
    for mode in ["bad-job-id", "bad-task-id"] {
        let f = Fixture::new();
        put(&f.state_root.join(mode), "invalid response");
        let result = f.run(true);
        assert!(!result.status.success());
        assert!(!f.run.join(".neo-project-run.json").exists());
        assert_eq!(f.state()["creates"], 1);
        assert_eq!(
            f.state()["calls"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|v| v.as_str() == Some("job:run"))
                .count(),
            0
        );
    }
}

#[test]
fn bound_named_dag_cannot_be_changed_during_resume() {
    let f = Fixture::new();
    put(
        &f.workspace.join("sample/graph-growth.mmd"),
        "flowchart TD\n A[agent:writer]-->B\n",
    );
    put(
        &f.workspace.join("sample/project.run.json"),
        r#"{"schemaVersion":1,"input":{"type":"path","path":{"base":"runs","datedRunDirectory":true}},"graphs":{"growth":"graph-growth.mmd","promotion":"graph.mmd"},"defaultDag":"promotion"}"#,
    );
    let run = f.call(
        true,
        &[
            "--project",
            "sample",
            "--path",
            f.run.to_str().unwrap(),
            "--dag",
            "growth",
        ],
    );
    let first = f.assert_success(&run);
    assert_eq!(first["dag"], "growth");
    let rejected = f.call(
        true,
        &[
            "--project",
            "sample",
            "--path",
            f.run.to_str().unwrap(),
            "--dag",
            "promotion",
        ],
    );
    assert!(!rejected.status.success());
    assert!(String::from_utf8_lossy(&rejected.stderr).contains("different DAG"));
    assert_eq!(f.state()["creates"], 1);
    let resumed = f.assert_success(&f.call(
        false,
        &["--project", "sample", "--path", f.run.to_str().unwrap()],
    ));
    assert_eq!(resumed["jobId"], first["jobId"]);
}

#[test]
fn prepared_url_project_run_reuses_original_private_evidence() {
    let rust = Fixture::new();
    let node = Fixture::new();
    for f in [&rust, &node] {
        put(
            &f.workspace.join("sample/project.run.json"),
            r#"{"schemaVersion":1,"input":{"type":"url","schemes":["https"],"resumePath":true,"preparedPath":true}}"#,
        );
        put(
            &f.run.join("campaign.json"),
            r#"{"schemaVersion":1,"intent":"review"}"#,
        );
        put(&f.run.join("evidence/original-source.json"), "{}");
    }
    let a = rust.assert_success(&rust.run(true));
    let b = node.assert_success(&node.run(false));
    assert_eq!(a["status"], b["status"]);
    for file in [
        "source-reference.json",
        "neo-project-run.objective.md",
        "neo-project-run.input.md",
    ] {
        let native = fs::read_to_string(rust.run.join(file))
            .unwrap()
            .replace(rust.run.to_str().unwrap(), "<RUN>");
        let refer = fs::read_to_string(node.run.join(file))
            .unwrap()
            .replace(node.run.to_str().unwrap(), "<RUN>");
        assert_eq!(native, refer, "prepared URL Run parity: {file}");
    }
}

#[test]
fn vlog_publisher_review_and_six_stage_growth_policy_are_node_equivalent() {
    for project in ["vlog", "growth"] {
        let rust = Fixture::new_named(project);
        let node = Fixture::new_named(project);
        for f in [&rust, &node] {
            if project == "vlog" {
                put(
                    &f.workspace.join("vlog/project.run.json"),
                    r#"{"schemaVersion":1,"input":{"type":"path","path":{"base":"runs","datedRunDirectory":true}},"publicationReview":"publisher-explicit-authorization"}"#,
                );
                put(
                    &f.run.join("review-stages.json"),
                    r#"{"visioner":true,"director":true,"producer":true}"#,
                );
            } else {
                let names = [
                    "growth-researcher",
                    "growth-strategist",
                    "growth-writer",
                    "growth-editor",
                    "growth-operator",
                    "growth-analyst",
                ];
                let graph = format!(
                    "flowchart TD\n {}\n",
                    names
                        .iter()
                        .map(|n| format!(" [agent:{n}]"))
                        .collect::<Vec<_>>()
                        .join(" --> ")
                );
                put(&f.workspace.join("growth/graph-growth.mmd"), &graph);
                let config = json!({"schemaVersion":1,"input":{"type":"path","path":{"base":"runs","datedRunDirectory":true}},
                    "graphs":{"review":"graph-growth.mmd"},"defaultDag":"review","reviewableDags":{"review":names}});
                put(
                    &f.workspace.join("growth/project.run.json"),
                    &serde_json::to_string(&config).unwrap(),
                );
                let stages = names
                    .iter()
                    .map(|s| (s.to_string(), json!(true)))
                    .collect::<serde_json::Map<_, _>>();
                put(
                    &f.run.join("review-stages.json"),
                    &serde_json::to_string(&stages).unwrap(),
                );
            }
        }
        let args_a = ["--project", project, "--path", rust.run.to_str().unwrap()];
        let args_b = ["--project", project, "--path", node.run.to_str().unwrap()];
        rust.assert_success(&rust.call(true, &args_a));
        node.assert_success(&node.call(false, &args_b));
        for file in ["neo-project-run.objective.md", "neo-project-run.input.md"] {
            let native = fs::read_to_string(rust.run.join(file))
                .unwrap()
                .replace(rust.run.to_str().unwrap(), "<RUN>");
            let refer = fs::read_to_string(node.run.join(file))
                .unwrap()
                .replace(node.run.to_str().unwrap(), "<RUN>");
            assert_eq!(
                native, refer,
                "multi-stage approval policy parity for {project}:{file}"
            );
        }
    }
}

#[test]
fn declared_dag_supplies_internal_preflight_and_rejects_caller_option() {
    let f = Fixture::new();
    let run_cli = |native: bool, args: &[&str]| {
        let mut cmd = if native {
            Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        } else {
            Command::new(&f.node)
        };
        if !native {
            cmd.arg(f.repo.join(".bin/neo.mjs"));
        }
        cmd.args(["project", "run"])
            .args(args)
            .env("HOME", &f.home)
            .env("NEO_WORKSPACE_CONFIG", &f.config)
            .env("NEO_ROOT", &f.workspace)
            .env("NEO_RELAY_EXECUTABLE", &f.relay)
            .env("RELAY_FIXTURE_ROOT", &f.state_root)
            .current_dir(&f.workspace)
            .output()
            .unwrap()
    };
    let options = ["--project", "sample", "--path", f.run.to_str().unwrap()];
    for native in [true, false] {
        for invalid in [
            vec!["--preflight=true"],
            vec!["--preflight=false"],
            vec!["--preflight"],
            vec!["--preflight=true", "--preflight=true"],
        ] {
            let mut args = options.to_vec();
            args.extend(invalid);
            let rejected = run_cli(native, &args);
            assert!(
                !rejected.status.success(),
                "caller preflight option must not create Job"
            );
            assert!(
                String::from_utf8_lossy(&rejected.stderr).contains("unknown project run option")
            );
            assert!(!f.run.join(".neo-project-run.json").exists());
            assert!(!f.state_root.join("state.json").exists());
        }
    }
    let first = f.assert_success(&run_cli(true, &options));
    assert_eq!(first["status"], "ACTIVE");
    assert_eq!(f.state()["creates"], 1);
    let resumed = f.assert_success(&run_cli(true, &options));
    assert_eq!(first, resumed);
    assert_eq!(f.state()["creates"], 1);
}
