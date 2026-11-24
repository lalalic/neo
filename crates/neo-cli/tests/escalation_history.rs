mod contracts;
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::{symlink, PermissionsExt};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};
struct Fixture {
    _tmp: tempfile::TempDir,
    cases: PathBuf,
    challenges: PathBuf,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let cases = tmp.path().join("private/cases");
        let challenges = tmp.path().join("private/challenges");
        for dir in [&cases, &challenges] {
            fs::create_dir_all(dir).unwrap();
            #[cfg(unix)]
            fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).unwrap();
        }
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        Self {
            _tmp: tmp,
            cases,
            challenges,
            root,
        }
    }
    fn invoke(&self, args: &[&str]) -> Output {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_neo-rs"));
        cmd.args(["escalation"])
            .args(args)
            .env("NEO_ESCALATION_CASES_DIR", &self.cases)
            .env("NEO_ESCALATION_CHALLENGES_DIR", &self.challenges)
            .env("NEO_HARNESS_ROOT", &self.root)
            .output()
            .unwrap()
    }
    fn write(path: &Path, doc: &Value) {
        fs::write(path, serde_json::to_string_pretty(doc).unwrap() + "\n").unwrap();
    }
    fn seed(&self) {
        let id1 = "a".repeat(64);
        let id2 = "b".repeat(64);
        Self::write(
            &self.cases.join(format!("{id1}.json")),
            &json!({"version":1,"id":id1,
    "captured_at":"2026-11-23T12:00:00.000Z","outcome":"resolved",
    "scenario":{"key":"printer_no_network","category":"network","symptom":"printer offline"},
    "strategy":{"key":"wireless_setup","steps":["configure SSID"],"lesson":"Print when online"},
    "observation":{"tools":["computer-use"],"calls":1,"failures":0}}),
        );
        Self::write(
            &self.cases.join(format!("{id2}.json")),
            &json!({"version":1,"id":id2,
    "captured_at":"2026-11-23T13:00:00.000Z","outcome":"taught",
    "scenario":{"key":"local_voice","category":"tooling","symptom":"offline sound"},
    "strategy":{"key":"voice_setup","steps":["set default"],"lesson":"Check codec"},
    "observation":{"tools":[],"calls":0,"failures":0}}),
        );
        fs::write(self.cases.join("ignored.json"), "{}").unwrap();
        let cid = "c".repeat(64);
        let folder = self.challenges.join(&cid);
        fs::create_dir(&folder).unwrap();
        #[cfg(unix)]
        fs::set_permissions(&folder, fs::Permissions::from_mode(0o700)).unwrap();
        Self::write(
            &folder.join("challenge.json"),
            &json!({"version":1,"id":cid,"created_at":"2026-11-23T13:00:00.000Z",
    "goal":"Check test-only work","blocker":"missing local configuration", "handoff":"Goal: Check test-only work"}),
        );
        let aid = "11111111-1111-1111-1111-111111111111";
        Self::write(
            &folder.join(format!("{aid}.started.json")),
            &json!({"version":1,"challenge_id":cid,"attempt_id":aid,"event":"started","at":"2026-11-23T13:01:00.000Z"}),
        );
        Self::write(
            &folder.join(format!("{aid}.checkpoint.json")),
            &json!({"challenge_id":cid,"attempt_id":aid,"event":"checkpoint","at":"2026-11-23T13:02:00.000Z","stage":"resource_lock"}),
        );
        Self::write(
            &folder.join(format!("{aid}.finished.json")),
            &json!({"version":1,"challenge_id":cid,"attempt_id":aid,"event":"finished","at":"2026-11-23T13:03:00.000Z","outcome":"resolved","summary":"test fixture verified"}),
        );
    }
}
#[test]
fn native_history_lists_and_filters_private_cases_exactly_like_reference() {
    let f = Fixture::new();
    f.seed();
    for args in [
        vec!["cases"],
        vec!["cases", "--limit", "1"],
        vec!["cases", "--search", "WIRELESS"],
        vec!["cases", "--search", "not-found"],
    ] {
        let rust = f.invoke(&args);
        contracts::assert_output("history", &args, &rust, &[]);
    }
}
#[test]
fn native_history_preserves_challenge_attempt_order_and_omits_stale_checkpoints() {
    let f = Fixture::new();
    f.seed();
    for args in [
        vec!["challenges"],
        vec!["challenges", "--search", "CONFIGURATION"],
        vec!["challenges", "--limit", "1"],
        vec!["challenges", "--search", "no-match"],
    ] {
        let rust = f.invoke(&args);
        contracts::assert_output("history", &args, &rust, &[]);
        let b: Value = serde_json::from_slice(&rust.stdout).unwrap();
        if args.len() == 1 {
            assert_eq!(b[0]["attempts"].as_array().unwrap().len(), 2);
        }
    }
}
#[test]
fn native_history_missing_roots_are_read_only_and_return_empty_array() {
    let f = Fixture::new();
    fs::remove_dir_all(&f.cases).unwrap();
    fs::remove_dir_all(&f.challenges).unwrap();
    for cmd in ["cases", "challenges"] {
        let native = f.invoke(&[cmd]);
        assert!(native.status.success());
        assert_eq!(
            serde_json::from_slice::<Value>(&native.stdout).unwrap(),
            json!([])
        );
    }
    assert!(!f.cases.exists());
    assert!(!f.challenges.exists());
}
#[test]
fn native_history_rejects_unknown_flags_limits_and_invalid_root() {
    let f = Fixture::new();
    for args in [
        vec!["cases", "--limit", "0"],
        vec!["challenges", "--limit", "201"],
        vec!["cases", "--limit", "x"],
        vec!["challenges", "--unknown", "x"],
        vec!["cases", "--search"],
    ] {
        let native = f.invoke(&args);
        assert!(!native.status.success());
        assert!(native.stdout.is_empty());
    }
    let native = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        .args(["escalation", "cases"])
        .env("NEO_ESCALATION_CASES_DIR", "relative/bad")
        .output()
        .unwrap();
    assert!(!native.status.success());
}
#[cfg(unix)]
#[test]
fn private_history_rejects_symlinked_challenge_root_and_does_not_follow_events() {
    let f = Fixture::new();
    f.seed();
    let real = f.challenges.with_extension("original");
    fs::rename(&f.challenges, &real).unwrap();
    symlink(&real, &f.challenges).unwrap();
    let result = f.invoke(&["challenges"]);
    assert!(!result.status.success());
    assert!(result.stdout.is_empty());
    assert!(real.exists());
}
