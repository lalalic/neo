//! One process-owned local inference server. Its stdout/stderr remain in a
//! disposable 0700 directory, and the native guardian holds its PID under
//! the global flock until model teardown completes. No daemon is installed.
use crate::{escalation_contract, escalation_lock};
use serde_json::Value;
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{
    fs::{self, OpenOptions},
    net::TcpListener,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

pub struct OwnedServer {
    child: Child,
    _private: tempfile::TempDir,
    endpoint: String,
}
impl OwnedServer {
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }
    pub fn start(
        config: &escalation_contract::Config,
        guardian: &mut escalation_lock::Guard,
    ) -> Result<Self, String> {
        if config.engine == "external" {
            return Err("External inference has no owned model process".into());
        }
        let args = escalation_contract::server_args(config, 54321)?;
        if args.is_empty() {
            return Err("Empty local inference server arguments".into());
        }
        let listener =
            TcpListener::bind("127.0.0.1:0").map_err(|_| "Cannot allocate local inference port")?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        drop(listener);
        let args = escalation_contract::server_args(config, port)?;
        let private = tempfile::Builder::new()
            .prefix("neo-escalation-server-")
            .tempdir()
            .map_err(|_| "Cannot create private local model temporary directory")?;
        #[cfg(unix)]
        fs::set_permissions(private.path(), fs::Permissions::from_mode(0o700))
            .map_err(|_| "Cannot protect local model diagnostic directory")?;
        let log_path = private.path().join("server.log");
        let mut log = OpenOptions::new();
        log.write(true).create_new(true);
        #[cfg(unix)]
        log.mode(0o600);
        let log = log
            .open(&log_path)
            .map_err(|_| "Cannot open private local model diagnostics")?;
        let error = log
            .try_clone()
            .map_err(|_| "Cannot duplicate private local model diagnostic file")?;
        let mut cmd = Command::new(&config.server_command);
        cmd.args(args)
            .current_dir(private.path())
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(error));
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        let child = cmd.spawn().map_err(|_| {
            "Local model server failed to launch; raw inference diagnostics suppressed"
        })?;
        let mut server = Self {
            child,
            _private: private,
            endpoint: format!("http://127.0.0.1:{port}/v1"),
        };
        #[cfg(unix)]
        let registration = guardian.register_owned_group(server.child.id());
        #[cfg(not(unix))]
        let registration = guardian.register_owned_pid(server.child.id());
        if let Err(e) = registration {
            server.close();
            return Err(format!(
                "Local model PID could not be registered with the exclusive guardian: {e}"
            ));
        }
        if let Err(e) = server.ready(Duration::from_millis(u64::from(config.startup_ms))) {
            server.close();
            return Err(e);
        }
        Ok(server)
    }
    fn ready(&mut self, timeout: Duration) -> Result<(), String> {
        let started = Instant::now();
        let health = self.endpoint.replace("/v1", "/health");
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_millis(550)))
            .max_redirects(0)
            .max_redirects_will_error(true)
            .http_status_as_error(false)
            .build()
            .new_agent();
        loop {
            if self.child.try_wait().map_err(|e| e.to_string())?.is_some() {
                return Err("Local model server exited during startup; raw inference diagnostics suppressed".into());
            }
            if let Ok(mut response) = agent.get(&health).call() {
                if response.status().is_success() {
                    let body: Value = response
                        .body_mut()
                        .with_config()
                        .limit(64 * 1024)
                        .read_json()
                        .unwrap_or_else(|_| serde_json::json!({}));
                    if matches!(body["status"].as_str(), Some("ok" | "ready"))
                        || body.as_object().is_some_and(|o| o.is_empty())
                    {
                        return Ok(());
                    }
                }
            }
            if started.elapsed() >= timeout {
                return Err(
                    "Local inference server startup timed out; raw diagnostics suppressed".into(),
                );
            }
            thread::sleep(Duration::from_millis(125));
        }
    }
    pub fn close(&mut self) {
        let Ok(status) = self.child.try_wait() else {
            return;
        };
        if status.is_some() {
            return;
        }
        #[cfg(unix)]
        unsafe {
            libc::kill(-(self.child.id() as i32), libc::SIGTERM);
        }
        #[cfg(not(unix))]
        let _ = self.child.kill();
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(5) {
            if self.child.try_wait().ok().flatten().is_some() {
                return;
            }
            thread::sleep(Duration::from_millis(80));
        }
        #[cfg(unix)]
        unsafe {
            libc::kill(-(self.child.id() as i32), libc::SIGKILL);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Drop for OwnedServer {
    fn drop(&mut self) {
        self.close();
    }
}
