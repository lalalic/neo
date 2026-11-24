#[cfg(unix)]
use std::os::unix::fs::{symlink, PermissionsExt};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};
struct Fixture {
    _tmp: tempfile::TempDir,
    source: PathBuf,
    output: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("demo-skill");
        fs::create_dir_all(&source).unwrap();
        let output = tmp.path().join("rust.zip");
        Self {
            _tmp: tmp,
            source,
            output,
        }
    }
    fn put(&self, name: &str, bytes: &[u8]) {
        let path = self.source.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }
    fn native(&self) -> Output {
        Command::new(env!("CARGO_BIN_EXE_neo-rs"))
            .args([
                "skill",
                "package",
                self.source.to_str().unwrap(),
                self.output.to_str().unwrap(),
            ])
            .env("PATH", "/usr/bin:/bin")
            .output()
            .unwrap()
    }
}
fn contents(path: &Path) -> Vec<(String, Vec<u8>)> {
    let names = Command::new("/usr/bin/unzip")
        .args(["-Z", "-1", path.to_str().unwrap()])
        .output()
        .unwrap();
    assert!(
        names.status.success(),
        "{}",
        String::from_utf8_lossy(&names.stderr)
    );
    let names = String::from_utf8(names.stdout).unwrap();
    names
        .lines()
        .filter(|name| !name.ends_with('/'))
        .map(|name| {
            let extracted = Command::new("/usr/bin/unzip")
                .args(["-p", path.to_str().unwrap(), name])
                .output()
                .unwrap();
            assert!(extracted.status.success());
            (name.to_string(), extracted.stdout)
        })
        .collect()
}
#[test]
fn native_skill_zip_preserves_text_content_and_layout() {
    let f = Fixture::new();
    f.put(
        "SKILL.md",
        b"---\nname: demo-skill\ndescription: test\n---\n# Demo\n",
    );
    f.put("scripts/run.sh", b"#!/bin/sh\necho healthy\n");
    f.put(
        "docs/cafe.md",
        "Cafe \u{00e9} and \u{4e2d}\u{6587}\n".as_bytes(),
    );
    f.put("binary.dat", &[0, 1, 2, 3]);
    f.put("node_modules/secret.js", b"should not package\n");
    f.put(".git/config", b"secret=unused\n");
    let rust = f.native();
    assert!(
        rust.status.success(),
        "{}",
        String::from_utf8_lossy(&rust.stderr)
    );
    let mut a = contents(&f.output);
    a.sort_by(|x, y| x.0.cmp(&y.0));
    let expected = vec![
        (
            "demo-skill/SKILL.md".to_string(),
            fs::read(f.source.join("SKILL.md")).unwrap(),
        ),
        (
            "demo-skill/docs/cafe.md".to_string(),
            fs::read(f.source.join("docs/cafe.md")).unwrap(),
        ),
        (
            "demo-skill/scripts/run.sh".to_string(),
            fs::read(f.source.join("scripts/run.sh")).unwrap(),
        ),
    ];
    assert_eq!(a, expected);
    assert_eq!(a.len(), 3);
    assert!(a.iter().all(|(name, _)| name.starts_with("demo-skill/")));
    #[cfg(unix)]
    assert_eq!(
        fs::metadata(&f.output).unwrap().permissions().mode() & 0o777,
        0o600
    );
}
#[test]
fn native_skill_zip_refuses_overwrite_invalid_extension_and_missing_manifest() {
    let f = Fixture::new();
    assert!(!f.native().status.success());
    f.put("SKILL.md", b"---\nname: demo\n---\n");
    assert!(f.native().status.success());
    let before = fs::read(&f.output).unwrap();
    assert!(!f.native().status.success());
    assert_eq!(before, fs::read(&f.output).unwrap());
    let output = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        .args([
            "skill",
            "package",
            f.source.to_str().unwrap(),
            f.source.join("bad.txt").to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(!output.status.success());
}
#[cfg(unix)]
#[test]
fn native_archive_skips_external_symlink_instead_of_exfiltrating_file() {
    let f = Fixture::new();
    f.put("SKILL.md", b"---\nname: demo\n---\n");
    let secret = f._tmp.path().join("outside-private.txt");
    fs::write(&secret, "CREDENTIAL-SHOULD-NOT-LEAK").unwrap();
    symlink(&secret, f.source.join("private.txt")).unwrap();
    let outside_dir = f._tmp.path().join("outside-dir");
    fs::create_dir_all(&outside_dir).unwrap();
    fs::write(outside_dir.join("secret.md"), "never ship").unwrap();
    symlink(&outside_dir, f.source.join("linked-docs")).unwrap();
    let result = f.native();
    assert!(result.status.success());
    let bytes = fs::read(&f.output).unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("CREDENTIAL-SHOULD-NOT-LEAK"));
    let names = contents(&f.output);
    assert_eq!(names.len(), 1);
    assert_eq!(names[0].0, "demo-skill/SKILL.md");
}
