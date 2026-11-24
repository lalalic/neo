use serde_json::json;
use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    thread,
    time::Duration,
};
struct Gateway {
    _temp: tempfile::TempDir,
    child: Child,
    port: u16,
    token_path: PathBuf,
}
impl Gateway {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        fs::create_dir_all(&home).unwrap();
        let config = home.join(".config/neo/gpu/web/services.json");
        fs::create_dir_all(config.parent().unwrap()).unwrap();
        fs::write(
            &config,
            json!({"version":1,"services":{"demo":{"image":"ghcr.io/test/app:sha-abcdef012345",
   "provider":"hf","seconds":3600,"budget":2,"flavor":"l4x1","appPort":7860}}})
            .to_string(),
        )
        .unwrap();
        let token_path = home.join(".config/neo/gpu/web/tokens/demo.token");
        fs::create_dir_all(token_path.parent().unwrap()).unwrap();
        fs::write(&token_path, "synthetic-access-secret\n").unwrap();
        let select = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = select.local_addr().unwrap().port();
        drop(select);
        let child = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
            .args([
                "compute",
                "web",
                "serve",
                "--port",
                &port.to_string(),
                "--origin",
                &format!("http://127.0.0.1:{port}"),
            ])
            .env("HOME", &home)
            .env("PATH", "/usr/bin:/bin")
            .env_remove("HF_TOKEN")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let instance = Self {
            _temp: temp,
            child,
            port,
            token_path,
        };
        let mut ready = false;
        for _ in 0..100 {
            if let Ok(response) = instance.request("GET /health HTTP/1.1\r\nHost: local\r\n\r\n") {
                if response.starts_with("HTTP/1.1 200") {
                    ready = true;
                    break;
                }
            }
            thread::sleep(Duration::from_millis(30));
        }
        assert!(ready, "native loopback Web gateway never accepted requests");
        instance
    }
    fn request(&self, text: &str) -> Result<String, String> {
        let mut stream = TcpStream::connect(("127.0.0.1", self.port)).map_err(|e| e.to_string())?;
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .map_err(|e| e.to_string())?;
        stream
            .write_all(text.as_bytes())
            .map_err(|e| e.to_string())?;
        let mut response = String::new();
        stream
            .read_to_string(&mut response)
            .map_err(|e| e.to_string())?;
        Ok(response)
    }
    fn cookie(&self) -> String {
        let form = "token=synthetic-access-secret";
        let reply=self.request(&format!("POST /demo/_login HTTP/1.1\r\nHost: local\r\nContent-Length: {}\r\nContent-Type: application/x-www-form-urlencoded\r\n\r\n{form}",form.len())).unwrap();
        assert!(reply.starts_with("HTTP/1.1 303"), "{reply}");
        let header = reply
            .lines()
            .find(|s| s.starts_with("Set-Cookie:"))
            .unwrap();
        assert!(header.contains("HttpOnly"));
        assert!(header.contains("SameSite=Lax"));
        header
            .strip_prefix("Set-Cookie: ")
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string()
    }
}
impl Drop for Gateway {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
#[test]
fn native_gateway_health_redirect_login_and_control_enforce_access_token() {
    let g = Gateway::new();
    let status = g
        .request("GET /demo HTTP/1.1\r\nHost: local\r\n\r\n")
        .unwrap();
    assert!(status.starts_with("HTTP/1.1 303"));
    assert!(status.contains("Location: /demo/"));
    let unauthorized = g
        .request("GET /demo/_control HTTP/1.1\r\nHost: local\r\n\r\n")
        .unwrap();
    assert!(unauthorized.starts_with("HTTP/1.1 401"));
    assert!(unauthorized.contains("Unlock demo"));
    assert!(unauthorized.contains("Content-Security-Policy"));
    let wrong = "token=wrong-token";
    let forbidden = g
        .request(&format!(
            "POST /demo/_login HTTP/1.1\r\nHost: local\r\nContent-Length: {}\r\n\r\n{wrong}",
            wrong.len()
        ))
        .unwrap();
    assert!(forbidden.starts_with("HTTP/1.1 403"));
    let cookie = g.cookie();
    let control = g
        .request(&format!(
            "GET /demo/_control HTTP/1.1\r\nHost: local\r\nCookie: {cookie}\r\n\r\n"
        ))
        .unwrap();
    assert!(control.starts_with("HTTP/1.1 200"));
    assert!(control.contains("stopped"));
    assert!(control.contains("Start GPU (paid session)"));
}
#[test]
fn native_gateway_rejects_forged_cookie_csrf_and_unauthorized_paid_start() {
    let g = Gateway::new();
    let cookie = g.cookie();
    let forged = format!("{cookie}x");
    let rejected = g
        .request(&format!(
            "GET /demo/_control HTTP/1.1\r\nHost: local\r\nCookie: {forged}\r\n\r\n"
        ))
        .unwrap();
    assert!(rejected.starts_with("HTTP/1.1 401"));
    let origin=g.request(&format!("POST /demo/_start HTTP/1.1\r\nHost: local\r\nOrigin: https://evil.example\r\nCookie: {cookie}\r\nContent-Length: 0\r\n\r\n")).unwrap();
    assert!(origin.starts_with("HTTP/1.1 403"));
    let unsupported=g.request(&format!("POST /demo/_start HTTP/1.1\r\nHost: local\r\nOrigin: http://127.0.0.1:{}\r\nCookie: {cookie}\r\nContent-Length: 0\r\n\r\n",g.port)).unwrap();
    assert!(unsupported.starts_with("HTTP/1.1 503"));
    assert!(unsupported.contains("HF proxy authentication is unavailable"));
    let token = g.cookie();
    assert!(token.contains("neo_gpu_demo="));
    fs::write(&g.token_path, "rotated-secret-not-old-key\n").unwrap();
    let invalidated = g
        .request(&format!(
            "GET /demo/_control HTTP/1.1\r\nHost: local\r\nCookie: {cookie}\r\n\r\n"
        ))
        .unwrap();
    assert!(invalidated.starts_with("HTTP/1.1 401"));
}
#[test]
fn native_gateway_rejects_request_smuggling_and_unsafe_public_origin() {
    let g = Gateway::new();
    let rejected=g.request("POST /demo/_login HTTP/1.1\r\nHost: local\r\nContent-Length: 0\r\nTransfer-Encoding: chunked\r\n\r\n").unwrap();
    assert!(rejected.starts_with("HTTP/1.1 502") || rejected.starts_with("HTTP/1.1 400"));
    let invalid = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        .args([
            "compute",
            "web",
            "serve",
            "--origin",
            "http://example.org",
            "--port",
            "8798",
        ])
        .output()
        .unwrap();
    assert!(!invalid.status.success());
    assert!(invalid.stdout.is_empty());
}
