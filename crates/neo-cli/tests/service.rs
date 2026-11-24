mod contracts;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

#[cfg(unix)]
struct Fixture {
    _temp: tempfile::TempDir,
    root: PathBuf,
    home: PathBuf,
    stub_bin: PathBuf,
    trace: PathBuf,
}
#[cfg(unix)]
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let home = temp.path().join("home");
        fs::create_dir_all(&home).unwrap();
        let stub_bin = temp.path().join("bin");
        fs::create_dir_all(&stub_bin).unwrap();
        let trace = temp.path().join("calls.txt");
        let pm2 = stub_bin.join("pm2");
        fs::write(&pm2,r#"#!/bin/sh
if [ "$1" = jlist ]; then
 printf '%s\n' '[{"name":"neo/service","pm2_env":{"status":"online"},"pid":413},{"name":"neoy","pm2_env":{"status":"duplicate"},"pid":99},{"name":"off","pm2_env":{"status":"stopped"},"pid":null}]'
else
 echo "pm2 $*" >> "$SERVICE_TRACE"
 echo "action-ok"
fi
"#).unwrap();
        let launchctl = stub_bin.join("launchctl");
        fs::write(
            &launchctl,
            r#"#!/bin/sh
if [ "$1" = print ]; then
 printf 'state = running\npid = 921\n'
else
 echo "launchctl $*" >> "$SERVICE_TRACE"
 echo "action-ok"
fi
"#,
        )
        .unwrap();
        for file in [&pm2, &launchctl] {
            fs::set_permissions(file, fs::Permissions::from_mode(0o755)).unwrap();
        }
        Self {
            _temp: temp,
            root,
            home,
            stub_bin,
            trace,
        }
    }
    fn call(&self, args: &[&str]) -> Output {
        let mut command = Command::new(env!("CARGO_BIN_EXE_neo-rs"));
        let path = format!(
            "{}:{}",
            self.stub_bin.display(),
            std::env::var("PATH").unwrap_or_default()
        );
        command
            .args(["service"])
            .args(args)
            .env("HOME", &self.home)
            .env("NEO_HARNESS_ROOT", &self.root)
            .env("SERVICE_TRACE", &self.trace)
            .env("PATH", path)
            .current_dir(&self.root)
            .output()
            .unwrap()
    }
    fn traced(&self) -> String {
        fs::read_to_string(&self.trace).unwrap_or_default()
    }
}
#[cfg(unix)]
#[test]
fn native_service_list_status_and_duplicate_neoy_identity_equal_reference() {
    let f = Fixture::new();
    for args in [
        vec!["list"],
        vec!["status", "neo/service"],
        vec!["status", "neoy/app"],
    ] {
        let b = f.call(&args);
        contracts::assert_output("service", &args, &b, &[]);
    }
    assert!(f.traced().is_empty(), "service inventory must be read-only");
}
#[cfg(unix)]
#[test]
fn native_service_denies_mutations_without_apply_and_unknown_names() {
    let f = Fixture::new();
    for args in [
        vec!["restart", "neo/service"],
        vec!["start", "not-managed", "--apply"],
        vec!["stop", "neoy/app", "--apply"],
        vec!["start", "/invalid", "--apply"],
        vec!["restart", "neo/service", "--wrong"],
    ] {
        let result = f.call(&args);
        assert!(
            !result.status.success(),
            "unsafe request accepted: {args:?}"
        );
        assert!(result.stdout.is_empty());
    }
    assert!(
        f.traced().is_empty(),
        "rejected operations may not mutate managers"
    );
}
#[cfg(unix)]
#[test]
fn explicit_apply_delegates_only_to_canonical_manager_and_existing_name() {
    let f = Fixture::new();
    for args in [
        vec!["restart", "neo/service", "--apply"],
        vec!["start", "neoy/app", "--apply"],
        vec!["restart", "neoy/app", "--apply"],
    ] {
        let result = f.call(&args);
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
    let seen = f.traced();
    assert!(seen.contains("pm2 restart neo/service\n"));
    assert!(seen.contains("launchctl kickstart gui/"));
    assert!(seen.contains("launchctl kickstart -k gui/"));
    assert!(!seen.contains("pm2 restart neoy"));
}
