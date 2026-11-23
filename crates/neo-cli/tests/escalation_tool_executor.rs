use neo_harness_cli::{
    escalation_stateless::ToolResult,
    escalation_tool_executor::{self as executor, Settings},
};
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{fs, path::PathBuf};
struct Fixture {
    temp: tempfile::TempDir,
    settings: Settings,
    args_file: PathBuf,
    stdin_file: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let cwd = temp.path().join("private-project");
        fs::create_dir_all(&cwd).unwrap();
        let bin = temp.path().join("webhelm-mock");
        let args_file = temp.path().join("webhelm-argv.txt");
        let stdin_file = temp.path().join("webhelm-stdin.txt");
        let content = format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\ncat > '{}'\nprintf 'fixture-webhelm-ok\\n'\n",
            args_file.display(),
            stdin_file.display()
        );
        fs::write(&bin, content).unwrap();
        #[cfg(unix)]
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        let mut settings = Settings::new(cwd);
        settings.webhelm_executable = bin;
        Self {
            temp,
            settings,
            args_file,
            stdin_file,
        }
    }
    fn exec(&self, name: &str, args: &Value) -> Result<ToolResult, String> {
        executor::execute_with(name, args, &self.settings, |_, _| {
            panic!("unexpected Computer Use provider call")
        })
    }
}
#[test]
fn native_shell_runs_bounded_local_command_without_creating_transcript() {
    let f = Fixture::new();
    let result = f
        .exec("shell", &json!({"command":"printf local-ok"}))
        .unwrap();
    assert!(result.ok);
    assert_eq!(result.text, "local-ok");
    assert!(fs::read_dir(&f.settings.cwd).unwrap().next().is_none());
}
#[test]
fn native_shell_blocks_environment_credential_exfiltration_before_process() {
    let f = Fixture::new();
    for cmd in [
        "printenv",
        "env",
        "set",
        "printf $USER_ACCOUNTS",
        "printf \"$USER_PASSWORDS\"",
    ] {
        let result = f.exec("shell", &json!({"command":cmd})).unwrap();
        assert!(!result.ok, "forbidden command executed: {cmd}");
        assert!(result.text.contains("blocked"));
    }
    let blank = f.exec("shell", &json!({"command":" "}));
    assert!(blank.is_err());
}
#[test]
fn native_webhelm_execution_passes_only_argv_and_private_stdin_code() {
    let f = Fixture::new();
    let javascript = "console.log(await snapshot());";
    let result = f
        .exec(
            "webhelm",
            &json!({"args":["session","exec","a1b2c3d4e5f6a7b8"],"code":javascript}),
        )
        .unwrap();
    assert!(result.ok, "{}", result.text);
    assert_eq!(result.text, "fixture-webhelm-ok\n");
    assert_eq!(
        fs::read_to_string(&f.args_file).unwrap(),
        "session\nexec\na1b2c3d4e5f6a7b8\n"
    );
    assert_eq!(fs::read_to_string(&f.stdin_file).unwrap(), javascript);
    assert!(!fs::read_to_string(f.args_file)
        .unwrap()
        .contains("snapshot"));
}
#[test]
fn native_webhelm_rejects_code_outside_session_exec_and_empty_execution() {
    let f = Fixture::new();
    for input in [
        json!({"args":["session","list"],"code":"console.log(123)"}),
        json!({"args":["session","exec","foo"],"code":"x".repeat(30001)}),
        json!({"args":["session","exec","foo"],"code":123}),
        json!({"args":["status"],"unsafe":"payload"}),
        json!({"args":["status",1]}),
        json!({"args":[]}),
    ] {
        assert!(
            f.exec("webhelm", &input).is_err(),
            "invalid WebHelm request accepted: {input}"
        );
    }
    let empty = f
        .exec(
            "webhelm",
            &json!({"args":["session","exec","valid-session"]}),
        )
        .unwrap();
    assert!(!empty.ok);
    assert!(
        !f.args_file.exists(),
        "invalid WebHelm calls must never reach executable"
    );
}
#[test]
fn native_computer_use_forwards_only_allowlisted_command_and_json_object() {
    let f = Fixture::new();
    let mut calls = Vec::<(String, Value)>::new();
    let output = executor::execute_with(
        "computer_use",
        &json!({"command":"get_app_state","args":{"app":"Finder"}}),
        &f.settings,
        |name, args| {
            calls.push((name.into(), args.clone()));
            Ok(json!({"isError":false,"content":[{"type":"text","text":"fixture"}]}))
        },
    )
    .unwrap();
    assert!(output.ok);
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0], ("get_app_state".into(), json!({"app":"Finder"})));
    let blocked = executor::execute_with(
        "computer_use",
        &json!({"command":"shell","args":{}}),
        &f.settings,
        |_, _| panic!("privileged Computer Use must be rejected"),
    );
    assert!(blocked.is_err());
    let invalid = executor::execute_with(
        "computer_use",
        &json!({"command":"click","args":[]}),
        &f.settings,
        |_, _| panic!("non-object must be rejected"),
    );
    assert!(invalid.is_err());
}
#[test]
fn unauthorized_apple_login_never_reads_or_calls_webhelm() {
    let f = Fixture::new();
    let output = f
        .exec("credential_fill", &json!({"session_id":"a1b2c3d4e5f6a7b8"}))
        .unwrap();
    assert!(!output.ok);
    assert!(output.text.contains("authorization"));
    assert!(!f.args_file.exists());
    let invalid = f.exec("credential_fill", &json!({"session_id":"invalid"}));
    assert!(invalid.is_err());
}
#[test]
fn authorized_synthetic_apple_fill_checks_exact_app_domain_and_never_echoes_secrets() {
    let mut f = Fixture::new();
    f.settings.apple_login_authorized = true;
    f.settings.apple_accounts = Some("synthetic-owner@example.test".into());
    f.settings.apple_passwords = Some("SYNTHETIC-TEST-PASSWORD-479".into());
    let output = f
        .exec("credential_fill", &json!({"session_id":"a1b2c3d4e5f6a7b8"}))
        .unwrap();
    assert!(output.ok, "{}", output.text);
    assert!(!output.text.contains("synthetic-owner@example.test"));
    assert!(!output.text.contains("SYNTHETIC-TEST-PASSWORD-479"));
    let script = fs::read_to_string(&f.stdin_file).unwrap();
    assert!(script.contains("https://appstoreconnect.apple.com/"));
    assert!(script.contains("https://idmsa.apple.com/"));
    assert!(!script.contains(".click("));
    assert!(script.contains("synthetic-owner@example.test"));
    let argv = fs::read_to_string(&f.args_file).unwrap();
    assert!(!argv.contains("synthetic-owner@example.test"));
    assert!(!argv.contains("SYNTHETIC-TEST-PASSWORD-479"));
    let no_choice = f
        .settings
        .apple_accounts
        .replace("a@example.test,b@example.test".into());
    let _ = no_choice;
    f.settings.apple_passwords = Some("pass-a,pass-b".into());
    let multiple = f
        .exec("credential_fill", &json!({"session_id":"a1b2c3d4e5f6a7b8"}))
        .unwrap();
    assert!(!multiple.ok);
    assert!(multiple.text.contains("Multiple possible Apple Accounts"));
}
#[cfg(unix)]
#[test]
fn native_apple_failure_diagnostics_do_not_disclose_synthetic_credentials() {
    let mut f = Fixture::new();
    f.settings.apple_login_authorized = true;
    f.settings.apple_accounts = Some("owner@example.test".into());
    f.settings.apple_passwords = Some("syntheticTEMPSecret_3388".into());
    let bin = f.temp.path().join("webhelm-echo-error");
    fs::write(&bin, "#!/bin/sh\ncat\necho 'failed' >&2\nexit 44\n").unwrap();
    fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
    f.settings.webhelm_executable = bin;
    let result = f
        .exec("credential_fill", &json!({"session_id":"a1b2c3d4e5f6a7b8"}))
        .unwrap();
    assert!(!result.ok);
    assert!(!result.text.contains("syntheticTEMPSecret_3388"));
    assert!(!result.text.contains("owner@example.test"));
}

#[cfg(unix)]
#[test]
fn owned_tool_process_group_is_terminated_when_direct_child_times_out() {
    use neo_harness_cli::process_guard;
    use std::{
        process::Command,
        time::{Duration, Instant},
    };
    let start = Instant::now();
    let mut child = Command::new("/bin/sh");
    child.args(["-c", "sleep 30"]);
    let failed =
        process_guard::capture_with_input(&mut child, None, Duration::from_millis(350), 4096);
    assert!(failed.err().unwrap().contains("timed out"));
    assert!(
        start.elapsed() < Duration::from_secs(4),
        "model subprocess timeout must remain bounded"
    );
}

#[cfg(unix)]
#[test]
fn tool_subprocess_background_descendants_cannot_hold_output_pipes_forever() {
    use neo_harness_cli::process_guard;
    use std::{
        process::Command,
        time::{Duration, Instant},
    };
    let start = Instant::now();
    let mut child = Command::new("/bin/sh");
    child.args(["-c", "sleep 30 & echo direct-child-exited"]);
    let output = process_guard::capture_with_input(&mut child, None, Duration::from_secs(3), 4096);
    assert!(
        output.is_err(),
        "background child must not outlive the captured tool process"
    );
    assert!(
        start.elapsed() < Duration::from_secs(4),
        "orphaned output pipe cannot block Escalation for 30s"
    );
}

#[cfg(unix)]
#[test]
fn tool_captured_stdin_remains_private_and_has_size_bound() {
    use neo_harness_cli::process_guard;
    use std::{process::Command, time::Duration};
    let mut child = Command::new("/bin/cat");
    let payload = b"private synthetic browser code\n";
    let ok =
        process_guard::capture_with_input(&mut child, Some(payload), Duration::from_secs(2), 4096)
            .unwrap();
    assert!(ok.status.success());
    assert_eq!(ok.stdout, payload);
    let mut child = Command::new("/bin/cat");
    let oversized = vec![b'x'; 128 * 1024 + 1];
    let bad = process_guard::capture_with_input(
        &mut child,
        Some(&oversized),
        Duration::from_secs(2),
        4096,
    );
    assert!(bad.err().unwrap().contains("input exceeded"));
}
