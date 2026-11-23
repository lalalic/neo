//! Bounded external process capture for explicitly owned extension/provider
//! executables. Never infer success from a timeout, nonzero exit or overflow.
use std::{
    io::Read,
    process::{Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

pub struct Captured {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

fn collect_limited<R: Read>(mut stream: R, limit: usize) -> Result<(Vec<u8>, bool), String> {
    let mut captured = Vec::new();
    let mut overflow = false;
    let mut buf = [0u8; 8192];
    loop {
        let count = stream.read(&mut buf).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        if count > limit.saturating_sub(captured.len()) {
            overflow = true;
        } else {
            captured.extend_from_slice(&buf[..count]);
        }
    }
    Ok((captured, overflow))
}

pub fn capture(
    command: &mut Command,
    timeout: Duration,
    output_limit: usize,
) -> Result<Captured, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| format!("spawn error: {e}"))?;
    let stdout = child.stdout.take().ok_or("process stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("process stderr unavailable")?;
    let stdout_reader = thread::spawn(move || collect_limited(stdout, output_limit));
    let stderr_reader = thread::spawn(move || collect_limited(stderr, output_limit));
    let since = Instant::now();
    let (status, timed_out) = loop {
        match child.try_wait() {
            Ok(Some(code)) => break (code, false),
            Ok(None) if since.elapsed() < timeout => thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                let _ = child.kill();
                break (child.wait().map_err(|e| e.to_string())?, true);
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("wait error: {e}"));
            }
        }
    };
    let (stdout, stdout_large) = stdout_reader.join().map_err(|_| "stdout reader failed")??;
    let (stderr, stderr_large) = stderr_reader.join().map_err(|_| "stderr reader failed")??;
    if timed_out {
        return Err("timed out".into());
    }
    if stdout_large || stderr_large {
        return Err("output exceeded the configured limit".into());
    }
    Ok(Captured {
        status,
        stdout,
        stderr,
    })
}
