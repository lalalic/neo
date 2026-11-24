//! Native global, per-host local inference resource lock.  A short-lived
//! guardian process keeps the kernel flock and cleans registered owned model
//! subprocesses if the caller exits abruptly.  No polling lease rows,
//! lockfile deletion, Python runtime, or global inference service.
#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::{
    env,
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    os::fd::AsRawFd,
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[derive(Debug, Clone)]
pub struct Config {
    pub dir: PathBuf,
    pub wait_seconds: u64,
}
pub fn config() -> Result<Config, String> {
    let dir = env::var_os("NEO_ESCALATION_LOCK_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            crate::workspace::home()
                .unwrap_or_default()
                .join(".local/state/neo/escalation")
        });
    if !dir.is_absolute() {
        return Err("NEO_ESCALATION_LOCK_DIR must be an absolute path".into());
    }
    let raw = env::var("NEO_ESCALATION_LOCK_WAIT_SECONDS").unwrap_or_else(|_| "3600".into());
    let wait = raw
        .parse::<u64>()
        .map_err(|_| "NEO_ESCALATION_LOCK_WAIT_SECONDS must be an integer")?;
    if !(1..=14400).contains(&wait) {
        return Err("NEO_ESCALATION_LOCK_WAIT_SECONDS must be between 1 and 14400".into());
    }
    Ok(Config {
        dir,
        wait_seconds: wait,
    })
}
fn private_dir(dir: &Path) -> Result<PathBuf, String> {
    if !dir.is_absolute() {
        return Err("NEO_ESCALATION_LOCK_DIR must be an absolute path".into());
    }
    #[cfg(unix)]
    {
        let mut options = fs::DirBuilder::new();
        use std::os::unix::fs::DirBuilderExt;
        options.recursive(true).mode(0o700);
        options.create(dir).map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let meta = fs::symlink_metadata(dir).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("Escalation lock directory must be a real directory".into());
    }
    #[cfg(unix)]
    if meta.permissions().mode() & 0o077 != 0 {
        return Err("Escalation lock directory must have mode 0700".into());
    }
    dir.canonicalize().map_err(|e| e.to_string())
}

#[cfg(unix)]
fn open_lock(path: &Path) -> Result<std::fs::File, String> {
    let mut opts = OpenOptions::new();
    opts.create(true)
        .read(true)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    let file = opts
        .open(path)
        .map_err(|e| format!("Cannot open Escalation inference lock: {e}"))?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.uid() != unsafe { libc::getuid() } {
        return Err("Escalation inference lock must be a regular owned file".into());
    }
    let result = unsafe { libc::fchmod(file.as_raw_fd(), 0o600) };
    if result != 0 {
        return Err("Cannot protect Escalation lock file as 0600".into());
    }
    Ok(file)
}
#[cfg(unix)]
fn stdin_closed() -> bool {
    let mut item = libc::pollfd {
        fd: libc::STDIN_FILENO,
        events: libc::POLLIN | libc::POLLHUP,
        revents: 0,
    };
    let code = unsafe { libc::poll(&mut item, 1, 0) };
    if code < 0 {
        return false;
    }
    if code == 0 {
        return false;
    }
    if item.revents & libc::POLLHUP != 0 {
        return true;
    }
    false
}
#[cfg(unix)]
fn pid_alive(pid: i32) -> bool {
    unsafe { libc::kill(pid, 0) == 0 }
}
#[cfg(unix)]
fn terminate_owned(owned: &[i32]) {
    for &pid in owned {
        if pid_alive(pid) {
            unsafe { libc::kill(pid, libc::SIGTERM) };
        }
    }
    let since = Instant::now();
    while since.elapsed() < Duration::from_secs(6) && owned.iter().any(|&pid| pid_alive(pid)) {
        thread::sleep(Duration::from_millis(100));
    }
    for &pid in owned {
        if pid_alive(pid) {
            unsafe { libc::kill(pid, libc::SIGKILL) };
        }
    }
}
/// Internal child-only entrypoint. Only the caller may send PID declarations
/// to this private inherited pipe after obtaining the model slot.
#[cfg(unix)]
pub fn guardian_main(args: &[String]) -> i32 {
    let work = || -> Result<i32, String> {
        if args.len() != 2 {
            return Err("Invalid guardian arguments".into());
        }
        let path = Path::new(&args[0]);
        let dir = path.parent().ok_or("Missing guardian lock directory")?;
        private_dir(dir)?;
        if path.file_name().and_then(|s| s.to_str()) != Some("inference.lock") {
            return Err("Invalid guardian lock basename".into());
        }
        let seconds = args[1]
            .parse::<u64>()
            .map_err(|_| "Invalid guardian timeout")?;
        if !(1..=14400).contains(&seconds) {
            return Err("Invalid guardian timeout".into());
        }
        let file = open_lock(path)?;
        let now = Instant::now();
        loop {
            if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
                break;
            }
            let error = std::io::Error::last_os_error();
            if !error
                .raw_os_error()
                .is_some_and(|c| c == libc::EWOULDBLOCK || c == libc::EAGAIN || c == libc::EINTR)
            {
                return Err(format!("Escalation lock acquisition failed: {error}"));
            }
            if now.elapsed() > Duration::from_secs(seconds) {
                println!("TIMEOUT");
                return Ok(75);
            }
            if stdin_closed() {
                return Ok(0);
            }
            thread::sleep(Duration::from_millis(150));
        }
        println!("ACQUIRED");
        std::io::stdout().flush().map_err(|e| e.to_string())?;
        let stdin = std::io::stdin();
        let mut owned = Vec::<i32>::new();
        for line in stdin.lock().lines() {
            let line = line.map_err(|_| "Guardian IPC closed unexpectedly")?;
            if let Some(raw) = line.strip_prefix("PID ") {
                if let Ok(pid) = raw.parse::<i32>() {
                    if pid > 1 && pid != unsafe { libc::getpid() } && !owned.contains(&pid) {
                        owned.push(pid);
                    }
                }
            }
            if let Some(raw) = line.strip_prefix("GROUP ") {
                if let Ok(pgid) = raw.parse::<i32>() {
                    if pgid > 1 && pgid != unsafe { libc::getpgrp() } && !owned.contains(&-pgid) {
                        owned.push(-pgid);
                    }
                }
            }
        }
        terminate_owned(&owned);
        Ok(0)
    };
    match work() {
        Ok(code) => code,
        Err(e) => {
            eprintln!("Escalation lock guardian: {e}");
            1
        }
    }
}
#[cfg(not(unix))]
pub fn guardian_main(_args: &[String]) -> i32 {
    eprintln!("Escalation native lock requires a Unix system");
    1
}

pub struct Guard {
    child: Child,
    stdin: Option<ChildStdin>,
}
impl Guard {
    pub fn register_owned_pid(&mut self, pid: u32) -> Result<(), String> {
        if pid < 2 {
            return Err("Invalid inference server PID".into());
        }
        let pipe = self
            .stdin
            .as_mut()
            .ok_or("Escalation guardian IPC closed")?;
        pipe.write_all(format!("PID {pid}\n").as_bytes())
            .map_err(|e| e.to_string())?;
        pipe.flush().map_err(|e| e.to_string())
    }
    /// Owns an isolated process group whose group ID equals its spawned
    /// leader PID. A crash must terminate its descendants as well as its
    /// top-level inference process; never register arbitrary process groups.
    #[cfg(unix)]
    pub fn register_owned_group(&mut self, leader: u32) -> Result<(), String> {
        if leader < 2 {
            return Err("Invalid owned model process group".into());
        }
        let pid = leader as i32;
        if unsafe { libc::getpgid(pid) } != pid {
            return Err("Model PID is not the leader of an isolated process group".into());
        }
        let pipe = self
            .stdin
            .as_mut()
            .ok_or("Escalation guardian IPC closed")?;
        pipe.write_all(format!("GROUP {pid}\n").as_bytes())
            .map_err(|e| e.to_string())?;
        pipe.flush().map_err(|e| e.to_string())
    }
    pub fn finish(mut self) -> Result<(), String> {
        self.stdin.take();
        let started = Instant::now();
        loop {
            match self.child.try_wait() {
                Ok(Some(status)) => {
                    return if status.success() {
                        Ok(())
                    } else {
                        Err(format!("Escalation guardian exited: {status}"))
                    }
                }
                Ok(None) if started.elapsed() < Duration::from_secs(12) => {
                    thread::sleep(Duration::from_millis(50))
                }
                Ok(None) => {
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    return Err("Escalation guardian cleanup exceeded 12 seconds".into());
                }
                Err(e) => return Err(e.to_string()),
            }
        }
    }
}
impl Drop for Guard {
    fn drop(&mut self) {
        self.stdin.take();
    }
}
pub fn acquire(config: &Config) -> Result<Guard, String> {
    acquire_with_binary(config, &env::current_exe().map_err(|e| e.to_string())?)
}

/// Testable explicit binary hook; production always uses the current Rust
/// executable. Never shells out to Python or a Node lock helper.
pub fn acquire_with_binary(config: &Config, binary: &Path) -> Result<Guard, String> {
    let dir = private_dir(&config.dir)?;
    let lock = dir.join("inference.lock");
    let mut child = Command::new(binary)
        .arg("__escalation-lock-guardian")
        .arg(&lock)
        .arg(config.wait_seconds.to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Escalation guardian spawn failed: {e}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or("Escalation guardian stdin unavailable")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Escalation guardian stdout unavailable")?;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|e| e.to_string())?;
    match line.trim() {
        "ACQUIRED" => Ok(Guard {
            child,
            stdin: Some(stdin),
        }),
        "TIMEOUT" => {
            drop(stdin);
            let _ = child.wait();
            Err(format!(
                "Neo escalation is busy: global model lock timed out after {}s",
                config.wait_seconds
            ))
        }
        _ => {
            drop(stdin);
            let _ = child.wait();
            Err("Escalation lock guardian exited before acquisition".into())
        }
    }
}
