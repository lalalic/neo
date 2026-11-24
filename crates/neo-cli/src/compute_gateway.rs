//! Neo Compute Web gateway, native to Rust. The listener is loopback-only;
//! signed short-lived cookies protect browser actions, and the authenticated
//! reverse proxy supports HTTP and WebSocket upgrade over HF TLS / Vast SSH.
//! No request controls the provider destination or bypasses provider leases.
use crate::{compute, compute_transport::Endpoint, compute_web};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use regex::Regex;
use serde_json::Value;
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::{
    fs::{OpenOptionsExt, PermissionsExt},
    process::CommandExt,
};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{TcpListener, TcpStream, ToSocketAddrs},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
const MAX_HEADER: usize = 32768;
const MAX_FORM: usize = 2048;
const MAX_QUEUE: usize = 8 * 1024 * 1024;
const MAX_DURATION: Duration = Duration::from_secs(15 * 60);
type TunnelCache = Arc<Mutex<HashMap<String, (u64, compute::Tunnel)>>>;
#[derive(Debug)]
struct Request {
    method: String,
    target: String,
    headers: Vec<(String, String)>,
    remaining: Vec<u8>,
}
impl Request {
    fn header(&self, key: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v.as_str())
    }
    fn pathname(&self) -> &str {
        self.target.split('?').next().unwrap_or("")
    }
}
fn parse(mut data: Vec<u8>, stream: &mut TcpStream) -> Result<Request, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(8)))
        .map_err(|e| e.to_string())?;
    let end = loop {
        if let Some(i) = data.windows(4).position(|s| s == b"\r\n\r\n") {
            break i;
        }
        if data.len() > MAX_HEADER {
            return Err("Request headers exceeded bound".into());
        }
        let mut chunk = [0u8; 4096];
        let n = stream
            .read(&mut chunk)
            .map_err(|_| "Cannot read browser request")?;
        if n == 0 {
            return Err("Browser request closed before headers".into());
        }
        data.extend_from_slice(&chunk[..n]);
    };
    if end > MAX_HEADER {
        return Err("Request header bound exceeded".into());
    }
    let header = std::str::from_utf8(&data[..end]).map_err(|_| "Invalid browser header text")?;
    let mut lines = header.split("\r\n");
    let start = lines.next().ok_or("Missing browser request line")?;
    let words = start.split(' ').collect::<Vec<_>>();
    if words.len() != 3
        || words[2] != "HTTP/1.1"
        || !matches!(
            words[0],
            "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS"
        )
    {
        return Err("Invalid browser HTTP request line".into());
    }
    let target = words[1];
    if !target.starts_with('/')
        || target.starts_with("//")
        || target.contains(['\r', '\n'])
        || target.len() > 8192
    {
        return Err("Unsafe browser request target".into());
    }
    let mut headers = Vec::new();
    let (mut count_length, mut transfer) = (0, 0);
    for row in lines {
        let (name, value) = row
            .split_once(':')
            .ok_or("Malformed browser request header")?;
        let name = name.trim();
        let value = value.trim();
        if name.is_empty()
            || name.len() > 64
            || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || value.bytes().any(|b| b == 0 || b < 32 && b != 9)
        {
            return Err("Unsafe browser request header".into());
        }
        if name.eq_ignore_ascii_case("content-length") {
            count_length += 1;
        }
        if name.eq_ignore_ascii_case("transfer-encoding") {
            transfer += 1;
        }
        headers.push((name.into(), value.into()));
    }
    if count_length > 1 || transfer > 1 || (count_length > 0 && transfer > 0) {
        return Err("Ambiguous request body length".into());
    }
    Ok(Request {
        method: words[0].into(),
        target: target.into(),
        headers,
        remaining: data[end + 4..].to_vec(),
    })
}
fn body(stream: &mut TcpStream, request: &Request, limit: usize) -> Result<Vec<u8>, String> {
    if request.header("Transfer-Encoding").is_some() {
        return Err("Chunked control form is not accepted".into());
    }
    let length = request
        .header("Content-Length")
        .ok_or("Control form requires Content-Length")?
        .parse::<usize>()
        .map_err(|_| "Invalid control Content-Length")?;
    if length > limit || request.remaining.len() > length {
        return Err("Control form exceeds size bound".into());
    }
    let mut buffer = request.remaining.clone();
    while buffer.len() < length {
        let mut chunk = [0u8; 1024];
        let needed = std::cmp::min(chunk.len(), length - buffer.len());
        let read = stream
            .read(&mut chunk[..needed])
            .map_err(|_| "Control form read failed")?;
        if read == 0 {
            return Err("Incomplete browser control form".into());
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    Ok(buffer)
}
fn esc(raw: &str) -> String {
    raw.chars()
        .map(|c| match c {
            '&' => "&amp;".into(),
            '<' => "&lt;".into(),
            '>' => "&gt;".into(),
            '"' => "&quot;".into(),
            '\'' => "&#39;".into(),
            _ => c.to_string(),
        })
        .collect()
}
fn page(title: &str, content: &str) -> String {
    format!("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"referrer\" content=\"no-referrer\"><title>{} — Neo Compute</title><style>body{{font:16px system-ui,sans-serif;max-width:620px;margin:8vh auto;padding:20px;color:#232323}}main{{border:1px solid #ddd;border-radius:12px;padding:22px}}button,input{{padding:12px;font:inherit;border-radius:8px;margin-top:12px}}</style></head><body><main><h2>{}</h2>{content}</main></body></html>",esc(title),esc(title))
}
fn respond(
    stream: &mut TcpStream,
    status: u16,
    content: &str,
    extra: &[(&str, String)],
) -> Result<(), String> {
    let phrase = match status {
        200 => "OK",
        303 => "See Other",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "Internal Server Error",
    };
    let mut head=format!("HTTP/1.1 {status} {phrase}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'\r\n",content.len());
    for (key, value) in extra {
        if value.contains(['\r', '\n']) {
            return Err("Unsafe HTTP response header".into());
        }
        head.push_str(&format!("{key}: {value}\r\n"));
    }
    head.push_str("\r\n");
    stream
        .write_all(head.as_bytes())
        .and_then(|_| stream.write_all(content.as_bytes()))
        .map_err(|_| "Browser response write failed".into())
}
fn redirect(stream: &mut TcpStream, path: &str, extra: &[(&str, String)]) -> Result<(), String> {
    let mut fields = vec![("Location", path.to_string())];
    fields.extend_from_slice(extra);
    respond(stream, 303, "", &fields)
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |t| t.as_secs())
}
fn rand_nonce() -> Result<String, String> {
    let mut seed = [0u8; 12];
    getrandom::fill(&mut seed).map_err(|_| "Browser cookie randomness unavailable")?;
    Ok(seed.iter().map(|b| format!("{b:02x}")).collect())
}
fn hmac(key: &[u8], value: &str) -> String {
    let mut k = [0u8; 64];
    if key.len() > 64 {
        k[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut inner = [0x36u8; 64];
    let mut outer = [0x5cu8; 64];
    for n in 0..64 {
        inner[n] ^= k[n];
        outer[n] ^= k[n];
    }
    let mut first = Sha256::new();
    first.update(inner);
    first.update(value.as_bytes());
    let mut second = Sha256::new();
    second.update(outer);
    second.update(first.finalize());
    URL_SAFE_NO_PAD.encode(second.finalize())
}
fn equal(a: &str, b: &str) -> bool {
    if a.len() != b.len() || a.is_empty() {
        return false;
    }
    let mut result = 0u8;
    for (x, y) in a.bytes().zip(b.bytes()) {
        result |= x ^ y;
    }
    result == 0
}
fn cookie_name(name: &str) -> String {
    format!("neo_gpu_{}", name.replace('-', "_"))
}
fn issue_cookie(name: &str, secret: &str) -> Result<String, String> {
    let expires = now() + 3600;
    let nonce = rand_nonce()?;
    let signed = format!("{name}.{expires}.{nonce}");
    Ok(format!("{signed}.{}", hmac(secret.as_bytes(), &signed)))
}
fn valid_cookie(name: &str, secret: &str, value: &str) -> bool {
    let parts = value.split('.').collect::<Vec<_>>();
    if parts.len() != 4 || parts[0] != name {
        return false;
    }
    let Ok(expiry) = parts[1].parse::<u64>() else {
        return false;
    };
    if expiry < now()
        || expiry > now() + 3600
        || parts[2].len() != 24
        || !parts[2].bytes().all(|b| b.is_ascii_hexdigit())
        || parts[3].len() != 43
    {
        return false;
    }
    equal(&hmac(secret.as_bytes(), &parts[..3].join(".")), parts[3])
}
fn cookie_from_header<'a>(name: &str, raw: &'a str) -> Option<&'a str> {
    let key = cookie_name(name);
    raw.split(';')
        .filter_map(|value| value.trim().split_once('='))
        .find(|(name, _)| *name == key)
        .map(|(_, value)| value.trim())
}
fn login(name: &str) -> String {
    page(&format!("Unlock {name}"),&format!("<p>Enter the service access token. This token also permits starting a paid GPU session.</p><form method=\"post\" action=\"/{name}/_login\"><label>Access token<input name=\"token\" type=\"password\" autocomplete=\"off\" required autofocus></label><button type=\"submit\">Unlock</button></form>"))
}
fn control(name: &str, config: &Value, state: &Value) -> String {
    let active = state["phase"] == "running"
        && state["deadline"]
            .as_i64()
            .is_some_and(|v| v > chrono::Utc::now().timestamp_millis());
    let message = if active {
        format!("<p>GPU running · hard shutdown in at most {} minutes.</p><p><a href=\"/{name}/\">Open application</a></p>",
        ((state["deadline"].as_i64().unwrap_or(0)-chrono::Utc::now().timestamp_millis())/60000).max(0))
    } else {
        format!(
            "<p>GPU status: <strong>{}</strong>. Visiting this page does not rent a GPU.</p>",
            esc(state["phase"].as_str().unwrap_or("stopped"))
        )
    };
    let actions = if active {
        format!(
            "<form method=\"post\" action=\"/{name}/_stop\"><button>Stop GPU now</button></form>"
        )
    } else if matches!(state["phase"].as_str(), Some("stopped" | "failed")) {
        format!("<form method=\"post\" action=\"/{name}/_start\"><button>Start GPU (paid session)</button></form>")
    } else {
        "<p>Session transition in progress. Refresh status.</p>".into()
    };
    page(name,&format!("{message}<p>Provider: {} · Budget preflight: US${:.2} · Hard timeout: {} minutes. Budget is not a provider-enforced hard cap.</p>{actions}",
        esc(config["provider"].as_str().unwrap_or("unknown")),config["budget"].as_f64().unwrap_or(0.),
        config["seconds"].as_u64().unwrap_or(0)/60))
}

#[derive(Clone)]
struct Gateway {
    public_origin: String,
    tunnels: TunnelCache,
    pending: Arc<Mutex<HashMap<String, u64>>>,
}
struct Destination {
    host: String,
    port: u16,
    tls: bool,
    bearer: Option<String>,
}
fn destination(name: &str, state: &Value, gateway: &Gateway) -> Result<Destination, String> {
    match state["provider"].as_str() {
        Some("hf") => {
            let job = state["jobId"].as_str().ok_or("Missing HF Job ID")?;
            let endpoint = Endpoint::hf(job)?;
            Ok(Destination {
                host: format!("{job}--8000.hf.jobs"),
                port: 443,
                tls: true,
                bearer: endpoint.bearer,
            })
        }
        Some("vast") => {
            let id = state["instanceId"]
                .as_u64()
                .filter(|v| *v > 0)
                .ok_or("Missing Vast instance ID")?;
            if let Some(port) = gateway
                .tunnels
                .lock()
                .map_err(|_| "Compute tunnel lock poisoned")?
                .get(name)
                .filter(|(old, _)| *old == id)
                .map(|(_, t)| t.port)
            {
                return Ok(Destination {
                    host: "127.0.0.1".into(),
                    port,
                    tls: false,
                    bearer: None,
                });
            }
            // New SSH tunnel is created only once per service/instance and
            // only after a validated paid session. Browser gets 503 while
            // this independent effort establishes its local endpoint.
            let mut pending = gateway
                .pending
                .lock()
                .map_err(|_| "Tunnel request lock poisoned")?;
            if pending.get(name) != Some(&id) {
                pending.insert(name.into(), id);
                let tunnels = gateway.tunnels.clone();
                let tasks = gateway.pending.clone();
                let key = name.to_string();
                let deadline = state["deadline"]
                    .as_i64()
                    .unwrap_or(0)
                    .saturating_sub(chrono::Utc::now().timestamp_millis());
                let duration = (deadline.max(0) as u64 / 1000).min(420);
                let ssh_key = std::env::var_os("NEO_GPU_VAST_SSH_KEY")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| compute::home().unwrap_or_default().join(".ssh/id_ed25519"));
                thread::spawn(move || {
                    let result = compute::vast_tunnel(
                        id,
                        &ssh_key,
                        Instant::now() + Duration::from_secs(duration),
                    );
                    if let Ok(tunnel) = result {
                        if let Ok(mut map) = tunnels.lock() {
                            map.insert(key.clone(), (id, tunnel));
                        }
                    }
                    if let Ok(mut map) = tasks.lock() {
                        if map.get(&key) == Some(&id) {
                            map.remove(&key);
                        }
                    }
                });
            }
            Err("Vast tunnel is starting".into())
        }
        _ => Err("Unsupported Compute gateway provider".into()),
    }
}
fn clear_tunnel(name: &str, shared: &Gateway) {
    if let Ok(mut tunnels) = shared.tunnels.lock() {
        tunnels.remove(name);
    }
}
fn web_action(name: &str, kind: &str) -> Result<(), String> {
    let path = compute_web::sessions_root()?.join("logs");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    let file = path.join(format!("{name}-{kind}-{}.log", uuid::Uuid::new_v4()));
    let mut flags = OpenOptions::new();
    flags.create_new(true).write(true);
    #[cfg(unix)]
    flags.mode(0o600);
    let stdout = flags.open(&file).map_err(|e| e.to_string())?;
    let stderr = stdout.try_clone().map_err(|e| e.to_string())?;
    let program = std::env::current_exe().map_err(|_| "Cannot invoke native Compute CLI")?;
    let mut command = Command::new(program);
    command.args(["compute", "web", kind, name]);
    if kind == "start" {
        command.arg("--allow-spend");
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    #[cfg(unix)]
    command.process_group(0);
    command
        .spawn()
        .map_err(|_| "Cannot spawn background Compute control action")?;
    Ok(())
}
fn strip_cookie(name: &str, raw: &str) -> String {
    let key = format!("{}=", cookie_name(name));
    raw.split(';')
        .map(str::trim)
        .filter(|chunk| !chunk.starts_with(&key))
        .collect::<Vec<_>>()
        .join("; ")
}
fn forward_head(
    request: &Request,
    name: &str,
    backend: &Destination,
    origin: &str,
) -> Result<Vec<u8>, String> {
    let prefix = format!("/{name}");
    let path = request
        .target
        .strip_prefix(&prefix)
        .ok_or("Invalid Compute proxy prefix")?;
    let upstream_path = if path.is_empty() {
        "/"
    } else if path.starts_with('/') || path.starts_with('?') {
        path
    } else {
        return Err("Invalid Compute application path".into());
    };
    let upstream_path = if upstream_path.starts_with('?') {
        format!("/{upstream_path}")
    } else {
        upstream_path.to_string()
    };
    let url = url::Url::parse(origin).map_err(|_| "Invalid Compute public origin")?;
    let mut output = format!("{} {} HTTP/1.1\r\n", request.method, upstream_path);
    let websocket = request
        .header("Upgrade")
        .is_some_and(|s| s.eq_ignore_ascii_case("websocket"));
    for (key, value) in &request.headers {
        if matches!(
            key.to_ascii_lowercase().as_str(),
            "host"
                | "authorization"
                | "proxy-authorization"
                | "forwarded"
                | "x-forwarded-host"
                | "x-forwarded-proto"
                | "x-forwarded-prefix"
                | "x-forwarded-for"
                | "x-forwarded-port"
                | "x-forwarded-server"
                | "x-real-ip"
                | "x-neo-app-authorization"
                | "connection"
        ) {
            continue;
        }
        if key.eq_ignore_ascii_case("cookie") {
            let rest = strip_cookie(name, value);
            if !rest.is_empty() {
                output.push_str(&format!("Cookie: {rest}\r\n"));
            }
        } else {
            output.push_str(&format!("{key}: {value}\r\n"));
        }
    }
    let target_host = if backend.tls {
        backend.host.clone()
    } else {
        format!("{}:{}", backend.host, backend.port)
    };
    output.push_str(&format!("Host: {target_host}\r\n"));
    if websocket {
        output.push_str("Connection: Upgrade\r\n");
    } else {
        output.push_str("Connection: close\r\n");
    }
    if let Some(app_auth) = request.header("Authorization") {
        output.push_str(&format!("X-Neo-App-Authorization: {app_auth}\r\n"));
    }
    output.push_str(&format!(
        "X-Forwarded-Prefix: /{name}\r\nX-Forwarded-Proto: https\r\nX-Forwarded-Host: {}\r\n",
        url.host_str().unwrap_or("")
    ));
    if let Some(bearer) = &backend.bearer {
        output.push_str(&format!("Authorization: Bearer {bearer}\r\n"));
    }
    output.push_str("\r\n");
    Ok(output.into_bytes())
}
fn proxy_headers(raw: &[u8], name: &str) -> Result<Vec<u8>, String> {
    let text = std::str::from_utf8(raw).map_err(|_| "Invalid Compute upstream header bytes")?;
    let mut lines = text.split("\r\n");
    let status = lines.next().ok_or("Empty Compute upstream response")?;
    if !status.starts_with("HTTP/1.") {
        return Err("Invalid Compute upstream HTTP status".into());
    }
    let mut output = format!("{status}\r\n");
    let cookie_path = Regex::new(r"(?i);\s*path=[^;]*").expect("cookie path regex");
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let (key, value) = line
            .split_once(':')
            .ok_or("Malformed Compute upstream header")?;
        let value = value.trim();
        if key.eq_ignore_ascii_case("Location")
            && value.starts_with('/')
            && !value.starts_with("//")
        {
            output.push_str(&format!("Location: /{name}{value}\r\n"));
        } else if key.eq_ignore_ascii_case("Set-Cookie") {
            let path = &cookie_path;
            let cookie = if path.is_match(value) {
                path.replace(value, format!("; Path=/{name}/")).into_owned()
            } else {
                format!("{value}; Path=/{name}/")
            };
            output.push_str(&format!("Set-Cookie: {cookie}\r\n"));
        } else if key.eq_ignore_ascii_case("Connection") {
            if value.eq_ignore_ascii_case("Upgrade") {
                output.push_str("Connection: Upgrade\r\n");
            }
        } else if !key.eq_ignore_ascii_case("proxy-connection") {
            output.push_str(line);
            output.push_str("\r\n");
        }
    }
    output.push_str("\r\n");
    Ok(output.into_bytes())
}

enum Remote {
    Plain(TcpStream),
    Secure(Box<rustls::StreamOwned<rustls::ClientConnection, TcpStream>>),
}
impl Read for Remote {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Self::Plain(sock) => sock.read(buf),
            Self::Secure(sock) => sock.read(buf),
        }
    }
}
impl Write for Remote {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self {
            Self::Plain(sock) => sock.write(buf),
            Self::Secure(sock) => sock.write(buf),
        }
    }
    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            Self::Plain(sock) => sock.flush(),
            Self::Secure(sock) => sock.flush(),
        }
    }
}
impl Remote {
    fn connect(backend: &Destination) -> Result<Self, String> {
        let target = (backend.host.as_str(), backend.port)
            .to_socket_addrs()
            .map_err(|_| "Compute provider DNS resolution failed")?
            .next()
            .ok_or("Compute provider has no reachable address")?;
        let mut socket = TcpStream::connect_timeout(&target, Duration::from_secs(8))
            .map_err(|_| "Compute provider connection failed")?;
        socket
            .set_read_timeout(Some(Duration::from_secs(12)))
            .map_err(|e| e.to_string())?;
        socket
            .set_write_timeout(Some(Duration::from_secs(12)))
            .map_err(|e| e.to_string())?;
        if !backend.tls {
            return Ok(Self::Plain(socket));
        }
        let roots =
            rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let config = rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        let server = rustls::pki_types::ServerName::try_from(backend.host.clone())
            .map_err(|_| "Compute HTTPS provider hostname is invalid")?;
        let mut connection = rustls::ClientConnection::new(Arc::new(config), server)
            .map_err(|_| "Compute HTTPS client initialization failed")?;
        while connection.is_handshaking() {
            connection
                .complete_io(&mut socket)
                .map_err(|_| "Compute HTTPS provider handshake failed")?;
        }
        Ok(Self::Secure(Box::new(rustls::StreamOwned::new(
            connection, socket,
        ))))
    }
    fn nonblocking(&mut self) -> Result<(), String> {
        match self {
            Self::Plain(s) => s.set_nonblocking(true),
            Self::Secure(s) => s.sock.set_nonblocking(true),
        }
        .map_err(|e| e.to_string())
    }
}
struct Queue {
    content: Vec<u8>,
    offset: usize,
}
impl Queue {
    fn new(content: Vec<u8>) -> Self {
        Self { content, offset: 0 }
    }
    fn available(&self) -> usize {
        self.content.len() - self.offset
    }
    fn push(&mut self, data: &[u8]) {
        if self.offset > 0 && self.offset > self.content.len() / 2 {
            self.content.drain(..self.offset);
            self.offset = 0;
        }
        self.content.extend_from_slice(data);
    }
    fn pending(&self) -> &[u8] {
        &self.content[self.offset..]
    }
    fn consume(&mut self, n: usize) {
        self.offset += n;
    }
}
fn write_nonblocking(writer: &mut impl Write, buffer: &mut Queue) -> Result<bool, String> {
    if buffer.available() == 0 {
        return Ok(false);
    }
    match writer.write(buffer.pending()) {
        Ok(0) => Err("Compute provider stream closed while writing".into()),
        Ok(n) => {
            buffer.consume(n);
            Ok(true)
        }
        Err(e)
            if e.kind() == std::io::ErrorKind::WouldBlock
                || e.kind() == std::io::ErrorKind::Interrupted =>
        {
            Ok(false)
        }
        Err(_) => Err("Compute proxy stream write failed".into()),
    }
}
fn proxy(
    mut browser: TcpStream,
    request: &Request,
    name: &str,
    backend: &Destination,
    origin: &str,
    deadline: Instant,
) -> Result<(), String> {
    let mut provider = Remote::connect(backend)?;
    let mut request_queue = Queue::new(forward_head(request, name, backend, origin)?);
    request_queue.push(&request.remaining);
    let mut response_queue = Queue::new(Vec::new());
    let mut response_header = Vec::<u8>::new();
    let mut headers_complete = false;
    let (mut input_eof, mut output_eof) = (false, false);
    browser.set_nonblocking(true).map_err(|e| e.to_string())?;
    provider.nonblocking()?;
    let mut last_activity = Instant::now();
    let mut scratch = [0u8; 64 * 1024];
    loop {
        if Instant::now() >= deadline || last_activity.elapsed() >= MAX_DURATION {
            return Ok(());
        }
        let mut active = false;
        if !input_eof && request_queue.available() < MAX_QUEUE {
            match browser.read(&mut scratch) {
                Ok(0) => input_eof = true,
                Ok(n) => {
                    request_queue.push(&scratch[..n]);
                    last_activity = Instant::now();
                    active = true;
                }
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::Interrupted => {}
                Err(_) => input_eof = true,
            }
        }
        if write_nonblocking(&mut provider, &mut request_queue)? {
            last_activity = Instant::now();
            active = true;
        }
        // rustls buffers TLS records until flush. WouldBlock is expected on
        // a nonblocking socket and must not be treated as remote completion.
        match provider.flush() {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => return Err("Compute HTTPS upstream flush failed".into()),
        }
        if !output_eof && response_queue.available() < MAX_QUEUE {
            match provider.read(&mut scratch) {
                Ok(0) => output_eof = true,
                Ok(n) => {
                    if !headers_complete {
                        response_header.extend_from_slice(&scratch[..n]);
                        if response_header.len() > 64 * 1024 {
                            return Err("Compute upstream headers exceeded bound".into());
                        }
                        if let Some(split) = response_header
                            .windows(4)
                            .position(|slice| slice == b"\r\n\r\n")
                        {
                            let transformed = proxy_headers(&response_header[..split], name)?;
                            response_queue.push(&transformed);
                            response_queue.push(&response_header[split + 4..]);
                            response_header.clear();
                            headers_complete = true;
                        }
                    } else {
                        response_queue.push(&scratch[..n]);
                    }
                    last_activity = Instant::now();
                    active = true;
                }
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::Interrupted => {}
                Err(_) => output_eof = true,
            }
        }
        if write_nonblocking(&mut browser, &mut response_queue)? {
            last_activity = Instant::now();
            active = true;
        }
        if output_eof && response_queue.available() == 0 {
            return Ok(());
        }
        if input_eof && request_queue.available() == 0 && output_eof {
            return Ok(());
        }
        if !active {
            thread::sleep(Duration::from_millis(4));
        }
    }
}
fn handle_browser(mut socket: TcpStream, shared: Gateway) {
    let mut proxied = false;
    let result = (|| {
        let request = parse(Vec::new(), &mut socket)?;
        let pathname = request.pathname();
        if pathname == "/health" {
            return respond(&mut socket, 200, "OK", &[]);
        }
        let trimmed = pathname
            .strip_prefix('/')
            .ok_or("Invalid Compute Web path")?;
        let (name, sub) = trimmed
            .split_once('/')
            .map_or((trimmed, ""), |(n, s)| (n, s));
        if compute_web::validate(name).is_err() || compute_web::service(name).is_err() {
            return respond(
                &mut socket,
                404,
                &page("Not found", "Unknown GPU service"),
                &[],
            );
        }
        if sub.is_empty() && !pathname.ends_with('/') {
            return redirect(&mut socket, &format!("/{name}/"), &[]);
        }
        if sub == "_login" {
            if request.method != "POST" {
                return respond(&mut socket, 405, "POST required", &[]);
            }
            let form = body(&mut socket, &request, MAX_FORM)?;
            let parameters = url::form_urlencoded::parse(&form);
            let presented = parameters
                .into_iter()
                .find(|(key, _)| key == "token")
                .map(|(_, value)| value.into_owned())
                .unwrap_or_default();
            let secret = compute_web::existing_token(name)?;
            if !equal(&presented, &secret) {
                return respond(
                    &mut socket,
                    403,
                    &page("Access denied", "Incorrect token"),
                    &[],
                );
            }
            let value = issue_cookie(name, &secret)?;
            let secure = if shared.public_origin.starts_with("https:") {
                "; Secure"
            } else {
                ""
            };
            let cookie = format!(
                "{}={value}; HttpOnly; SameSite=Lax; Path=/{name}/; Max-Age=3600{secure}",
                cookie_name(name)
            );
            return redirect(
                &mut socket,
                &format!("/{name}/_control"),
                &[("Set-Cookie", cookie)],
            );
        }
        let secret = compute_web::existing_token(name)?;
        let authorized = request
            .header("Cookie")
            .and_then(|line| cookie_from_header(name, line))
            .is_some_and(|value| valid_cookie(name, &secret, value));
        if !authorized {
            return respond(&mut socket, 401, &login(name), &[]);
        }
        let state = compute_web::safe_status(name)?;
        let config = compute_web::service(name)?;
        if matches!(sub, "_start" | "_stop") {
            if request.method != "POST" {
                return respond(&mut socket, 405, "POST required", &[]);
            }
            if request.header("Origin") != Some(shared.public_origin.as_str()) {
                return respond(&mut socket, 403, &page("Forbidden", "Origin mismatch"), &[]);
            }
            if sub == "_start" && !matches!(state["phase"].as_str(), Some("stopped" | "failed")) {
                return redirect(&mut socket, &format!("/{name}/_control"), &[]);
            }
            if sub == "_stop"
                && !matches!(state["phase"].as_str(), Some("running" | "cleanup_failed"))
            {
                return redirect(&mut socket, &format!("/{name}/_control"), &[]);
            }
            if sub == "_start"
                && config["provider"] == "hf"
                && Endpoint::hf("0123456789abcdef01234567").is_err()
            {
                return respond(
                    &mut socket,
                    503,
                    &page(
                        "Gateway credential unavailable",
                        "HF proxy authentication is unavailable; no rental started.",
                    ),
                    &[],
                );
            }
            web_action(name, if sub == "_start" { "start" } else { "stop" })?;
            return redirect(&mut socket, &format!("/{name}/_control"), &[]);
        }
        if sub == "_control" {
            return respond(&mut socket, 200, &control(name, &config, &state), &[]);
        }
        if state["phase"] != "running"
            || state["deadline"]
                .as_i64()
                .is_none_or(|end| end <= chrono::Utc::now().timestamp_millis())
        {
            clear_tunnel(name, &shared);
            return respond(&mut socket, 200, &control(name, &config, &state), &[]);
        }
        if request
            .header("Upgrade")
            .is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
            && request.header("Origin") != Some(shared.public_origin.as_str())
        {
            return respond(&mut socket, 403, "WebSocket Origin mismatch", &[]);
        }
        let backend = match destination(name, &state, &shared) {
            Ok(value) => value,
            Err(_) => return respond(&mut socket, 503, &control(name, &config, &state), &[]),
        };
        let remaining =
            state["deadline"].as_i64().unwrap_or(0) - chrono::Utc::now().timestamp_millis();
        proxied = true;
        proxy(
            socket.try_clone().map_err(|e| e.to_string())?,
            &request,
            name,
            &backend,
            &shared.public_origin,
            Instant::now() + Duration::from_millis(remaining.max(0) as u64),
        )
    })();
    if result.is_err() {
        // Once proxy bytes may have reached the browser, another HTTP status
        // would corrupt a streamed body or WebSocket frames. Close the
        // connection instead of fabricating a second successful response.
        if proxied {
            let _ = socket.shutdown(std::net::Shutdown::Both);
            return;
        }
        // Auth secrets and raw upstream messages are deliberately suppressed.
        let _ = respond(
            &mut socket,
            502,
            &page("Service unavailable", "Compute gateway request failed"),
            &[],
        );
    }
}
pub fn serve(args: &[String]) -> Result<i32, String> {
    let mut port = 8798u16;
    let mut origin = compute_web::origin();
    let (mut seen_port, mut seen_origin) = (false, false);
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--port" if !seen_port => {
                seen_port = true;
                port = args
                    .get(i + 1)
                    .ok_or("--port needs value")?
                    .parse::<u16>()
                    .map_err(|_| "Invalid gateway port")?;
                if port < 1024 {
                    return Err("Compute Web port must be >=1024".into());
                }
                i += 2;
            }
            "--origin" if !seen_origin => {
                seen_origin = true;
                origin = args.get(i + 1).ok_or("--origin needs value")?.clone();
                i += 2;
            }
            _ => {
                return Err(
                    "usage: neo compute web serve [--port 8798] [--origin HTTPS_ORIGIN]".into(),
                )
            }
        }
    }
    let parsed = url::Url::parse(&origin).map_err(|_| "Invalid Compute Web public origin")?;
    if parsed.host_str().is_none()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || !(parsed.scheme() == "https"
            || (parsed.scheme() == "http"
                && matches!(parsed.host_str(), Some("localhost" | "127.0.0.1"))))
    {
        return Err("Compute Web origin must use HTTPS or loopback HTTP".into());
    }
    origin = parsed.origin().ascii_serialization();
    let listener = TcpListener::bind(("127.0.0.1", port))
        .map_err(|_| "Cannot bind Compute Web loopback port")?;
    let gateway = Gateway {
        public_origin: origin.clone(),
        tunnels: Arc::new(Mutex::new(HashMap::new())),
        pending: Arc::new(Mutex::new(HashMap::new())),
    };
    println!(
        "{}",
        serde_json::json!({"event":"neo_gpu_web_gateway_ready","port":port,"origin":origin})
    );
    let active = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    for incoming in listener.incoming() {
        let Ok(mut socket) = incoming else { continue };
        if active.fetch_add(1, std::sync::atomic::Ordering::AcqRel) >= 128 {
            active.fetch_sub(1, std::sync::atomic::Ordering::AcqRel);
            let _ = respond(&mut socket, 503, "Compute gateway at capacity", &[]);
            continue;
        }
        let shared = gateway.clone();
        let clients = active.clone();
        thread::spawn(move || {
            handle_browser(socket, shared);
            clients.fetch_sub(1, std::sync::atomic::Ordering::AcqRel);
        });
    }
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_proxy_rewrites_http_redirect_and_app_cookie_without_forwarding_gateway_auth() {
        let backend = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = backend.local_addr().unwrap().port();
        let backend_thread = thread::spawn(move || {
            let (mut conn, _) = backend.accept().unwrap();
            conn.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut bytes = Vec::new();
            while !bytes.windows(4).any(|v| v == b"\r\n\r\n") {
                let mut chunk = [0u8; 8192];
                let n = conn.read(&mut chunk).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&chunk[..n]);
            }
            let received = String::from_utf8(bytes).unwrap();
            let response=b"HTTP/1.1 302 Found\r\nLocation: /next\r\nSet-Cookie: app=1; Path=/\r\nContent-Length: 7\r\nConnection: close\r\n\r\nhello!!";
            conn.write_all(response).unwrap();
            received
        });
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request = parse(Vec::new(), &mut stream).unwrap();
            let backend = Destination {
                host: "127.0.0.1".into(),
                port,
                tls: false,
                bearer: None,
            };
            proxy(
                stream,
                &request,
                "demo",
                &backend,
                "https://compute.example",
                Instant::now() + Duration::from_secs(3),
            )
            .unwrap();
        });
        let mut client = TcpStream::connect(addr).unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(4)))
            .unwrap();
        client.write_all(b"GET /demo/video?q=1 HTTP/1.1\r\nHost: compute.example\r\nX-Forwarded-For: 198.51.100.25\r\nX-Real-IP: 203.0.113.17\r\nCookie: neo_gpu_demo=PRIVATE_SESSION; app_session=KEEP_ME\r\nAuthorization: Bearer app-token-123\r\n\r\n").unwrap();
        let mut output = String::new();
        client.read_to_string(&mut output).unwrap();
        server.join().unwrap();
        let upstream = backend_thread.join().unwrap();
        assert!(upstream.starts_with("GET /video?q=1 HTTP/1.1"));
        assert!(upstream.contains("Cookie: app_session=KEEP_ME"));
        assert!(!upstream.contains("PRIVATE_SESSION"));
        assert!(!upstream.contains("198.51.100.25"));
        assert!(!upstream.contains("203.0.113.17"));
        assert!(upstream.contains("X-Neo-App-Authorization: Bearer app-token-123"));
        assert!(!upstream.contains("\r\nAuthorization: Bearer app-token-123\r\n"));
        assert!(upstream.contains("X-Forwarded-Prefix: /demo"));
        assert!(output.starts_with("HTTP/1.1 302"));
        assert!(output.contains("Location: /demo/next"));
        assert!(output.contains("Set-Cookie: app=1; Path=/demo/"));
        assert!(output.ends_with("hello!!"));
    }
    #[test]
    fn local_proxy_websocket_upgrade_pumps_duplex_frames_after_101_handshake() {
        let backend = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = backend.local_addr().unwrap().port();
        let backend_thread = thread::spawn(move || {
            let (mut conn, _) = backend.accept().unwrap();
            conn.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut bytes = Vec::new();
            while !bytes.windows(4).any(|s| s == b"\r\n\r\n") {
                let mut chunk = [0; 2048];
                let n = conn.read(&mut chunk).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&chunk[..n]);
            }
            let text = String::from_utf8(bytes).unwrap();
            assert!(text.contains("Upgrade: websocket"));
            assert!(text.contains("Connection: Upgrade"));
            conn.write_all(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n").unwrap();
            let mut message = [0u8; 4];
            conn.read_exact(&mut message).unwrap();
            assert_eq!(&message, b"PING");
            conn.write_all(b"PONG").unwrap();
        });
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request = parse(Vec::new(), &mut stream).unwrap();
            let backend = Destination {
                host: "127.0.0.1".into(),
                port,
                tls: false,
                bearer: None,
            };
            proxy(
                stream,
                &request,
                "demo",
                &backend,
                "https://compute.example",
                Instant::now() + Duration::from_secs(5),
            )
            .unwrap();
        });
        let mut client = TcpStream::connect(addr).unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        client.write_all(b"GET /demo/ws HTTP/1.1\r\nHost: compute.example\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n\r\n").unwrap();
        let mut head = Vec::new();
        while !head.windows(4).any(|s| s == b"\r\n\r\n") {
            let mut buffer = [0; 2048];
            let n = client.read(&mut buffer).unwrap();
            assert!(n > 0);
            head.extend_from_slice(&buffer[..n]);
        }
        assert!(String::from_utf8(head).unwrap().starts_with("HTTP/1.1 101"));
        client.write_all(b"PING").unwrap();
        let mut reply = [0u8; 4];
        client.read_exact(&mut reply).unwrap();
        assert_eq!(&reply, b"PONG");
        worker.join().unwrap();
        backend_thread.join().unwrap();
    }
    #[test]
    fn cookies_expire_and_tampered_hmac_is_rejected() {
        let first = issue_cookie("demo", "synthetic-key").unwrap();
        assert!(valid_cookie("demo", "synthetic-key", &first));
        assert!(!valid_cookie("demo", "other-key", &first));
        let mutated = first.replacen("demo.", "other.", 1);
        assert!(!valid_cookie("demo", "synthetic-key", &mutated));
    }
}

#[cfg(test)]
mod tls_fail_closed_tests {
    use super::*;
    #[test]
    fn a_plain_server_cannot_impersonate_tls_authenticated_hf_provider() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let attacker = thread::spawn(move || {
            let (mut connection, _) = listener.accept().unwrap();
            let _ = connection.set_read_timeout(Some(Duration::from_secs(2)));
            let mut scratch = [0u8; 2048];
            let _ = connection.read(&mut scratch);
            let _ = connection.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK");
        });
        let backend = Destination {
            host: "127.0.0.1".into(),
            port,
            tls: true,
            bearer: None,
        };
        assert!(
            Remote::connect(&backend).is_err(),
            "A forged HTTP 200 must not satisfy TLS validation"
        );
        attacker.join().unwrap();
    }
}
