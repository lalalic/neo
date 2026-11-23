#![cfg(unix)]
use neo_harness_cli::{
    escalation_contract::Config, escalation_lock, escalation_server::OwnedServer,
};
use std::os::unix::fs::PermissionsExt;
use std::{
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};
struct Fixture {
    temp: tempfile::TempDir,
    lock: escalation_lock::Config,
    executable: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let lock = escalation_lock::Config {
            dir: temp.path().join("owned-lock"),
            wait_seconds: 3,
        };
        let executable = PathBuf::from(env!("CARGO_BIN_EXE_neo-rs"));
        Self {
            temp,
            lock,
            executable,
        }
    }
    fn config(&self, command: &str) -> Config {
        Config {
            engine: "llama".into(),
            model: "fixture/model".into(),
            context: 65536,
            budget_seconds: 30,
            max_turns: 3,
            startup_ms: 1500,
            server_command: command.into(),
            base_url: None,
        }
    }
    fn mock_server(&self) -> PathBuf {
        let path = self.temp.path().join("mock-llama.mjs");
        fs::write(&path,r#"#!/usr/bin/env node
import http from 'node:http';
const args=process.argv.slice(2);const port=Number(args[args.indexOf('--port')+1]);
if(!Number.isInteger(port)||port<=0)process.exit(13);
const server=http.createServer((req,res)=>{
  res.writeHead(200,{'content-type':'application/json'});
  if(req.url==='/health')res.end(JSON.stringify({status:'ready'}));
  else res.end(JSON.stringify({choices:[{message:{content:'{"status":"failed","summary":"test"}'}}]}));
});server.listen(port,'127.0.0.1');
"#).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        path
    }
}
#[test]
fn owned_model_uses_loopback_port_and_closes_real_disposable_process() {
    let fixture = Fixture::new();
    let server = fixture.mock_server();
    let mut guard =
        escalation_lock::acquire_with_binary(&fixture.lock, &fixture.executable).unwrap();
    let mut owned =
        OwnedServer::start(&fixture.config(server.to_str().unwrap()), &mut guard).unwrap();
    let url = owned.endpoint().to_owned();
    assert!(url.starts_with("http://127.0.0.1:"));
    assert!(url.ends_with("/v1"));
    let health = url.replace("/v1", "/health");
    let response = ureq::get(&health).call().unwrap();
    assert_eq!(response.status().as_u16(), 200);
    owned.close();
    drop(owned);
    guard.finish().unwrap();
    let failure = ureq::get(&health).call();
    assert!(failure.is_err(), "owned test server must be terminated");
}
#[test]
fn owned_model_startup_failure_cleans_up_and_releases_exclusive_lock() {
    let fixture = Fixture::new();
    let mut guard =
        escalation_lock::acquire_with_binary(&fixture.lock, &fixture.executable).unwrap();
    let err = OwnedServer::start(&fixture.config("/usr/bin/false"), &mut guard)
        .err()
        .unwrap();
    assert!(err.contains("exited during startup"), "{err}");
    guard.finish().unwrap();
    let guard = escalation_lock::acquire_with_binary(&fixture.lock, &fixture.executable).unwrap();
    guard.finish().unwrap();
}
#[test]
fn owned_model_startup_timeout_is_bounded_and_does_not_leave_sleeper() {
    let fixture = Fixture::new();
    let sleeper = fixture.temp.path().join("never-ready.sh");
    fs::write(&sleeper, "#!/bin/sh\nexec /bin/sleep 30\n").unwrap();
    fs::set_permissions(&sleeper, fs::Permissions::from_mode(0o755)).unwrap();
    let mut cfg = fixture.config(sleeper.to_str().unwrap());
    cfg.startup_ms = 1000;
    let mut guard =
        escalation_lock::acquire_with_binary(&fixture.lock, &fixture.executable).unwrap();
    let start = Instant::now();
    let err = OwnedServer::start(&cfg, &mut guard).err().unwrap();
    assert!(err.contains("timed out"));
    assert!(start.elapsed() < Duration::from_secs(6));
    guard.finish().unwrap();
}
