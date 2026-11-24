use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

struct Fixture {
    _tmp: tempfile::TempDir,
    home: PathBuf,
    root: PathBuf,
    project: PathBuf,
    config: PathBuf,
}
fn write(path: &Path, value: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, value).unwrap();
}
impl Fixture {
    fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let project = tmp.path().join("testproject");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(home.join("Workspace")).unwrap();
        write(&home.join(".agents/AGENTS.md"), "# My global agent rules\n");
        write(
            &home.join(".agents/skills/fixture-global/SKILL.md"),
            "---\nname: fixture-global\ndescription: Local fixture\n---\n",
        );
        write(&project.join("skills/fixture-project/SKILL.md"), "---\nname: fixture-project\ndescription: Project fixture\nrequires:\n  skills:\n    - fixture-global\n---\n");
        write(&project.join("skills/fixture-missing/SKILL.md"), "---\nname: fixture-missing\ndescription: A missing dependency\nrequires:\n  skills:\n    - no-such-skill\n---\n");
        let config = tmp.path().join("neo-config.json");
        write(
            &config,
            &format!(
                "{{\"schemaVersion\":1,\"neoRoot\":\"{}\"}}",
                home.join("Workspace").display()
            ),
        );
        Self {
            _tmp: tmp,
            home,
            root,
            project,
            config,
        }
    }
    fn call(&self, binary: &Path, args: &[&str], without_node: bool) -> Output {
        let mut cmd = Command::new(binary);
        cmd.args(args)
            .current_dir(&self.project)
            .env("HOME", &self.home)
            .env("NEO_WORKSPACE_CONFIG", &self.config)
            .env("NEO_HARNESS_ROOT", &self.root);
        if without_node {
            cmd.env("PATH", "");
        }
        cmd.output().unwrap()
    }
    fn candidate(&self, args: &[&str]) -> Output {
        self.call(Path::new(env!("CARGO_BIN_EXE_neo-rs")), args, false)
    }
    fn baseline(&self, args: &[&str]) -> Output {
        self.call(&self.root.join(".bin/neo.mjs"), args, false)
    }
    fn parity(&self, args: &[&str], exact_text: bool) {
        let a = self.baseline(args);
        let b = self.candidate(args);
        assert_eq!(
            a.status.code(),
            b.status.code(),
            "reference={:?} candidate={:?}; args={args:?}",
            String::from_utf8_lossy(&a.stderr),
            String::from_utf8_lossy(&b.stderr)
        );
        if a.status.success() {
            if exact_text {
                assert_eq!(a.stdout, b.stdout, "text mismatch for {args:?}");
            } else {
                let aj: Value = serde_json::from_slice(&a.stdout).unwrap();
                let bj: Value = serde_json::from_slice(&b.stdout).unwrap();
                assert_eq!(aj, bj, "json mismatch for {args:?}");
            }
        } else {
            assert!(b.stdout.is_empty());
            assert!(!b.stderr.is_empty());
        }
    }
}
#[test]
fn skill_catalog_matches_reference_with_project_and_missing_deps() {
    let f = Fixture::new();
    f.parity(&["skill", "list"], false);
    let p = f.project.to_str().unwrap();
    f.parity(&["skill", "list", "--project", p], false);
    let out = f.candidate(&["skill", "list", "--project", p]);
    let skills: Value = serde_json::from_slice(&out.stdout).unwrap();
    let rows = skills.as_array().unwrap();
    assert!(rows.iter().any(|s| s["name"] == "fixture-global"));
    assert!(rows.iter().any(|s| s["name"] == "fixture-project"));
    let missing = rows
        .iter()
        .find(|s| s["name"] == "fixture-missing")
        .unwrap();
    assert_eq!(missing["requires_resolved"], false);
}
#[test]
fn skill_invalid_arguments_match_reference() {
    let f = Fixture::new();
    for a in [
        vec!["skill", "list", "--wrong"],
        vec!["skill", "list", "--project"],
        vec!["skill", "list", "--project", "a", "b"],
    ] {
        f.parity(&a, false);
    }
}
#[test]
fn bootstrap_json_and_exact_markdown_match_reference() {
    let f = Fixture::new();
    let p = f.project.to_str().unwrap();
    f.parity(&["bootstrap", "--json"], false);
    f.parity(&["bootstrap", "--json", "--project", p], false);
    f.parity(&["bootstrap"], true);
    f.parity(&["bootstrap", "--project", p], true);
}
#[test]
fn bootstrap_missing_rules_fail_closed() {
    let f = Fixture::new();
    fs::remove_file(f.home.join(".agents/AGENTS.md")).unwrap();
    let result = f.candidate(&["bootstrap"]);
    assert!(!result.status.success());
    assert!(result.stdout.is_empty());
}
#[test]
fn bootstrap_and_skill_are_node_free() {
    let f = Fixture::new();
    let binary = Path::new(env!("CARGO_BIN_EXE_neo-rs"));
    for args in [vec!["skill", "list"], vec!["bootstrap", "--json"]] {
        let result = f.call(binary, &args, true);
        assert!(
            result.status.success(),
            "{}: {}",
            args.join(" "),
            String::from_utf8_lossy(&result.stderr)
        );
    }
}
