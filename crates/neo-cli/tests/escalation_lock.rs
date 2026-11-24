#![cfg(unix)]
use neo_harness_cli::escalation_lock::{self, Config};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    os::unix::fs::{symlink, PermissionsExt},
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant},
};
struct Fixture {
    _temp: tempfile::TempDir,
    dir: PathBuf,
    binary: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("private-locks");
        let binary = PathBuf::from(env!("CARGO_BIN_EXE_neo-rs"));
        Self {
            _temp: temp,
            dir,
            binary,
        }
    }
    fn cfg(&self, wait_seconds: u64) -> Config {
        Config {
            dir: self.dir.clone(),
            wait_seconds,
        }
    }
    fn acquire(&self, wait_seconds: u64) -> Result<escalation_lock::Guard, String> {
        escalation_lock::acquire_with_binary(&self.cfg(wait_seconds), &self.binary)
    }
}
#[test]
fn private_persistent_flock_serializes_native_clis_and_times_out() {
    let f = Fixture::new();
    let lock = f.acquire(3).unwrap();
    assert!(f.dir.join("inference.lock").is_file());
    assert_eq!(
        fs::metadata(&f.dir).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(f.dir.join("inference.lock"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    let start = Instant::now();
    let blocked = f.acquire(1);
    assert!(blocked.is_err());
    assert!(blocked.err().unwrap().contains("timed out"));
    assert!(start.elapsed() >= Duration::from_millis(950));
    lock.finish().unwrap();
    let next = f.acquire(3).unwrap();
    next.finish().unwrap();
    assert!(
        f.dir.join("inference.lock").exists(),
        "release never deletes the shared lock inode"
    );
}
#[test]
fn native_flock_refuses_public_or_symlinked_lock_directory() {
    let f = Fixture::new();
    fs::create_dir(&f.dir).unwrap();
    fs::set_permissions(&f.dir, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(f.acquire(1).is_err());
    let another = f._temp.path().join("link");
    symlink(&f.dir, &another).unwrap();
    assert!(escalation_lock::acquire_with_binary(
        &Config {
            dir: another,
            wait_seconds: 1
        },
        &f.binary
    )
    .is_err());
}
#[test]
fn owned_model_pid_is_terminated_when_caller_closes_guardian_pipe() {
    let f = Fixture::new();
    let mut guardian = f.acquire(3).unwrap();
    let mut dummy = Command::new("/bin/sleep").arg("30").spawn().unwrap();
    guardian.register_owned_pid(dummy.id()).unwrap();
    guardian.finish().unwrap();
    let status = dummy.wait().unwrap();
    assert!(
        !status.success(),
        "owned model must be terminated by the guardian"
    );
    let next = f.acquire(3).unwrap();
    next.finish().unwrap();
}
#[test]
fn guardian_releases_lock_when_parent_disappears_without_explicit_finish() {
    let f = Fixture::new();
    fs::create_dir(&f.dir).unwrap();
    fs::set_permissions(&f.dir, fs::Permissions::from_mode(0o700)).unwrap();
    let mut guardian = Command::new(&f.binary)
        .args([
            "__escalation-lock-guardian",
            f.dir.join("inference.lock").to_str().unwrap(),
            "3",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdout = BufReader::new(guardian.stdout.take().unwrap());
    let mut line = String::new();
    stdout.read_line(&mut line).unwrap();
    assert_eq!(line, "ACQUIRED\n");
    let mut model = Command::new("/bin/sleep").arg("30").spawn().unwrap();
    writeln!(guardian.stdin.as_mut().unwrap(), "PID {}", model.id()).unwrap();
    // A SIGKILL-ed owner loses its pipe write end. This is the exact EOF
    // condition the child observes, independent of the reason for the death.
    guardian.stdin.take();
    let done = guardian.wait().unwrap();
    assert!(done.success());
    assert!(!model.wait().unwrap().success());
    let later = f.acquire(3).unwrap();
    later.finish().unwrap();
}
#[test]
fn native_lock_interoperates_with_independent_kernel_flock() {
    let f = Fixture::new();
    fs::create_dir(&f.dir).unwrap();
    fs::set_permissions(&f.dir, fs::Permissions::from_mode(0o700)).unwrap();
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(f.dir.join("inference.lock"))
        .unwrap();
    use std::os::fd::AsRawFd;
    assert_eq!(unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) }, 0);
    let released = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1400));
        drop(file);
    });
    let start = Instant::now();
    let guard = f.acquire(4).unwrap();
    assert!(start.elapsed() >= Duration::from_millis(950));
    guard.finish().unwrap();
    released.join().unwrap();
}

#[cfg(unix)]
#[test]
fn guardian_terminates_entire_owned_model_process_group_on_requester_pipe_close() {
    use std::os::unix::process::CommandExt;
    let f = Fixture::new();
    let mut guard = f.acquire(3).unwrap();
    let mut command = Command::new("/bin/sh");
    command.args(["-c", "sleep 30 & wait"]).process_group(0);
    let mut owned = command.spawn().unwrap();
    guard.register_owned_group(owned.id()).unwrap();
    let began = Instant::now();
    guard.finish().unwrap();
    assert!(began.elapsed() < Duration::from_secs(12));
    let status = owned.wait().unwrap();
    assert!(!status.success());
    // The next request obtains the same lock immediately after cleanup.
    let next = f.acquire(3).unwrap();
    next.finish().unwrap();
}
