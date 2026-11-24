//! Authenticated loopback HTTP endpoints for generic Responses and Chat API.
use crate::{
    catalog,
    engine::Engine,
    sse::{self, Writer},
    store::{codex_id, response_id},
    Result,
};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};
use url::Url;
const MAX_BODY: usize = 48 * 1024 * 1024;
#[derive(Clone)]
pub struct App {
    pub engine: Engine,
    pub token: Arc<String>,
    pub ready: Arc<AtomicBool>,
    pub legacy_origin: Option<String>,
}
fn header<'a>(r: &'a Request, name: &str) -> Option<&'a str> {
    r.headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str())
}
fn equal(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}
fn h(k: &str, v: &str) -> Header {
    Header::from_bytes(k.as_bytes(), v.as_bytes()).expect("static header")
}
fn send(r: Request, status: u16, value: Value) {
    let response = Response::from_string(value.to_string())
        .with_status_code(StatusCode(status))
        .with_header(h("Content-Type", "application/json; charset=utf-8"))
        .with_header(h("Cache-Control", "no-store"));
    let _ = r.respond(response);
}
fn error(r: Request, status: u16, message: &str, kind: &str) {
    send(r, status, json!({"error":{"message":message,"type":kind}}))
}
fn raw(r: &mut Request) -> Result<Vec<u8>> {
    if r.body_length().is_some_and(|n| n > MAX_BODY) {
        return Err("request too large".into());
    }
    let mut data = vec![];
    r.as_reader()
        .take(MAX_BODY as u64 + 1)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() > MAX_BODY {
        return Err("request too large".into());
    }
    Ok(data)
}
fn body(r: &mut Request) -> Result<Value> {
    if !header(r, "content-type").is_some_and(|s| s.contains("application/json")) {
        return Err("application/json required".into());
    }
    serde_json::from_slice(&raw(r)?).map_err(|_| "invalid request JSON".into())
}
fn full_text(r: &Value) -> String {
    r["output"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v["content"][0]["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n")
}
fn chat(r: &Value, stream: bool, delta: Value, finish: Value) -> Value {
    let id = r["id"].as_str().unwrap_or("resp_unknown");
    let content = if stream {
        json!({"index":0,"delta":delta,"finish_reason":finish})
    } else {
        json!({"index":0,"message":{"role":"assistant","content":full_text(r)},"finish_reason":"stop"})
    };
    let mut result = json!({"id":format!("chatcmpl_{}",id.strip_prefix("resp_").unwrap_or(id)),"object":if stream{"chat.completion.chunk"}else{"chat.completion"},"created":r["created_at"],"model":r["model"],"choices":[content]});
    if !stream {
        result["usage"] = Value::Null
    }
    result
}
/// Explicit chunk framing and flush, rather than tiny_http's buffered
/// response reader, ensures each report is visible immediately.
pub struct Stream {
    writer: Box<dyn Write + Send>,
}
impl Stream {
    pub fn open(r: Request) -> std::io::Result<Self> {
        let mut writer = r.into_writer();
        writer.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nCache-Control: no-cache, no-transform\r\nX-Accel-Buffering: no\r\nTransfer-Encoding: chunked\r\n\r\n")?;
        writer.flush()?;
        Ok(Self { writer })
    }
    pub fn chunk(&mut self, s: &str) -> std::io::Result<()> {
        if s.is_empty() {
            return Ok(());
        }
        write!(self.writer, "{:x}\r\n", s.len())?;
        self.writer.write_all(s.as_bytes())?;
        self.writer.write_all(b"\r\n")?;
        self.writer.flush()
    }
    pub fn finish(mut self) {
        let _ = self.writer.write_all(b"0\r\n\r\n");
        let _ = self.writer.flush();
    }
}
fn stream(r: Request, app: &App, id: &str, chat_path: bool) {
    let Ok(mut out) = Stream::open(r) else { return };
    let mut writer = Writer::default();
    let mut seen = 0;
    let mut started = false;
    let mut last = Instant::now();
    loop {
        let snapshot = app.engine.snapshot(id);
        let value = match snapshot {
            Ok(Some(v)) => v,
            _ => {
                let e = if chat_path {
                    format!(
                        "data: {}\n\n",
                        json!({"error":{"message":"response unavailable","type":"model_error"}})
                    )
                } else {
                    writer.fail(id, "response unavailable")
                };
                let _ = out.chunk(&e);
                break;
            }
        };
        if !chat_path {
            if out.chunk(&writer.update(&value)).is_err() {
                return;
            }
            if writer.terminal {
                break;
            }
        } else {
            if !started {
                if out
                    .chunk(&format!(
                        "data: {}\n\n",
                        chat(&value, true, json!({"role":"assistant"}), Value::Null)
                    ))
                    .is_err()
                {
                    return;
                }
                started = true;
            }
            let content = full_text(&value);
            if content.len() > seen {
                let delta = &content[seen..];
                seen = content.len();
                if out
                    .chunk(&format!(
                        "data: {}\n\n",
                        chat(&value, true, json!({"content":delta}), Value::Null)
                    ))
                    .is_err()
                {
                    return;
                }
            }
            if value["status"] == "completed" {
                let _ = out.chunk(&format!(
                    "data: {}\n\ndata: [DONE]\n\n",
                    chat(&value, true, json!({}), json!("stop"))
                ));
                break;
            }
            if value["status"] == "failed" {
                let _ = out.chunk(&format!(
                    "data: {}\n\n",
                    json!({"error":{"message":value["error"]["message"],"type":"model_error"}})
                ));
                break;
            }
        }
        if last.elapsed() >= Duration::from_secs(12) {
            if out.chunk(": keepalive\n\n").is_err() {
                return;
            }
            last = Instant::now();
        }
        thread::sleep(Duration::from_millis(100));
    }
    out.finish()
}
fn proxy(mut r: Request, origin: &str, token: &str) {
    let target = format!("{origin}{}", r.url());
    let method = r.method().as_str().to_owned();
    let content_type = header(&r, "content-type").map(str::to_owned);
    let data = match raw(&mut r) {
        Ok(v) => v,
        Err(e) => {
            error(r, 400, &e, "invalid_request_error");
            return;
        }
    };
    let agent = ureq::Agent::config_builder()
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(90)))
        .build()
        .new_agent();
    let response = if method == "GET" {
        agent
            .get(&target)
            .header("Authorization", format!("Bearer {token}"))
            .call()
    } else {
        let req = ureq::http::Request::builder()
            .method(method.as_str())
            .uri(&target)
            .header("Authorization", format!("Bearer {token}"))
            .header(
                "Content-Type",
                content_type.as_deref().unwrap_or("application/json"),
            )
            .body(data);
        match req {
            Ok(req) => agent.run(req),
            Err(_) => {
                error(r, 400, "invalid upstream request", "invalid_request_error");
                return;
            }
        }
    };
    match response {
        Ok(mut upstream) => {
            let status = upstream.status().as_u16();
            if (300..400).contains(&status) {
                error(r, 502, "upstream redirects disallowed", "upstream_error");
                return;
            }
            let ct = upstream
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/json")
                .to_owned();
            let mut bytes = vec![];
            if upstream
                .body_mut()
                .as_reader()
                .take(128 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .is_err()
                || bytes.len() > 128 * 1024 * 1024
            {
                error(r, 502, "provider unavailable", "upstream_error");
                return;
            }
            let _ = r.respond(
                Response::from_data(bytes)
                    .with_status_code(StatusCode(status))
                    .with_header(h("Content-Type", &ct))
                    .with_header(h("Cache-Control", "no-store")),
            );
        }
        Err(_) => error(r, 502, "provider unavailable", "upstream_error"),
    }
}
pub fn handle(mut r: Request, app: &App) {
    let expected = format!("Bearer {}", app.token);
    if !header(&r, "authorization").is_some_and(|s| equal(s.as_bytes(), expected.as_bytes())) {
        error(r, 401, "unauthorized", "authentication_error");
        return;
    }
    let url = match Url::parse(&format!("http://127.0.0.1{}", r.url())) {
        Ok(v) => v,
        Err(_) => {
            error(r, 400, "invalid URL", "invalid_request_error");
            return;
        }
    };
    let path = url.path();
    if path.starts_with("/orchestrator-chat/") {
        error(
            r,
            503,
            "native Orchestrator adapter not yet enabled",
            "migration_incomplete",
        );
        return;
    }
    if r.method() == &Method::Get && path == "/v1/models" {
        send(
            r,
            200,
            catalog::list(url.query_pairs().any(|(k, _)| k == "client_version")),
        );
        return;
    }
    if r.method() == &Method::Get {
        if let Some(id) = path
            .strip_prefix("/v1/responses/")
            .filter(|s| response_id(s))
        {
            match app.engine.snapshot(id) {
                Ok(Some(v)) => send(r, 200, sse::public(&v)),
                Ok(None) => {
                    if let Some(origin) = &app.legacy_origin {
                        proxy(r, origin, &app.token)
                    } else {
                        error(r, 503, "configured provider unavailable", "upstream_error")
                    }
                }
                Err(e) => error(r, 500, &e, "internal_error"),
            }
            return;
        }
    }
    if path.starts_with("/api/v2/rodin") || matches!(path, "/api/v2/status" | "/api/v2/download") {
        if let Some(origin) = &app.legacy_origin {
            proxy(r, origin, &app.token)
        } else {
            error(r, 503, "configured provider unavailable", "upstream_error")
        }
        return;
    }
    let chat_path = path == "/v1/chat/completions";
    if r.method() != &Method::Post || !(chat_path || path == "/v1/responses") {
        error(r, 404, "not found", "invalid_request_error");
        return;
    }
    if !app.ready.load(Ordering::Acquire) {
        error(
            r,
            503,
            "Events Bus reply subscription unavailable",
            "model_error",
        );
        return;
    }
    let mut input = match body(&mut r) {
        Ok(v) => v,
        Err(e) => {
            error(r, 400, &e, "invalid_request_error");
            return;
        }
    };
    if chat_path {
        input["input"] = input["messages"].clone();
    }
    let ids = r
        .headers()
        .iter()
        .filter(|h| {
            h.field.as_str().as_str().eq_ignore_ascii_case("thread-id")
                || h.field.as_str().as_str().eq_ignore_ascii_case("thread_id")
        })
        .map(|h| h.value.as_str())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();
    if ids.windows(2).any(|w| w[0] != w[1]) {
        error(
            r,
            400,
            "conflicting Codex Thread headers",
            "invalid_request_error",
        );
        return;
    }
    let owner = ids.first().copied().map(str::to_owned);
    if owner.as_deref().is_some_and(|s| !codex_id(s)) {
        error(
            r,
            400,
            "invalid Codex Thread header",
            "invalid_request_error",
        );
        return;
    }
    if owner.is_none() && (header(&r, "session-id").is_some() || header(&r, "session_id").is_some())
    {
        error(
            r,
            400,
            "Codex Thread ID required; session-id is not a Thread identity",
            "invalid_request_error",
        );
        return;
    }
    if header(&r, "x-neo-orchestrator-grant").is_some() {
        error(
            r,
            403,
            "unauthorized private /v1 request",
            "authentication_error",
        );
        return;
    }
    let streaming = input["stream"].as_bool().unwrap_or(false);
    let admitted = match app.engine.start(input, owner.as_deref(), vec![]) {
        Ok(v) => v,
        Err(e) => {
            if streaming {
                if let Ok(mut out) = Stream::open(r) {
                    let msg = if chat_path {
                        format!(
                            "data: {}\n\n",
                            json!({"error":{"message":e,"type":"model_error"}})
                        )
                    } else {
                        Writer::default().fail("unknown", &e)
                    };
                    let _ = out.chunk(&msg);
                    out.finish()
                }
            } else {
                error(r, if chat_path { 502 } else { 400 }, &e, "model_error")
            }
            return;
        }
    };
    if streaming {
        stream(r, app, &admitted.id, chat_path)
    } else if chat_path {
        match app.engine.wait(&admitted.id) {
            Ok(v) => send(r, 200, chat(&v, false, Value::Null, Value::Null)),
            Err(e) => error(r, 502, &e, "model_error"),
        }
    } else {
        send(
            r,
            if admitted.initial["status"] == "completed" {
                200
            } else {
                202
            },
            sse::public(&admitted.initial),
        )
    }
}
pub fn serve(server: Server, app: App) -> Result<()> {
    let active = Arc::new(AtomicUsize::new(0));
    for request in server.incoming_requests() {
        if active.fetch_add(1, Ordering::AcqRel) >= 128 {
            active.fetch_sub(1, Ordering::AcqRel);
            error(request, 503, "gateway at capacity", "model_error");
            continue;
        }
        let app = app.clone();
        let active = active.clone();
        thread::spawn(move || {
            struct Guard(Arc<AtomicUsize>);
            impl Drop for Guard {
                fn drop(&mut self) {
                    self.0.fetch_sub(1, Ordering::AcqRel);
                }
            }
            let _guard = Guard(active);
            handle(request, &app);
        });
    }
    Ok(())
}
