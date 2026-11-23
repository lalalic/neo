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
    fn reference(&self, name: &str, path: Option<&str>) -> (bool, Value) {
        let module = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../.bin/neo-project-run.mjs")
            .canonicalize()
            .unwrap();
        let source = r#"const {safeProject,validateRunPath}=await import(process.env.NEO_ORACLE_MODULE);
  try {const s=safeProject(process.argv[1],process.argv[2]);const p=process.argv[3]==='-'?null:validateRunPath(process.argv[3],s);
  console.log(JSON.stringify({root:s.root,project:s.project,graph:s.graph,declaration:s.declaration,run:p}));}
  catch(e){console.error(e.message);process.exitCode=1;}"#;
        let r = Command::new("node")
            .args(["--input-type=module", "--eval", source])
            .arg(&self.root)
            .arg(name)
            .arg(path.unwrap_or("-"))
            .env("NEO_ORACLE_MODULE", module)
            .output()
            .unwrap();
        if r.status.success() {
            (true, serde_json::from_slice(&r.stdout).unwrap())
        } else {
            (
                false,
                json!({"error":String::from_utf8_lossy(&r.stderr).trim()}),
            )
        }
    }
    fn parity(&self, name: &str, path: Option<&Path>) {
        let (reference, expected) = self.reference(name, path.and_then(Path::to_str));
        let local=safe_project(&self.root,name).and_then(|s|{
   let run=path.map(|p|validate_run_path(p,&s)).transpose()?;
   Ok(json!({"root":s.root,"project":s.project,"graph":s.graph,"declaration":s.declaration,"run":run}))
  });
        assert_eq!(
            reference,
            local.is_ok(),
            "native={:?}; reference={expected}",
            local.as_ref().err()
        );
        if reference {
            assert_eq!(local.unwrap(), expected);
        }
    }
}
#[test]
fn safe_project_and_canonical_run_are_reference_equivalent() {
    let f = Fixture::new();
    f.parity("vlog", None);
    f.parity("vlog", Some(&f.run));
}
#[test]
fn traversal_and_broken_project_declarations_are_rejected() {
    let f = Fixture::new();
    for name in ["../vlog", ".", "not-existing"] {
        f.parity(name, None);
    }
    let bad = f
        .project
        .join("runs/2026-11-03-episode/../2026-11-03-episode");
    f.parity("vlog", Some(&bad));
    for date in [
        "2026-02-30-episode",
        "2026-11-99-episode",
        "nonsense",
        "2026-11-03..",
        "0000-01-01-old",
    ] {
        let path = f.project.join("runs").join(date);
        fs::create_dir_all(&path).unwrap();
        f.parity("vlog", Some(&path));
    }
    put(
        &f.project.join("project.run.json"),
        "{\"schemaVersion\":2,\"input\":{\"type\":\"path\"}}",
    );
    f.parity("vlog", None);
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
    f.parity("vlog", Some(&linked.join("2026-11-03-foreign")));
    let linked_project = f.root.join("alias");
    symlink(&external, &linked_project).unwrap();
    f.parity("alias", None);
    // No candidate validation operation creates a private binding.
    assert!(!f.run.join(".neo-project-run.json").exists());
}
#[test]
fn series_depth_and_invalid_directory_are_rejected() {
    let f = Fixture::new();
    let deeper = f.project.join("runs/series/season/2026-11-03-episode");
    fs::create_dir_all(&deeper).unwrap();
    f.parity("vlog", Some(&deeper));
    let file = f.project.join("runs/2026-11-03-media");
    put(&file, "file");
    f.parity("vlog", Some(&file));
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
    f.parity("vlog", Some(&f.run));
    assert_eq!(before, git(&f.run, &["rev-parse", "HEAD"]));
    assert_eq!(status, git(&f.run, &["status", "--porcelain"]));
    assert!(!f.run.join(".neo-project-run.json").exists());
}
