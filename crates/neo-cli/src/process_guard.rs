//! Bounded external process capture for explicitly owned extension/provider
//! executables. Never infer success from a timeout, nonzero exit or overflow.
use std::{
    io::{Read, Write},
    process::{Command, ExitStatus, Stdio},
    sync::mpsc,
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
    capture_inner(command, None, timeout, output_limit, false)
}

/// Captures an optional short, in-memory stdin payload without putting it in
/// argv, shell history or temporary files. Useful for trusted WebHelm code.
pub fn capture_with_input(
    command: &mut Command,
    input: Option<&[u8]>,
    timeout: Duration,
    output_limit: usize,
) -> Result<Captured, String> {
    capture_inner(command, input, timeout, output_limit, true)
}

fn capture_inner(
    command: &mut Command,
    input: Option<&[u8]>,
    timeout: Duration,
    output_limit: usize,
    isolated: bool,
) -> Result<Captured, String> {
    if input.is_some_and(|text| text.len() > 128 * 1024) {
        return Err("input exceeded the configured limit".into());
    }
    command
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Stateless model tools run in their own process group so a timed-out
    // shell/WebHelm subprocess cannot leave descendants holding pipes open.
    // Service management and run-preflight capture retain their original
    // process-group semantics via `capture()` above.
    #[cfg(unix)]
    if isolated {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|e| format!("spawn error: {e}"))?;
    #[cfg(unix)]
    let group = if isolated {
        Some(child.id() as i32)
    } else {
        None
    };
    let writer = if let Some(data) = input {
        let mut pipe = child.stdin.take().ok_or("process stdin unavailable")?;
        let bytes = data.to_vec();
        Some(thread::spawn(move || pipe.write_all(&bytes)))
    } else {
        None
    };
    let stdout = child.stdout.take().ok_or("process stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("process stderr unavailable")?;
    let (tx, rx) = mpsc::channel();
    let stdout_tx = tx.clone();
    let stdout_reader = thread::spawn(move || {
        let data = collect_limited(stdout, output_limit);
        let _ = stdout_tx.send(());
        data
    });
    let stderr_reader = thread::spawn(move || {
        let data = collect_limited(stderr, output_limit);
        let _ = tx.send(());
        data
    });
    let since = Instant::now();
    let (status, timed_out) = loop {
        match child.try_wait() {
            Ok(Some(code)) => break (code, false),
            Ok(None) if since.elapsed() < timeout => thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                #[cfg(unix)]
                if let Some(pgid) = group {
                    unsafe {
                        libc::kill(-pgid, libc::SIGKILL);
                    }
                }
                let _ = child.kill();
                break (child.wait().map_err(|e| e.to_string())?, true);
            }
            Err(e) => {
                #[cfg(unix)]
                if let Some(pgid) = group {
                    unsafe {
                        libc::kill(-pgid, libc::SIGKILL);
                    }
                }
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("wait error: {e}"));
            }
        }
    };
    // Even if the direct child has exited, its background descendants may
    // still have our stdout/stderr pipes. Never wait forever for EOF.
    // The two bounded readers signal completion; only tool-owned process
    // groups are terminated if that signal stalls.
    let mut readers_done = true;
    if isolated {
        for _ in 0..2 {
            if rx.recv_timeout(Duration::from_millis(350)).is_err() {
                readers_done = false;
                break;
            }
        }
        if !readers_done {
            #[cfg(unix)]
            if let Some(pgid) = group {
                unsafe {
                    libc::kill(-pgid, libc::SIGKILL);
                }
            }
        }
    }
    let write_error = writer
        .map(|handle| {
            handle
                .join()
                .map_err(|_| "stdin writer failed".to_string())
                .and_then(|result| result.map_err(|e| format!("stdin send failed: {e}")))
        })
        .transpose();
    let (stdout, stdout_large) = stdout_reader.join().map_err(|_| "stdout reader failed")??;
    let (stderr, stderr_large) = stderr_reader.join().map_err(|_| "stderr reader failed")??;
    if timed_out {
        return Err("timed out".into());
    }
    if !readers_done {
        return Err(
            "tool subprocess left background output pipes open; descendants terminated".into(),
        );
    }
    write_error?;
    if stdout_large || stderr_large {
        return Err("output exceeded the configured limit".into());
    }
    Ok(Captured {
        status,
        stdout,
        stderr,
    })
}
