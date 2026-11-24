use serde_json::Value;
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
    config: PathBuf,
    project: PathBuf,
    node: String,
}
fn put(p: &Path, s: &str) {
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, s).unwrap();
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        let workspace = temp.path().join("projects");
        fs::create_dir_all(&workspace).unwrap();
        let project = workspace.join("alpha");
        fs::create_dir_all(&project).unwrap();
        let init = Command::new("git")
            .args(["init", "-q"])
            .current_dir(&project)
            .output()
            .unwrap();
        assert!(init.status.success());
        let remote = Command::new("git")
            .args([
                "remote",
                "add",
                "origin",
                "git@github.com:someone/alpha.git",
            ])
            .current_dir(&project)
            .output()
            .unwrap();
        assert!(remote.status.success());
        for file in ["AGENTS.md", "README.md", "graph.mmd"] {
            put(&project.join(file), "# fixture\n");
        }
        put(&project.join("setup/bootstrap.md"), "# Setup\n");
        put(&home.join(".agents/AGENTS.md"), "# Global\n");
        put(&workspace.join("AGENTS.md"), "# Shared\n");
        let config = temp.path().join("config.json");
        put(
            &config,
            &format!(
                "{{\"schemaVersion\":1,\"neoRoot\":\"{}\"}}",
                workspace.display()
            ),
        );
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
            workspace,
            config,
            project,
            node,
        }
    }
    fn call(&self, native: bool, args: &[&str], path: Option<&Path>) -> Output {
        let mut c = if native {
            Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        } else {
            Command::new(&self.node)
        };
        if !native {
            c.arg(self.root.join(".bin/neo.mjs"));
        }
        c.args(args)
            .current_dir(&self.workspace)
            .env("HOME", &self.home)
            .env("NEO_WORKSPACE_CONFIG", &self.config)
            .env("NEO_HARNESS_ROOT", &self.root);
        if let Some(p) = path {
            c.env(
                "PATH",
                format!("{}:{}", p.display(), std::env::var("PATH").unwrap()),
            );
        }
        c.output().unwrap()
    }
    fn parity(&self, args: &[&str], path: Option<&Path>) {
        let a = self.call(false, args, path);
        let b = self.call(true, args, path);
        assert_eq!(
            a.status.code(),
            b.status.code(),
            "args {args:?}: ref={}, rust={}",
            String::from_utf8_lossy(&a.stderr),
            String::from_utf8_lossy(&b.stderr)
        );
        if a.status.success() {
            let x: Value = serde_json::from_slice(&a.stdout).unwrap();
            let y: Value = serde_json::from_slice(&b.stdout).unwrap();
            assert_eq!(x, y, "{args:?}");
        } else {
            assert!(b.stdout.is_empty());
            assert!(!b.stderr.is_empty());
        }
    }
}
#[test]
fn workspace_and_project_discovery_parity() {
    let f = Fixture::new();
    for args in [
        vec!["workspace", "show"],
        vec!["project", "list"],
        vec!["project", "resolve", "alpha"],
        vec!["project", "resolve", "ALPHA"],
    ] {
        f.parity(&args, None);
    }
}
#[test]
fn project_filters_noncanonical_and_rejects_unknown_names() {
    let f = Fixture::new();
    let nested = f.workspace.join("not-a-project");
    fs::create_dir_all(&nested).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&f.project, f.workspace.join("shortcut")).unwrap();
    f.parity(&["project", "list"], None);
    for a in [
        vec!["project", "resolve", "missing"],
        vec!["project", "resolve", "../alpha"],
        vec!["project", "resolve", "alpha", "extra"],
    ] {
        f.parity(&a, None);
    }
}
#[test]
fn invalid_workspace_configuration_fails_closed() {
    let f = Fixture::new();
    put(&f.config, "{\"schemaVersion\":2,\"neoRoot\":\"/tmp\"}");
    f.parity(&["workspace", "show"], None);
    f.parity(&["project", "list"], None);
}
#[cfg(unix)]
#[test]
fn status_and_doctor_match_reference_diagnostics() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new();
    let bin = f._temp.path().join("stub-bin");
    fs::create_dir_all(&bin).unwrap();
    for (name, code) in [
        ("curl", "#!/bin/sh\nprintf '{\"mcp_endpoint\":true}'\n"),
        ("node", "#!/bin/sh\necho v25.6.0\n"),
        ("python3", "#!/bin/sh\necho 'Python 3.9.6'\n"),
    ] {
        let p = bin.join(name);
        put(&p, code);
        fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).unwrap();
    }
    f.parity(&["status"], Some(&bin));
    f.parity(&["doctor"], Some(&bin));
}
