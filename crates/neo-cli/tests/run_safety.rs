use neo_harness_cli::run_validation::{safe_project, validate_run_path};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
struct Fixture {
    _dir: tempfile::TempDir,
    root: PathBuf,
    project: PathBuf,
    run: PathBuf,
}
fn put(p: &Path, s: &str) {
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, s).unwrap();
}
impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("projects");
        let project = root.join("vlog");
        let run = project.join("runs/2026-11-03-episode");
        fs::create_dir_all(&run).unwrap();
        for file in ["AGENTS.md", "README.md", "graph.mmd"] {
            put(&project.join(file), "some text\n");
        }
        put(&project.join("project.run.json"),"{\"schemaVersion\":1,\"input\":{\"type\":\"path\",\"path\":{\"base\":\"runs\",\"datedRunDirectory\":true}}}");
        Self {
            _dir: dir,
            root,
            project,
            run,
        }
    }

    fn assert_contract(&self, name: &str, path: Option<&Path>, expected: bool) {
        let local=safe_project(&self.root,name).and_then(|s|{
            let run=path.map(|p|validate_run_path(p,&s)).transpose()?;
            Ok(json!({"root":s.root,"project":s.project,"graph":s.graph,"declaration":s.declaration,"run":run}))
        });
        assert_eq!(
            local.is_ok(),
            expected,
            "{name} {path:?}: {:?}",
            local.as_ref().err()
        );
        if let Ok(value) = local {
            assert_eq!(
                value["project"],
                self.project.canonicalize().unwrap().to_str().unwrap()
            );
            assert_eq!(
                value["run"],
                path.map(|p| json!(p.canonicalize().unwrap()))
                    .unwrap_or(Value::Null)
            );
        }
    }
}
#[test]
fn safe_project_and_canonical_run_are_valid() {
    let f = Fixture::new();
    f.assert_contract("vlog", None, true);
    f.assert_contract("vlog", Some(&f.run), true);
}
#[test]
fn traversal_and_broken_project_declarations_are_rejected() {
    let f = Fixture::new();
    for name in ["../vlog", ".", "not-existing"] {
        f.assert_contract(name, None, false);
    }
    let bad = f
        .project
        .join("runs/2026-11-03-episode/../2026-11-03-episode");
    f.assert_contract("vlog", Some(&bad), false);
    for date in [
        "2026-02-30-episode",
        "2026-11-99-episode",
        "nonsense",
        "2026-11-03..",
        "0000-01-01-old",
    ] {
        let path = f.project.join("runs").join(date);
        fs::create_dir_all(&path).unwrap();
        f.assert_contract("vlog", Some(&path), date == "0000-01-01-old");
    }
    put(
        &f.project.join("project.run.json"),
        "{\"schemaVersion\":2,\"input\":{\"type\":\"path\"}}",
    );
    f.assert_contract("vlog", None, false);
}
#[cfg(unix)]
#[test]
fn symlink_escape_is_rejected_without_writing() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new();
    let external = f._dir.path().join("outside");
    fs::create_dir_all(&external).unwrap();
    let linked = f.project.join("runs/series-link");
    symlink(&external, &linked).unwrap();
    let foreign = external.join("2026-11-03-foreign");
    fs::create_dir_all(&foreign).unwrap();
    f.assert_contract("vlog", Some(&linked.join("2026-11-03-foreign")), false);
    let linked_project = f.root.join("alias");
    symlink(&external, &linked_project).unwrap();
    f.assert_contract("alias", None, false);
    // No candidate validation operation creates a private binding.
    assert!(!f.run.join(".neo-project-run.json").exists());
}
#[test]
fn series_depth_and_invalid_directory_are_rejected() {
    let f = Fixture::new();
    let deeper = f.project.join("runs/series/season/2026-11-03-episode");
    fs::create_dir_all(&deeper).unwrap();
    f.assert_contract("vlog", Some(&deeper), false);
    let file = f.project.join("runs/2026-11-03-media");
    put(&file, "file");
    f.assert_contract("vlog", Some(&file), false);
}

#[test]
fn existing_private_run_git_is_not_touched_by_validation() {
    let f = Fixture::new();
    fn git(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }
    git(&f.run, &["init", "-q"]);
    put(&f.run.join(".gitignore"), "private/\n");
    git(&f.run, &["add", ".gitignore"]);
    git(
        &f.run,
        &[
            "-c",
            "user.name=fixture",
            "-c",
            "user.email=fixture@localhost",
            "commit",
            "-q",
            "-m",
            "init",
        ],
    );
    let before = git(&f.run, &["rev-parse", "HEAD"]);
    let status = git(&f.run, &["status", "--porcelain"]);
    f.assert_contract("vlog", Some(&f.run), true);
    assert_eq!(before, git(&f.run, &["rev-parse", "HEAD"]));
    assert_eq!(status, git(&f.run, &["status", "--porcelain"]));
    assert!(!f.run.join(".neo-project-run.json").exists());
}
