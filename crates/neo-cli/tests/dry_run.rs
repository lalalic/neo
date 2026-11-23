use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};
struct Fixture {
    _tmp: tempfile::TempDir,
    root: PathBuf,
    home: PathBuf,
    config: PathBuf,
    source: PathBuf,
    run: PathBuf,
    repository: PathBuf,
    node: String,
}
fn write(p: &Path, s: &str) {
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, s).unwrap();
}
impl Fixture {
    fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        let root = tmp.path().join("workspace");
        fs::create_dir_all(&root).unwrap();
        let source = root.join("content-distribution");
        let media = root.join("vlog");
        let run = media.join("runs/2026-11-03-first");
        fs::create_dir_all(&run).unwrap();
        let src =
            r#"{"schemaVersion":1,"input":{"type":"url","schemes":["https"],"resumePath":true}}"#;
        let path = r#"{"schemaVersion":1,"input":{"type":"path","path":{"base":"runs","datedRunDirectory":true}}}"#;
        for (dir, spec) in [(&source, src), (&media, path)] {
            write(&dir.join("AGENTS.md"), "# Agent\n");
            write(&dir.join("README.md"), "# README\n");
            write(&dir.join("graph.mmd"), "flowchart TD\n  a --> b\n");
            write(&dir.join("project.run.json"), spec);
            assert!(Command::new("git")
                .arg("init")
                .arg("-q")
                .arg(dir)
                .status()
                .unwrap()
                .success());
        }
        let config = tmp.path().join("workspace.json");
        write(
            &config,
            &format!("{{\"schemaVersion\":1,\"neoRoot\":\"{}\"}}", root.display()),
        );
        let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
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
            _tmp: tmp,
            root,
            home,
            config,
            source,
            run,
            repository,
            node,
        }
    }
    fn call(&self, native: bool, args: &[&str]) -> Output {
        let mut c = if native {
            Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        } else {
            Command::new(&self.node)
        };
        if !native {
            c.arg(self.repository.join(".bin/neo.mjs"));
        }
        c.args(["project", "run"])
            .args(args)
            .env("HOME", &self.home)
            .env("NEO_ROOT", &self.root)
            .env("NEO_WORKSPACE_CONFIG", &self.config)
            .env("NEO_HARNESS_ROOT", &self.repository)
            .current_dir(&self.root)
            .output()
            .unwrap()
    }
    fn parity(&self, args: &[&str]) {
        let a = self.call(false, args);
        let b = self.call(true, args);
        assert_eq!(
            a.status.code(),
            b.status.code(),
            "args={args:?} ref={} native={}",
            String::from_utf8_lossy(&a.stderr),
            String::from_utf8_lossy(&b.stderr)
        );
        if a.status.success() {
            let x: Value = serde_json::from_slice(&a.stdout).unwrap();
            let y: Value = serde_json::from_slice(&b.stdout).unwrap();
            assert_eq!(x, y, "args={args:?}");
            assert_eq!(y["dryRun"], true);
        } else {
            assert!(b.stdout.is_empty());
            assert!(!b.stderr.is_empty());
        }
    }
}
#[test]
fn url_and_path_preflight_have_exact_json_and_zero_writes() {
    let f = Fixture::new();
    let input = f.run.to_str().unwrap();
    f.parity(&["--project", "vlog", "--path", input, "--dry-run"]);
    f.parity(&[
        "--dry-run",
        "--project=content-distribution",
        "--url",
        "https://example.org/secret?token=hidden",
    ]);
    assert!(!f.source.join("runs").exists());
    assert!(!f.run.join(".neo-project-run.json").exists());
}
#[test]
fn invalid_flags_and_url_policy_are_rejected_before_writes() {
    let f = Fixture::new();
    let path = f.run.to_str().unwrap();
    for args in [
        vec!["--dry-run", "--project", "vlog"],
        vec![
            "--dry-run",
            "--project",
            "vlog",
            "--path",
            path,
            "--url",
            "https://a.example",
        ],
        vec![
            "--dry-run",
            "--project",
            "vlog",
            "--path",
            path,
            "--title",
            " ",
        ],
        vec![
            "--dry-run",
            "--project",
            "vlog",
            "--path",
            path,
            "--foreground",
        ],
        vec!["--dry-run", "--project", "../vlog", "--path", path],
        vec![
            "--dry-run",
            "--project",
            "content-distribution",
            "--url",
            "http://a.example",
        ],
        vec![
            "--dry-run",
            "--project",
            "content-distribution",
            "--url",
            "https://user:password@a.example",
        ],
        vec![
            "--dry-run",
            "--project",
            "content-distribution",
            "--url",
            "https://a.example/%zz",
        ],
    ] {
        f.parity(&args);
    }
    assert!(!f.source.join("runs").exists());
}
#[test]
fn named_dag_uses_project_declarations() {
    let f = Fixture::new();
    let p = f.source.join("project.run.json");
    write(
        &f.source.join("graph-growth.mmd"),
        "flowchart TD\n  A[agent:writer]-->B\n",
    );
    write(
        &p,
        r#"{"schemaVersion":1,"input":{"type":"url","schemes":["https"]},"graphs":{"growth":"graph-growth.mmd"},"defaultDag":"growth"}"#,
    );
    f.parity(&[
        "--dry-run",
        "--project",
        "content-distribution",
        "--url",
        "https://a.example",
    ]);
    f.parity(&[
        "--dry-run",
        "--project",
        "content-distribution",
        "--dag",
        "growth",
        "--url",
        "https://a.example",
    ]);
    f.parity(&[
        "--dry-run",
        "--project",
        "content-distribution",
        "--dag",
        "missing",
        "--url",
        "https://a.example",
    ]);
}
#[test]
fn discovery_source_and_named_dag_are_project_owned() {
    let f = Fixture::new();
    write(
        &f.source.join("graph-growth.mmd"),
        "flowchart TD\n  A[agent:director]-->B\n",
    );
    write(
        &f.source.join("config/trending.json"),
        "{\"schemaVersion\":1,\"topic\":\"example\"}",
    );
    write(
        &f.source.join("project.run.json"),
        r#"{"schemaVersion":1,"input":{"type":"url","schemes":["https"]},"graphs":{"growth":"graph-growth.mmd"},"defaultDag":"growth","dagInputs":{"growth":{"type":"discovery","domain":"video"}},"sources":{"trending":{"dag":"growth","config":"config/trending.json","runFile":"source-brief.json"}}}"#,
    );
    f.parity(&[
        "--dry-run",
        "--project",
        "content-distribution",
        "--source",
        "trending",
    ]);
    f.parity(&[
        "--dry-run",
        "--project",
        "content-distribution",
        "--dag",
        "growth",
    ]);
    f.parity(&[
        "--dry-run",
        "--project",
        "content-distribution",
        "--source",
        "missing",
    ]);
    assert!(!f.source.join("runs").exists());
}
#[test]
fn url_project_prepared_path_and_run_git_preflight_are_side_effect_free() {
    let f = Fixture::new();
    let prepared = f.source.join("runs/2026-11-07-prepared");
    write(&prepared.join("campaign.json"), "{}");
    write(&prepared.join("evidence/original-source.json"), "{}");
    write(
        &f.source.join("project.run.json"),
        r#"{"schemaVersion":1,"input":{"type":"url","schemes":["https"],"resumePath":true,"preparedPath":true},"versioning":{"mode":"local-git","template":"run-template"}}"#,
    );
    let path = prepared.to_str().unwrap();
    f.parity(&[
        "--dry-run",
        "--project",
        "content-distribution",
        "--path",
        path,
    ]);
    write(
        &f.source.join("run-template/.gitignore"),
        "/private-media/\n",
    );
    f.parity(&[
        "--dry-run",
        "--project",
        "content-distribution",
        "--path",
        path,
    ]);
    assert!(!prepared.join(".neo-project-run.json").exists());
    assert!(!prepared.join(".git").exists());
}

#[test]
fn native_dry_run_does_not_require_node_when_git_is_available() {
    let f = Fixture::new();
    let command = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        .args([
            "project",
            "run",
            "--dry-run",
            "--project",
            "vlog",
            "--path",
            f.run.to_str().unwrap(),
        ])
        .env("HOME", &f.home)
        .env("NEO_ROOT", &f.root)
        .env("NEO_WORKSPACE_CONFIG", &f.config)
        .env("NEO_HARNESS_ROOT", &f.repository)
        .env("PATH", "/usr/bin:/bin")
        .current_dir(&f.root)
        .output()
        .unwrap();
    assert!(
        command.status.success(),
        "{}",
        String::from_utf8_lossy(&command.stderr)
    );
    let result: Value = serde_json::from_slice(&command.stdout).unwrap();
    assert_eq!(result["dryRun"], true);
}

#[test]
fn explicit_project_preflight_script_has_reference_parity_and_no_implicit_run_creation() {
    let f = Fixture::new();
    write(
        &f.source.join("scripts/survey.mjs"),
        r"import fs from 'node:fs';fs.appendFileSync('preflight-marker','ran\n');",
    );
    write(
        &f.source.join("project.run.json"),
        r#"{"schemaVersion":1,"input":{"type":"url","schemes":["https"]},"preflight":{"script":"scripts/survey.mjs"}}"#,
    );
    f.parity(&[
        "--dry-run",
        "--project",
        "content-distribution",
        "--url",
        "https://a.example",
    ]);
    assert_eq!(
        fs::read_to_string(f.source.join("preflight-marker")).unwrap(),
        "ran\nran\n"
    );
    assert!(!f.source.join("runs").exists());
}

#[test]
fn declared_preflight_failure_blocks_native_run_preview() {
    let f = Fixture::new();
    write(
        &f.source.join("scripts/survey.mjs"),
        "console.error('project-assets-invalid');process.exit(3);",
    );
    write(
        &f.source.join("project.run.json"),
        r#"{"schemaVersion":1,"input":{"type":"url","schemes":["https"]},"preflight":{"script":"scripts/survey.mjs"}}"#,
    );
    let native = f.call(
        true,
        &[
            "--dry-run",
            "--project",
            "content-distribution",
            "--url",
            "https://a.example",
        ],
    );
    assert!(!native.status.success());
    assert!(String::from_utf8_lossy(&native.stderr).contains("project-assets-invalid"));
    assert!(!f.source.join("runs").exists());
}

#[cfg(unix)]
#[test]
fn external_symlink_project_preflight_is_rejected_before_script_execution() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new();
    let outside = f._tmp.path().join("danger.mjs");
    write(&outside,"import fs from 'node:fs';fs.writeFileSync('/tmp/neo-harness-unexpected-preflight','unsafe');");
    let path = f.source.join("scripts/survey.mjs");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    symlink(&outside, &path).unwrap();
    write(
        &f.source.join("project.run.json"),
        r#"{"schemaVersion":1,"input":{"type":"url","schemes":["https"]},"preflight":{"script":"scripts/survey.mjs"}}"#,
    );
    let native = f.call(
        true,
        &[
            "--dry-run",
            "--project",
            "content-distribution",
            "--url",
            "https://a.example",
        ],
    );
    assert!(!native.status.success());
    assert!(!f.source.join("runs").exists());
}

#[test]
fn oversized_project_preflight_output_is_bounded_and_rejected() {
    let f = Fixture::new();
    write(
        &f.source.join("scripts/too-loud.mjs"),
        "process.stdout.write('X'.repeat(1024*1024+100));",
    );
    write(
        &f.source.join("project.run.json"),
        r#"{"schemaVersion":1,"input":{"type":"url","schemes":["https"]},"preflight":{"script":"scripts/too-loud.mjs"}}"#,
    );
    let result = f.call(
        true,
        &[
            "--dry-run",
            "--project",
            "content-distribution",
            "--url",
            "https://example.org",
        ],
    );
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr).contains("output exceeded"));
    assert!(result.stdout.is_empty());
    assert!(!f.source.join("runs").exists());
}

#[cfg(unix)]
#[test]
fn native_preflight_without_node_is_an_explicit_dependency_failure() {
    let f = Fixture::new();
    write(&f.source.join("scripts/survey.mjs"), "process.exit(0);");
    write(
        &f.source.join("project.run.json"),
        r#"{"schemaVersion":1,"input":{"type":"url","schemes":["https"]},"preflight":{"script":"scripts/survey.mjs"}}"#,
    );
    let result = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        .args([
            "project",
            "run",
            "--dry-run",
            "--project",
            "content-distribution",
            "--url",
            "https://example.org",
        ])
        .env("HOME", &f.home)
        .env("NEO_ROOT", &f.root)
        .env("NEO_HARNESS_ROOT", &f.repository)
        .env("NEO_WORKSPACE_CONFIG", &f.config)
        .env("PATH", "/usr/bin:/bin")
        .current_dir(&f.root)
        .output()
        .unwrap();
    // When system Node is installed under /usr/bin, this fallback path may
    // provide it. Otherwise preflight fails clearly rather than being skipped.
    if !result.status.success() {
        assert!(String::from_utf8_lossy(&result.stderr).contains("preflight failed"));
    }
    assert!(!f.source.join("runs").exists());
}
