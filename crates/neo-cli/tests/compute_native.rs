use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};
struct Fixture {
    temp: tempfile::TempDir,
    home: PathBuf,
    project: PathBuf,
    bin: PathBuf,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        fs::create_dir_all(&home).unwrap();
        let project = temp.path().join("sample");
        fs::create_dir_all(&project).unwrap();
        let bin = temp.path().join("bin");
        fs::create_dir_all(&bin).unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        Self {
            temp,
            home,
            project,
            bin,
            root,
        }
    }
    fn run(&self, args: &[&str]) -> Output {
        let mut command = Command::new(env!("CARGO_BIN_EXE_neo-rs"));
        command
            .args(args)
            .env("HOME", &self.home)
            .env("NEO_GPU_STATE_DIR", self.temp.path().join("leases"))
            .env(
                "NEO_GPU_REGISTRY_FILE",
                self.temp.path().join("services.json"),
            )
            .env("NEO_HARNESS_ROOT", &self.root)
            .env(
                "PATH",
                format!("{}:/opt/homebrew/bin:/usr/bin:/bin", self.bin.display()),
            )
            .current_dir(&self.project)
            .output()
            .unwrap()
    }
    fn json(&self, args: &[&str]) -> Value {
        let output = self.run(args);
        assert!(
            output.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice(&output.stdout).unwrap()
    }
    fn fake(&self, name: &str, script: &str) {
        let path = self.bin.join(name);
        fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
        #[cfg(unix)]
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }
    fn repo(&self) {
        let git = |args: &[&str]| {
            let output = Command::new("git")
                .args(args)
                .current_dir(&self.project)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&["init", "--quiet"]);
        git(&["config", "user.email", "fixture@example.test"]);
        git(&["config", "user.name", "Fixture"]);
        fs::write(
            self.project.join("Dockerfile"),
            "FROM scratch\nCMD [\"/bin/true\"]\n",
        )
        .unwrap();
        git(&["add", "Dockerfile"]);
        git(&["commit", "--quiet", "-m", "fixture"]);
        git(&[
            "remote",
            "add",
            "origin",
            "https://github.com/test-owner/sample.git",
        ]);
    }
}
#[test]
fn native_compute_read_only_services_matches_empty_registry_and_requires_no_node_on_path() {
    let f = Fixture::new();
    let native = f.json(&["compute", "services"]);
    assert_eq!(native, json!({"version":1,"services":{}}));
    let output = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        .args(["compute", "services"])
        .env("HOME", &f.home)
        .env("PATH", "/usr/bin:/bin")
        .env("NEO_GPU_REGISTRY_FILE", f.temp.path().join("services.json"))
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap(),
        native
    );
}
#[test]
fn native_compute_run_dry_run_matches_provider_plan_and_performs_no_rental() {
    let f = Fixture::new();
    let output = f.temp.path().join("result.mp4");
    let output = output.to_str().unwrap();
    let args = [
        "compute",
        "run",
        "--image",
        "ghcr.io/test-owner/service:sha-abcdef012345",
        "--provider",
        "hf",
        "--output",
        output,
        "--dry-run",
    ];
    let a = f.json(&args);
    assert_eq!(a["mode"], "dry_run");
    assert_eq!(a["provider"], "hf");
    assert_eq!(a["allowSpend"], false);
    assert_eq!(a["image"], "ghcr.io/test-owner/service:sha-abcdef012345");
    assert!(!output.to_string().contains("SYNTHETIC_SECRET"));
    assert!(!f.temp.path().join("leases").exists());
}
#[test]
fn native_compute_rejects_invalid_cost_and_remote_job_before_any_provider_action() {
    let f = Fixture::new();
    f.fake("hf", "echo CALLED > \"$HOME/provider-called\"; exit 0");
    let output = f.temp.path().join("result.mp4");
    let output = output.to_str().unwrap();
    for extra in [vec![], vec!["--budget", "99"], vec!["--max-seconds", "60"]] {
        let mut args = vec![
            "compute",
            "run",
            "--image",
            "ghcr.io/test-owner/demo:v1",
            "--output",
            output,
        ];
        args.extend(extra);
        let result = f.run(&args);
        assert!(!result.status.success());
        assert!(result.stdout.is_empty());
    }
    assert!(!f.home.join("provider-called").exists());
}
#[test]
fn native_compute_build_plan_matches_canonical_image_identity_and_no_docker_invocation() {
    let f = Fixture::new();
    f.repo();
    f.fake(
        "docker",
        "echo DOCKER_CALLED > \"$HOME/docker-called\"; exit 0",
    );
    let args = [
        "compute",
        "build",
        "--project",
        f.project.to_str().unwrap(),
        "--builder",
        "local",
        "--dry-run",
    ];
    let native = f.json(&args);
    let commit = String::from_utf8(
        Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&f.project)
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_string();
    assert_eq!(native["name"], "sample");
    assert_eq!(native["commit"], commit);
    assert_eq!(native["dockerfile"], "Dockerfile");
    assert_eq!(native["builder"], "local");
    assert_eq!(native["mode"], "batch");
    assert_eq!(native["push"], true);
    assert!(native["image"]
        .as_str()
        .unwrap()
        .starts_with("ghcr.io/test-owner/sample-gpu:sha-"));
    assert_eq!(native["runtimeHash"].as_str().unwrap().len(), 64);
    assert!(native["buildId"].is_null());
    assert!(!f.home.join("docker-called").exists());
}
#[test]
fn native_compute_cleanup_rejects_untrusted_paths_and_does_not_call_providers() {
    let f = Fixture::new();
    f.fake("hf", "echo CALLED > \"$HOME/provider-called\"");
    for path in [
        "/tmp/not-a-lease.json",
        "relative/lease-0123456789abcdef00.json",
    ] {
        let status = f.run(&["compute", "cleanup", "--lease", path]);
        assert!(!status.status.success());
        assert!(status.stdout.is_empty());
    }
    assert!(!f.home.join("provider-called").exists());
}
#[test]
fn native_compute_cleanup_reconciles_hf_job_and_persists_a_private_destroyed_record() {
    let f = Fixture::new();
    let leases = f.temp.path().join("leases");
    fs::create_dir_all(&leases).unwrap();
    let file = leases.join("lease-0123456789abcdef00.json");
    fs::write(
        &file,
        json!({"provider":"hf","phase":"running","jobId":"abcdef012345abcdef012345"}).to_string(),
    )
    .unwrap();
    f.fake("hf","if [ \"$1\" = jobs ] && [ \"$2\" = inspect ]; then echo '{\"status\":{\"stage\":\"CANCELED\"}}'; fi");
    let result = f.json(&["compute", "cleanup", "--lease", file.to_str().unwrap()]);
    assert_eq!(result["phase"], "destroyed");
    assert_eq!(result["terminalStatus"], "CANCELED");
    let stored: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    assert_eq!(stored["phase"], "destroyed");
    assert_eq!(
        f.json(&["compute", "cleanup", "--lease", file.to_str().unwrap()])["already"],
        true
    );
    #[cfg(unix)]
    assert_eq!(
        fs::metadata(file).unwrap().permissions().mode() & 0o777,
        0o600
    );
}
#[test]
fn legacy_gpu_cli_is_rejected_and_no_node_subprocess_is_started() {
    let f = Fixture::new();
    f.fake("node", "echo NODE_CALLED > \"$HOME/node-called\"");
    let result = f.run(&["gpu", "services"]);
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr).contains("obsolete"));
    assert!(!f.home.join("node-called").exists());
}

#[test]
fn native_hf_rental_cost_gate_blocks_any_provider_create_or_lease() {
    let f = Fixture::new();
    f.fake("hf",r#"
if [ "$1" = jobs ] && [ "$2" = hardware ]; then echo '[{"name":"l4x1","cost/hour":"$30"}]'; exit 0; fi
if [ "$1" = jobs ] && [ "$2" = run ]; then echo 'WRONG_PAID_CREATE' > "$HOME/paid-created"; exit 0; fi
exit 4
"#);
    let output = f.temp.path().join("result.mp4");
    let reply = f.run(&[
        "compute",
        "run",
        "--image",
        "ghcr.io/test/demo:v1",
        "--output",
        output.to_str().unwrap(),
        "--allow-spend",
        "--budget",
        "2",
    ]);
    assert!(!reply.status.success());
    assert!(String::from_utf8_lossy(&reply.stderr).contains("exceeds budget"));
    assert!(!f.home.join("paid-created").exists());
    assert!(!f.temp.path().join("leases").exists());
}
#[test]
fn native_hf_ambiguous_create_preserves_unique_label_and_does_not_retry_or_claim_success() {
    let f = Fixture::new();
    f.fake("hf",r#"
if [ "$1" = jobs ] && [ "$2" = hardware ]; then echo '[{"name":"l4x1","cost/hour":"$0.50"}]'; exit 0; fi
if [ "$1" = jobs ] && [ "$2" = run ]; then
 echo invoked >> "$HOME/creation-attempts"
 exit 72
fi
exit 0
"#);
    let output = f.temp.path().join("result.mp4");
    let reply = f.run(&[
        "compute",
        "run",
        "--image",
        "ghcr.io/test/demo:v1",
        "--output",
        output.to_str().unwrap(),
        "--allow-spend",
        "--budget",
        "2",
    ]);
    assert!(!reply.status.success());
    assert!(reply.stdout.is_empty());
    assert_eq!(
        fs::read_to_string(f.home.join("creation-attempts"))
            .unwrap()
            .lines()
            .count(),
        1
    );
    let leases = fs::read_dir(f.temp.path().join("leases"))
        .unwrap()
        .collect::<Vec<_>>();
    assert_eq!(leases.len(), 1);
    let lease: Value =
        serde_json::from_slice(&fs::read(leases[0].as_ref().unwrap().path()).unwrap()).unwrap();
    assert_eq!(lease["phase"], "unreconciled_create");
    assert!(lease["label"].as_str().unwrap().starts_with("neo-gpu-"));
    assert!(lease["jobId"].is_null());
    assert!(!output.exists());
}

fn web_fixture(f: &Fixture) {
    fs::write(
        f.temp.path().join("services.json"),
        json!({"version":1,"services":{
  "demo":{"image":"ghcr.io/test-owner/demo:sha-abcdef012345","repository":"test-owner/demo",
   "mode":"web","appPort":7860,"published":true}}})
        .to_string(),
    )
    .unwrap();
}
#[test]
fn native_web_compute_register_token_rotate_status_update_remove_lifecycle() {
    let f = Fixture::new();
    web_fixture(&f);
    let registered = f.json(&["compute", "web", "add", "demo"]);
    assert_eq!(registered["service"], "demo");
    assert_eq!(registered["provider"], "hf");
    let original = registered["token"].as_str().unwrap().to_owned();
    assert_eq!(original.len(), 43);
    let read = f.json(&["compute", "web", "token", "demo"]);
    assert_eq!(read["token"], original);
    let status = f.json(&["compute", "web", "status", "demo"]);
    assert_eq!(status["session"]["phase"], "stopped");
    assert_eq!(status["config"]["provider"], "hf");
    let rotated = f.json(&["compute", "web", "rotate", "demo"]);
    assert_eq!(rotated["rotated"], true);
    assert_ne!(rotated["token"], original);
    assert_eq!(
        f.json(&["compute", "web", "token", "demo"])["token"],
        rotated["token"]
    );
    let refresh = f.json(&["compute", "web", "update", "demo"]);
    assert_eq!(refresh["tokenPreserved"], true);
    assert_eq!(refresh["changed"], false);
    let removed = f.json(&["compute", "web", "remove", "demo"]);
    assert_eq!(removed["phase"], "removed");
    assert_eq!(f.json(&["compute", "web", "status"]), json!({}));
    #[cfg(unix)]
    {
        let dir = f.home.join(".config/neo/gpu/web/tokens");
        assert_eq!(
            fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }
}
#[test]
fn native_web_compute_requires_spend_consent_and_blocks_over_budget_rental() {
    let f = Fixture::new();
    web_fixture(&f);
    f.json(&["compute", "web", "add", "demo"]);
    f.fake("hf",r#"
if [ "$1" = jobs ] && [ "$2" = hardware ]; then echo '[{"name":"l4x1","cost/hour":"$99"}]'; exit 0; fi
if [ "$1" = jobs ] && [ "$2" = run ]; then echo BILLABLE_JOB_CALLED > "$HOME/billable"; exit 0; fi
exit 10
"#);
    let denied = f.run(&["compute", "web", "start", "demo"]);
    assert!(!denied.status.success());
    assert!(String::from_utf8_lossy(&denied.stderr).contains("--allow-spend"));
    let expensive = f.run(&["compute", "web", "start", "demo", "--allow-spend"]);
    assert!(!expensive.status.success());
    assert!(String::from_utf8_lossy(&expensive.stderr).contains("exceeds budget"));
    assert!(!f.home.join("billable").exists());
    assert!(!f.temp.path().join("leases").exists());
    assert_eq!(
        f.json(&["compute", "web", "status", "demo"])["session"]["phase"],
        "stopped"
    );
}
#[test]
fn native_web_compute_kernel_lock_remains_usable_after_stale_filename() {
    let f = Fixture::new();
    web_fixture(&f);
    f.json(&["compute", "web", "add", "demo"]);
    let lock = f.home.join(".local/state/neo/gpu/web/demo.json.lock");
    fs::create_dir_all(lock.parent().unwrap()).unwrap();
    fs::write(&lock, "obsolete legacy lockfile").unwrap();
    let token = f.json(&["compute", "web", "rotate", "demo"]);
    assert_eq!(token["rotated"], true);
    assert!(
        lock.exists(),
        "flock must not depend on unlinking a filename"
    );
}
#[test]
fn native_web_compute_gateway_rejects_unsafe_public_origin_before_listening() {
    let f = Fixture::new();
    let result = f.run(&[
        "compute",
        "web",
        "serve",
        "--port",
        "8798",
        "--origin",
        "http://external.example.com",
    ]);
    assert!(!result.status.success());
    assert!(result.stdout.is_empty());
    assert!(String::from_utf8_lossy(&result.stderr).contains("origin must use HTTPS"));
}

#[test]
fn native_web_compute_status_and_registered_config_are_deterministic() {
    let rust = Fixture::new();
    let peer = Fixture::new();
    web_fixture(&rust);
    web_fixture(&peer);
    let native = rust.json(&["compute", "web", "add", "demo"]);
    let second = peer.json(&["compute", "web", "add", "demo"]);
    for field in ["service", "url", "provider", "hardShutdownSeconds"] {
        assert_eq!(native[field], second[field], "Web add parity: {field}");
    }
    let ours = rust.json(&["compute", "web", "status", "demo"]);
    let reference = peer.json(&["compute", "web", "status", "demo"]);
    for field in ["service", "config", "session", "url"] {
        assert_eq!(ours[field], reference[field], "Web status parity: {field}");
    }
}

#[test]
fn native_hf_unknown_create_can_cancel_only_job_with_exact_persisted_label() {
    let f = Fixture::new();
    let leases = f.temp.path().join("leases");
    fs::create_dir_all(&leases).unwrap();
    let location = leases.join("lease-0123456789abcdef00.json");
    let label = "neo-gpu-test123456";
    fs::write(
        &location,
        json!({"provider":"hf","phase":"unreconciled_create","label":label}).to_string(),
    )
    .unwrap();
    f.fake("hf",r#"
if [ "$1" = jobs ] && [ "$2" = ls ]; then
 echo '[{"name":"neo-gpu-test123456","id":"abcdef012345abcdef012345","status":{"stage":"RUNNING"}},{"name":"another-tenant-job","id":"111111111111111111111111","status":{"stage":"RUNNING"}}]'
 exit 0
fi
if [ "$1" = jobs ] && [ "$2" = cancel ]; then echo "$3" >> "$HOME/hf-canceled"; exit 0; fi
if [ "$1" = jobs ] && [ "$2" = inspect ]; then echo '{"status":{"stage":"CANCELED"}}'; exit 0; fi
exit 12
"#);
    let response = f.json(&["compute", "cleanup", "--lease", location.to_str().unwrap()]);
    assert_eq!(response["phase"], "destroyed");
    assert_eq!(response["terminalStatus"], "reconciled_canceled");
    assert_eq!(
        fs::read_to_string(f.home.join("hf-canceled"))
            .unwrap()
            .trim(),
        "abcdef012345abcdef012345"
    );
    let state: Value = serde_json::from_slice(&fs::read(location).unwrap()).unwrap();
    assert_eq!(state["phase"], "destroyed");
}
#[test]
fn native_web_starting_session_recovers_to_stopped_after_watchdog_verifies_cleanup() {
    let f = Fixture::new();
    web_fixture(&f);
    f.json(&["compute", "web", "add", "demo"]);
    let leases = f.temp.path().join("leases");
    fs::create_dir_all(&leases).unwrap();
    let lease = leases.join("lease-0123456789abcdef00.json");
    fs::write(
        &lease,
        json!({"provider":"hf","phase":"destroyed","terminalStatus":"reconciled_canceled"})
            .to_string(),
    )
    .unwrap();
    let session = f.home.join(".local/state/neo/gpu/web/demo.json");
    fs::create_dir_all(session.parent().unwrap()).unwrap();
    fs::write(
        &session,
        json!({"phase":"starting","provider":"hf","lease":lease}).to_string(),
    )
    .unwrap();
    let recovered = f.json(&["compute", "web", "status", "demo"]);
    assert_eq!(recovered["session"]["phase"], "stopped");
    assert_eq!(
        recovered["session"]["terminalStatus"],
        "reconciled_canceled"
    );
}

#[test]
fn native_local_docker_build_runs_exactly_two_builds_and_no_push_without_permission() {
    let f = Fixture::new();
    f.repo();
    f.fake(
        "docker",
        r#"
echo "$*" >> "$HOME/docker-commands"
if [ "$1" = image ] && [ "$2" = inspect ]; then
  echo '[{"Config":{"Entrypoint":null,"Cmd":["/bin/true"]}}]'
fi
exit 0
"#,
    );
    let project = f.project.to_str().unwrap();
    let request = [
        "compute",
        "build",
        "--project",
        project,
        "--builder",
        "local",
        "--no-push",
    ];
    let result = f.json(&request);
    assert_eq!(result["event"], "neo_gpu_service_built");
    assert_eq!(result["service"], "sample");
    assert_eq!(result["published"], false);
    let calls = fs::read_to_string(f.home.join("docker-commands")).unwrap();
    assert_eq!(
        calls
            .lines()
            .filter(|line| line.starts_with("build "))
            .count(),
        2
    );
    assert_eq!(
        calls
            .lines()
            .filter(|line| line.starts_with("image inspect "))
            .count(),
        1
    );
    assert_eq!(
        calls
            .lines()
            .filter(|line| line.starts_with("push "))
            .count(),
        0
    );
    let services = f.json(&["compute", "services"]);
    assert_eq!(services["services"]["sample"]["published"], false);
}
#[test]
fn native_github_builder_requires_explicit_push_and_uses_authoritative_workflow_status() {
    let f = Fixture::new();
    f.repo();
    let branch = Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(&f.project)
        .output()
        .unwrap();
    let branch = String::from_utf8(branch.stdout).unwrap();
    let branch = branch.trim();
    assert!(!branch.is_empty());
    let refname = format!("refs/remotes/origin/{branch}");
    assert!(Command::new("git")
        .args(["update-ref", &refname, "HEAD"])
        .current_dir(&f.project)
        .status()
        .unwrap()
        .success());
    assert!(Command::new("git")
        .args(["branch", "--set-upstream-to", &format!("origin/{branch}")])
        .current_dir(&f.project)
        .status()
        .unwrap()
        .success());
    f.fake("gh",r#"
echo "$*" >> "$HOME/gh-commands"
if [ "$1" = repo ] && [ "$2" = view ]; then echo '{"isPrivate":false}'; exit 0; fi
if [ "$1" = workflow ] && [ "$2" = run ]; then
  for arg in "$@"; do case "$arg" in build_id=*) echo "${arg#build_id=}" > "$HOME/gh-build-id" ;; esac; done
  exit 0
fi
if [ "$1" = run ] && [ "$2" = list ]; then
  name=$(cat "$HOME/gh-build-id")
  printf '[{"databaseId":99,"displayTitle":"synthetic %s","status":"completed","conclusion":"success"}]\n' "$name"
  exit 0
fi
exit 23
"#);
    let project = f.project.to_str().unwrap();
    let denied = f.run(&[
        "compute",
        "build",
        "--project",
        project,
        "--builder",
        "github",
    ]);
    assert!(!denied.status.success());
    assert!(
        !f.home.join("gh-commands").exists(),
        "no gh action without explicit --push"
    );
    let output = f.run(&[
        "compute",
        "build",
        "--project",
        project,
        "--builder",
        "github",
        "--push",
    ]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let events = serde_json::Deserializer::from_slice(&output.stdout)
        .into_iter::<Value>()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(
        events.len(),
        2,
        "Hosted builder must report dispatch and completion"
    );
    assert_eq!(events[0]["event"], "image_build_dispatched");
    let result = &events[1];
    assert_eq!(result["event"], "neo_gpu_service_built");
    assert_eq!(result["published"], true);
    let commands = fs::read_to_string(f.home.join("gh-commands")).unwrap();
    assert_eq!(
        commands
            .lines()
            .filter(|l| l.starts_with("workflow run "))
            .count(),
        1
    );
    assert_eq!(
        commands
            .lines()
            .filter(|l| l.starts_with("run list "))
            .count(),
        1
    );
    let registry = f.json(&["compute", "services"]);
    assert_eq!(registry["services"]["sample"]["published"], true);
}

#[test]
fn native_web_hf_session_paid_lifecycle_runs_once_and_verifies_cancellation() {
    let f = Fixture::new();
    web_fixture(&f);
    f.json(&["compute", "web", "add", "demo"]);
    f.fake("hf",r#"
if [ "$1" = jobs ] && [ "$2" = hardware ]; then echo '[{"name":"l4x1","cost/hour":"$0.50"}]'; exit 0; fi
if [ "$1" = jobs ] && [ "$2" = run ]; then
  echo "CREATE $*" >> "$HOME/hf-paid-events"
  echo 'abcdef012345abcdef012345'
  exit 0
fi
if [ "$1" = jobs ] && [ "$2" = cancel ]; then
  echo "CANCEL $3" >> "$HOME/hf-paid-events"
  exit 0
fi
if [ "$1" = jobs ] && [ "$2" = inspect ]; then
  echo '{"status":{"stage":"CANCELED"}}'
  exit 0
fi
exit 26
"#);
    let running = f.json(&["compute", "web", "start", "demo", "--allow-spend"]);
    assert_eq!(running["phase"], "running");
    let session = f.json(&["compute", "web", "status", "demo"]);
    assert_eq!(session["session"]["phase"], "running");
    assert_eq!(session["session"]["jobId"], "abcdef012345abcdef012345");
    let lease = Path::new(session["session"]["lease"].as_str().unwrap());
    let initial: Value = serde_json::from_slice(&fs::read(lease).unwrap()).unwrap();
    assert_eq!(initial["phase"], "running");
    assert!(initial["label"]
        .as_str()
        .unwrap()
        .starts_with("neo-gpu-web-"));
    let stopped = f.json(&["compute", "web", "stop", "demo"]);
    assert_eq!(stopped["phase"], "stopped");
    assert_eq!(stopped["terminalStatus"], "CANCELED");
    let final_record: Value = serde_json::from_slice(&fs::read(lease).unwrap()).unwrap();
    assert_eq!(final_record["phase"], "destroyed");
    let events = fs::read_to_string(f.home.join("hf-paid-events")).unwrap();
    assert_eq!(
        events.lines().filter(|s| s.starts_with("CREATE ")).count(),
        1
    );
    assert_eq!(
        events.lines().filter(|s| s.starts_with("CANCEL ")).count(),
        1
    );
    assert!(events.contains("CANCEL abcdef012345abcdef012345"));
}

#[test]
fn native_vast_offer_filter_blocks_unverified_gpu_before_paid_instance_creation() {
    let f = Fixture::new();
    f.fake("vastai",r#"
if [ "$1" = show ] && [ "$2" = instances ]; then echo '[]'; exit 0; fi
if [ "$1" = search ] && [ "$2" = offers ]; then
  echo '[{"id":12,"gpu_name":"RTX 4090","num_gpus":1,"rentable":true,"verification":"unverified","reliability2":0.99,"gpu_ram":24576,"cpu_ram":64000,"disk_space":120,"dph_total":0.5,"driver_version":"580.1","geolocation":"Chicago, US"}]'
  exit 0
fi
if [ "$1" = create ]; then echo 'UNSAFE_PAID_CREATE' > "$HOME/vast-created"; exit 0; fi
exit 25
"#);
    let output = f.temp.path().join("vast-output.mp4");
    let request = f.run(&[
        "compute",
        "run",
        "--image",
        "ghcr.io/test/demo:v1",
        "--provider",
        "vast",
        "--output",
        output.to_str().unwrap(),
        "--allow-spend",
    ]);
    assert!(!request.status.success());
    assert!(String::from_utf8_lossy(&request.stderr).contains("No verified Vast GPU offer"));
    assert!(!f.home.join("vast-created").exists());
    assert!(!f.temp.path().join("leases").exists());
}
