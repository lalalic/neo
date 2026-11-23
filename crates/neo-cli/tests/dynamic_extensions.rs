use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

struct Fixture {
    _tmp: tempfile::TempDir,
    home: PathBuf,
    root: PathBuf,
    workspace: PathBuf,
    node: String,
}
impl Fixture {
    fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        let workspace = home.join("Workspace");
        fs::create_dir_all(&workspace).unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let config = home.join(".config/neo/workspace.json");
        fs::create_dir_all(config.parent().unwrap()).unwrap();
        fs::write(
            config,
            format!(
                "{{\"schemaVersion\":1,\"neoRoot\":\"{}\"}}",
                workspace.display()
            ),
        )
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
            _tmp: tmp,
            home,
            root,
            workspace,
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
            .env("HOME", &self.home)
            .env("NEO_ROOT", &self.workspace)
            .env("NEO_HARNESS_ROOT", &self.root)
            .current_dir(&self.root)
            .output()
            .unwrap()
    }
    fn project(&self) {
        let p = self.workspace.join("sample");
        fs::create_dir_all(p.join(".evals")).unwrap();
        let status = Command::new("git")
            .args(["init", "--quiet", p.to_str().unwrap()])
            .status()
            .unwrap();
        assert!(status.success());
        fs::write(p.join("AGENTS.md"), "# Test Agent rules\n").unwrap();
        fs::write(p.join("README.md"), "# Test Project\n").unwrap();
        let cases = json!([{"id":"check-direction","role":"visioner","capability":"choose a path","type":"decision",
     "task":"Choose before implementing.","choices":["plan","run"],"expectedDecision":"plan"}]);
        fs::write(
            p.join(".evals/cases.json"),
            serde_json::to_string(&cases).unwrap(),
        )
        .unwrap();
    }
}
#[test]
fn eval_list_delegates_to_authentic_project_runner_without_reports_or_network() {
    let f = Fixture::new();
    f.project();
    let args = ["eval", "list", "--project", "sample"];
    let rust = f.run(true, &args);
    let node = f.run(false, &args);
    assert!(
        rust.status.success(),
        "{}",
        String::from_utf8_lossy(&rust.stderr)
    );
    assert!(
        node.status.success(),
        "{}",
        String::from_utf8_lossy(&node.stderr)
    );
    let a: Value = serde_json::from_slice(&rust.stdout).unwrap();
    let b: Value = serde_json::from_slice(&node.stdout).unwrap();
    assert_eq!(a, b);
    assert_eq!(a["cases"].as_array().unwrap().len(), 1);
    assert_eq!(a["cases"][0]["id"], "check-direction");
    assert!(
        !f.workspace.join("sample/.evals/reports").exists(),
        "read-only Eval list must not create reports"
    );
}
#[test]
fn compute_help_and_services_delegate_to_original_gpu_adapter_read_only() {
    let f = Fixture::new();
    for args in [
        vec!["compute", "--help"],
        vec!["gpu", "--help"],
        vec!["compute", "services"],
    ] {
        let native = f.run(true, &args);
        let reference = f.run(false, &args);
        assert_eq!(native.status.code(), reference.status.code(), "{args:?}");
        assert_eq!(native.stdout, reference.stdout, "{args:?}");
        assert_eq!(native.stderr, reference.stderr, "{args:?}");
    }
}
#[test]
fn invalid_eval_and_compute_subcommands_fail_before_provider_execution() {
    let f = Fixture::new();
    for args in [
        vec!["compute", "rent-now"],
        vec!["gpu", "shell"],
        vec!["compute", "services", "--bad"],
        vec!["compute", "doctor", "--apply"],
        vec!["eval", "anything"],
        vec!["eval", "audit", "--project", "sample"],
    ] {
        let result = f.run(true, &args);
        assert!(
            !result.status.success(),
            "unexpected accepted command: {args:?}"
        );
        assert!(
            result.stdout.is_empty(),
            "error must not return a fake PASS: {args:?}"
        );
    }
}
#[cfg(unix)]
#[test]
fn optional_node_extension_failure_is_explicit_not_core_node_fallback() {
    let f = Fixture::new();
    let result = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        .args(["compute", "--help"])
        .env("HOME", &f.home)
        .env("NEO_HARNESS_ROOT", &f.root)
        .env("PATH", "/usr/bin:/bin")
        .output()
        .unwrap();
    if !result.status.success() {
        assert!(String::from_utf8_lossy(&result.stderr).contains("Node.js runtime"));
        assert!(result.stdout.is_empty());
    }
    let core = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        .args(["workspace", "show"])
        .env("HOME", &f.home)
        .env("NEO_HARNESS_ROOT", &f.root)
        .env("PATH", "/usr/bin:/bin")
        .output()
        .unwrap();
    assert!(
        core.status.success(),
        "{}",
        String::from_utf8_lossy(&core.stderr)
    );
}
#[cfg(unix)]
#[test]
fn specialized_adapter_forwards_user_arguments_unchanged_without_invoking_real_gpu() {
    let f = Fixture::new();
    let fake = f._tmp.path().join("bin");
    fs::create_dir_all(&fake).unwrap();
    let marker = f._tmp.path().join("invoked.txt");
    let bin = fake.join("node");
    fs::write(
        &bin,
        "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$MOCK_NODE_INVOKED\"\necho MOCK_ADAPTER\n",
    )
    .unwrap();
    fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        .args([
            "gpu",
            "run",
            "--image",
            "ghcr.io/example/demo:latest",
            "--dry-run",
        ])
        .env("HOME", &f.home)
        .env("NEO_HARNESS_ROOT", &f.root)
        .env("MOCK_NODE_INVOKED", &marker)
        .env("PATH", format!("{}:/usr/bin:/bin", fake.display()))
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(
        String::from_utf8_lossy(&output.stdout).trim(),
        "MOCK_ADAPTER"
    );
    let lines = fs::read_to_string(marker).unwrap();
    let parts = lines.lines().collect::<Vec<_>>();
    assert_eq!(parts[0], f.root.join("gpu/cli.mjs").to_str().unwrap());
    assert_eq!(
        &parts[1..],
        &["run", "--image", "ghcr.io/example/demo:latest", "--dry-run"]
    );
}
