use bytes::Bytes;
use http_body_util::{combinators::UnsyncBoxBody, BodyExt, Full};
use hyper::{
    body::{Frame, Incoming},
    header, http, Method, Request, Response, StatusCode,
};
use hyper_util::rt::TokioIo;
use serde_json::{json, Value};
use std::{
    convert::Infallible,
    env, io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicI32, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    process::Command,
};
type Error = Box<dyn std::error::Error + Send + Sync>;
type Body = UnsyncBoxBody<Bytes, Error>;
type Reply = Response<Body>;
fn full(x: impl Into<Bytes>) -> Body {
    Full::new(x.into())
        .map_err(|e: Infallible| match e {})
        .boxed_unsync()
}
fn reply(status: u16, data: Value) -> Reply {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store")
        .body(full(data.to_string()))
        .unwrap()
}
fn error(status: u16, why: &str) -> Reply {
    reply(status, json!({"error":why}))
}
fn port(key: &str, default: u16) -> Result<u16, Error> {
    let p = env::var(key)
        .unwrap_or(default.to_string())
        .parse::<u16>()?;
    if p == 0 {
        return Err(format!("invalid {key}").into());
    }
    Ok(p)
}
fn command(web: bool) -> Vec<String> {
    let parsed = env::var("NEO_GPU_CMD_JSON")
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .filter(|a| !a.is_empty() && a.iter().all(|s| !s.contains('\0')));
    parsed.unwrap_or_else(|| {
        if web {
            vec![]
        } else {
            env::args().skip(1).collect()
        }
    })
}
fn valid_name(s: &str) -> bool {
    let (stem, ext) = s.split_once('.').map_or((s, None), |(a, b)| (a, Some(b)));
    (1..=64).contains(&stem.len())
        && stem.as_bytes()[0].is_ascii_alphabetic()
        && stem
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
        && ext.is_none_or(|s| {
            (1..=10).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric())
        })
}
fn valid_prefix(s: &str) -> bool {
    let Some(s) = s.strip_prefix('/') else {
        return false;
    };
    (1..=64).contains(&s.len())
        && s.as_bytes()[0].is_ascii_lowercase()
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
#[derive(Default)]
struct State {
    phase: &'static str,
    exit: Option<i32>,
    log: String,
    uploads: usize,
}
struct Shared {
    state: Mutex<State>,
    pid: AtomicI32,
    exited: AtomicBool,
    input: PathBuf,
    output: PathBuf,
    cmd: Vec<String>,
    app_port: u16,
    prefix: String,
}
impl Shared {
    fn status(&self) -> Value {
        let s = self.state.lock().unwrap();
        json!({"phase":s.phase,"exitCode":s.exit,"log":s.log})
    }
    fn record(&self, part: &[u8]) {
        let mut s = self.state.lock().unwrap();
        s.log.push_str(&String::from_utf8_lossy(part));
        let n = s.log.chars().count();
        if n > 2400 {
            s.log = s.log.chars().skip(n - 2400).collect()
        }
    }
    fn spawn_child(self: &Arc<Self>, web: bool) -> io::Result<()> {
        use std::process::Stdio;
        let Some(cmd) = self.cmd.first().filter(|s| !s.is_empty()) else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "image has no executable CMD or ENTRYPOINT",
            ));
        };
        let mut c = Command::new(cmd);
        c.args(&self.cmd[1..]).kill_on_drop(true);
        c.process_group(0);
        if web {
            c.env("PORT", self.app_port.to_string())
                .env("NEO_GPU_APP_PORT", self.app_port.to_string());
        } else {
            c.stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .env("NEO_GPU_INPUT_DIR", &self.input)
                .env("NEO_GPU_OUTPUT_DIR", &self.output);
        }
        let mut child = c.spawn()?;
        self.pid
            .store(child.id().unwrap_or(0) as i32, Ordering::Release);
        let s = self.clone();
        tokio::spawn(async move {
            let out = child
                .stdout
                .take()
                .map(|r| tokio::spawn(drain(s.clone(), r)));
            let err = child
                .stderr
                .take()
                .map(|r| tokio::spawn(drain(s.clone(), r)));
            let status = child.wait().await;
            // Do not retain a stale process group ID after the application exits.
            s.pid.store(0, Ordering::Release);
            s.exited.store(true, Ordering::Release);
            if let Some(t) = out {
                let _ = t.await;
            }
            if let Some(t) = err {
                let _ = t.await;
            }
            let mut st = s.state.lock().unwrap();
            st.exit = status.as_ref().ok().and_then(|v| v.code());
            st.phase = if status.is_ok_and(|v| v.success()) {
                "completed"
            } else {
                "failed"
            };
        });
        Ok(())
    }
}
async fn drain(s: Arc<Shared>, mut r: impl tokio::io::AsyncRead + Unpin) {
    let mut buf = [0; 4096];
    while let Ok(n) = r.read(&mut buf).await {
        if n == 0 {
            break;
        }
        s.record(&buf[..n]);
    }
}
struct UploadGuard {
    shared: Arc<Shared>,
    tmp: PathBuf,
}
impl Drop for UploadGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.tmp);
        self.shared.state.lock().unwrap().uploads -= 1;
    }
}
async fn upload(req: Request<Incoming>, s: Arc<Shared>, name: String) -> Reply {
    if !valid_name(&name) {
        return error(400, "invalid_name");
    }
    let mut random = [0u8; 16];
    if getrandom::fill(&mut random).is_err() {
        return error(500, "runtime_error");
    }
    let suffix = random
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let tmp = s.input.join(format!("{name}.{suffix}.tmp"));
    let guard = {
        let mut st = s.state.lock().unwrap();
        if st.phase != "idle" {
            return error(409, "already_started");
        }
        st.uploads += 1;
        UploadGuard {
            shared: s.clone(),
            tmp,
        }
    };
    let Some(n) = req
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|n| (1..=64 * 1024 * 1024).contains(n))
    else {
        return error(413, "invalid_content_length");
    };
    let res = tokio::time::timeout(Duration::from_secs(120), async {
        let mut f = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&guard.tmp)
            .await?;
        let mut body = req.into_body();
        let mut count = 0;
        while let Some(frame) = body.frame().await {
            let frame = frame.map_err(io::Error::other)?;
            if let Ok(data) = frame.into_data() {
                count += data.len() as u64;
                if count > n {
                    return Err(io::Error::other("oversized_upload"));
                }
                f.write_all(&data).await?;
            }
        }
        if count != n {
            return Err(io::Error::other("short_upload"));
        }
        f.sync_all().await?;
        drop(f);
        tokio::fs::rename(&guard.tmp, s.input.join(&name)).await?;
        Ok::<_, io::Error>(count)
    })
    .await;
    match res {
        Ok(Ok(count)) => reply(200, json!({"bytes":count})),
        _ => error(400, "upload_incomplete"),
    }
}
async fn output(s: &Shared, name: &str) -> Reply {
    if !valid_name(name) {
        return error(400, "invalid_name");
    }
    if s.state.lock().unwrap().phase != "completed" {
        return error(409, "not_completed");
    }
    let p = s.output.join(name);
    let f = match tokio::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(p)
        .await
    {
        Ok(f) => f,
        Err(_) => return error(404, "missing_output"),
    };
    let meta = match f.metadata().await {
        Ok(m) if m.is_file() => m,
        _ => return error(404, "missing_output"),
    };
    if meta.len() > 2 * 1024 * 1024 * 1024 {
        return error(413, "output_too_large");
    }
    use futures_util::TryStreamExt;
    use http_body_util::StreamBody;
    use tokio_util::io::ReaderStream;
    let body = StreamBody::new(
        ReaderStream::new(f)
            .map_ok(Frame::data)
            .map_err(|e| -> Error { Box::new(e) }),
    )
    .boxed_unsync();
    Response::builder()
        .status(200)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CONTENT_LENGTH, meta.len())
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap()
}
async fn batch(req: Request<Incoming>, s: Arc<Shared>) -> Reply {
    let path = req.uri().path().to_string();
    match (req.method(), path.as_str()) {
        (&Method::GET, "/health") => reply(200, json!({"ok":true,"service":"neo-gpu-v1"})),
        (&Method::GET, "/status") => reply(200, s.status()),
        (&Method::POST, "/start") => {
            {
                let mut st = s.state.lock().unwrap();
                if st.phase != "idle" {
                    return error(409, "already_started");
                }
                if st.uploads > 0 {
                    return error(409, "upload_in_progress");
                }
                st.phase = "running";
            }
            match s.spawn_child(false) {
                Ok(()) => reply(202, json!({"phase":"running"})),
                Err(e) => {
                    s.record(e.to_string().as_bytes());
                    s.state.lock().unwrap().phase = "failed";
                    reply(422, json!({"phase":"failed"}))
                }
            }
        }
        (&Method::POST, p)
            if p.strip_prefix("/inputs/")
                .is_some_and(|n| !n.is_empty() && !n.contains('/')) =>
        {
            upload(req, s, p[8..].into()).await
        }
        (&Method::GET, p)
            if p.strip_prefix("/outputs/")
                .is_some_and(|n| !n.is_empty() && !n.contains('/')) =>
        {
            output(&s, &p[9..]).await
        }
        _ => error(404, "not_found"),
    }
}
fn proxy_headers(headers: &mut http::HeaderMap, port: u16, prefix: &str) {
    let original = headers.remove("x-neo-app-authorization");
    headers.remove(header::AUTHORIZATION);
    headers.remove(header::PROXY_AUTHORIZATION);
    if let Some(v) = original {
        headers.insert(header::AUTHORIZATION, v);
    }
    headers.insert(header::HOST, format!("127.0.0.1:{port}").parse().unwrap());
    let prefix = headers
        .get("x-forwarded-prefix")
        .and_then(|v| v.to_str().ok())
        .filter(|v| valid_prefix(v))
        .unwrap_or(prefix)
        .to_owned();
    headers.insert(
        "x-forwarded-prefix",
        prefix
            .parse()
            .unwrap_or(http::HeaderValue::from_static("/")),
    );
}
async fn connect(port: u16) -> Result<hyper::client::conn::http1::SendRequest<Body>, Error> {
    let socket = tokio::time::timeout(
        Duration::from_secs(3),
        TcpStream::connect(("127.0.0.1", port)),
    )
    .await??;
    let (sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(socket)).await?;
    tokio::spawn(async move {
        let _ = conn.with_upgrades().await;
    });
    Ok(sender)
}
async fn health(s: &Shared) -> Reply {
    if s.exited.load(Ordering::Acquire) {
        return reply(
            503,
            json!({"ok":false,"service":"neo-gpu-web-v1","phase":"exited"}),
        );
    }
    let good = tokio::time::timeout(Duration::from_secs(3), async {
        let mut sender = connect(s.app_port).await?;
        let req = Request::builder()
            .method(Method::HEAD)
            .uri("/")
            .header(header::HOST, format!("127.0.0.1:{}", s.app_port))
            .body(full(""))?;
        sender.send_request(req).await?;
        Ok::<_, Error>(())
    })
    .await
    .is_ok_and(|r| r.is_ok());
    if good {
        reply(200, json!({"ok":true,"service":"neo-gpu-web-v1"}))
    } else {
        reply(
            503,
            json!({"ok":false,"service":"neo-gpu-web-v1","phase":"starting"}),
        )
    }
}
async fn web(mut req: Request<Incoming>, s: Arc<Shared>) -> Reply {
    if req
        .uri()
        .path_and_query()
        .is_some_and(|p| p.as_str() == "/health")
    {
        return health(&s).await;
    }
    // Only origin-form targets may reach the local app; no external proxying.
    if req.uri().scheme().is_some() || req.uri().authority().is_some() {
        return error(400, "invalid_target");
    }
    proxy_headers(req.headers_mut(), s.app_port, &s.prefix);
    let upgrade = req.headers().get(header::UPGRADE).is_some();
    let down = upgrade.then(|| hyper::upgrade::on(&mut req));
    let (parts, body) = req.into_parts();
    let req = Request::from_parts(
        parts,
        body.map_err(|e| -> Error { Box::new(e) }).boxed_unsync(),
    );
    let result = async {
        let mut sender = connect(s.app_port).await?;
        let mut resp = sender.send_request(req).await?;
        if resp.status() == StatusCode::SWITCHING_PROTOCOLS {
            if let Some(down) = down {
                let up = hyper::upgrade::on(&mut resp);
                tokio::spawn(async move {
                    if let (Ok(d), Ok(u)) = tokio::join!(down, up) {
                        let _ = tokio::io::copy_bidirectional(
                            &mut TokioIo::new(d),
                            &mut TokioIo::new(u),
                        )
                        .await;
                    }
                });
            } else {
                return Err("unexpected upstream upgrade".into());
            }
        }
        Ok::<Reply, Error>(resp.map(|b| b.map_err(|e| -> Error { Box::new(e) }).boxed_unsync()))
    }
    .await;
    result.unwrap_or_else(|_| {
        Response::builder()
            .status(502)
            .body(full("GPU application unavailable"))
            .unwrap()
    })
}
fn directory(p: &Path) -> Result<(), Error> {
    use std::os::unix::fs::DirBuilderExt;
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(p)?;
    Ok(())
}
async fn shutdown(s: Arc<Shared>) {
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("SIGTERM handler");
    tokio::select! {_=term.recv()=>{},_=tokio::signal::ctrl_c()=>{}}
    let pid = s.pid.load(Ordering::Acquire);
    if pid > 0 {
        unsafe {
            libc::kill(-pid, libc::SIGTERM);
        }
    }
    tokio::time::sleep(Duration::from_millis(1100)).await;
    let pid = s.pid.load(Ordering::Acquire);
    if pid > 0 {
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
    }
    // Container exit must not wait for an idle upgraded connection.
    std::process::exit(0)
}
async fn run() -> Result<(), Error> {
    let mode = env::var("NEO_GPU_MODE").unwrap_or("batch".into());
    let web_mode = match mode.as_str() {
        "batch" => false,
        "web" => true,
        _ => return Err("Invalid NEO_GPU_MODE".into()),
    };
    let port = port("NEO_GPU_PORT", 8000)?;
    let app_port = crate::port("NEO_GPU_APP_PORT", 7860)?;
    let input = PathBuf::from(env::var("NEO_GPU_INPUT_DIR").unwrap_or("/neo/input".into()));
    let output = PathBuf::from(env::var("NEO_GPU_OUTPUT_DIR").unwrap_or("/neo/output".into()));
    let cmd = command(web_mode);
    if web_mode && (port == app_port || cmd.first().is_none_or(|s| s.is_empty())) {
        return Err("Invalid Neo GPU web runtime configuration".into());
    }
    if !web_mode {
        directory(&input)?;
        directory(&output)?;
    }
    let s = Arc::new(Shared {
        state: Mutex::new(State {
            phase: "idle",
            ..Default::default()
        }),
        pid: AtomicI32::new(0),
        exited: AtomicBool::new(false),
        input,
        output,
        cmd,
        app_port,
        prefix: env::var("NEO_GPU_BASE_PATH").unwrap_or("/".into()),
    });
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;
    if web_mode {
        if let Err(e) = s.spawn_child(true) {
            eprintln!("Web application failed to launch: {e}");
            s.exited.store(true, Ordering::Release);
        }
    }
    tokio::spawn(shutdown(s.clone()));
    println!(
        "{} port={port}",
        if web_mode {
            "NEO_GPU_WEB_READY"
        } else {
            "NEO_GPU_SERVICE_READY"
        }
    );
    let limit = Arc::new(tokio::sync::Semaphore::new(128));
    loop {
        let (socket, _) = listener.accept().await?;
        let Ok(permit) = limit.clone().try_acquire_owned() else {
            drop(socket);
            continue;
        };
        let s = s.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let svc = hyper::service::service_fn(move |r| {
                let s = s.clone();
                async move {
                    Ok::<_, Infallible>(if web_mode {
                        web(r, s).await
                    } else {
                        batch(r, s).await
                    })
                }
            });
            let _ = hyper::server::conn::http1::Builder::new()
                .serve_connection(TokioIo::new(socket), svc)
                .with_upgrades()
                .await;
        });
    }
}
#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("{e}");
        std::process::exit(2)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names() {
        for v in ["a", "message.txt", "A-b_1.png"] {
            assert!(valid_name(v))
        }
        for v in [
            "",
            "../x",
            "a/b",
            "a..b",
            "a.",
            ".x",
            "a%2f",
            "a.abcdefghijk",
        ] {
            assert!(!valid_name(v))
        }
    }
    #[test]
    fn auth_and_prefix() {
        let mut h = http::HeaderMap::new();
        h.insert(header::AUTHORIZATION, "Bearer provider".parse().unwrap());
        h.insert("x-neo-app-authorization", "Bearer app".parse().unwrap());
        h.insert(header::PROXY_AUTHORIZATION, "secret".parse().unwrap());
        h.insert("x-forwarded-prefix", "/bad/path".parse().unwrap());
        proxy_headers(&mut h, 7860, "/demo/");
        assert_eq!(h[header::AUTHORIZATION], "Bearer app");
        assert_eq!(h["x-forwarded-prefix"], "/demo/");
        assert!(!h.contains_key(header::PROXY_AUTHORIZATION));
        assert!(!h.contains_key("x-neo-app-authorization"));
    }
}
