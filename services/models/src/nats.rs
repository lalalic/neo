//! Bounded native NATS subscription for the existing local Events Bus.
//! Reconnects re-subscribe; requests are not dispatched while ingress is down.
use crate::{
    reply,
    store::{self, Store},
    Result,
};
use serde_json::{json, Value};
use std::{
    env,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};
use url::Url;

#[derive(Clone, Debug)]
pub struct Config {
    pub url: String,
    pub prefix: String,
}
impl Config {
    pub fn from_env(home: &Path) -> Result<Self> {
        let dir = env::var_os("EVENTS_BUS_DATA_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or(home.join("Library/Application Support/EventsBus"));
        let file = env::var_os("EVENTS_BUS_CONFIG")
            .map(std::path::PathBuf::from)
            .unwrap_or(dir.join("runtime.json"));
        let saved = store::read(&file)?.unwrap_or(json!({}));
        if !saved.is_object() {
            return Err("Events Bus runtime configuration must be an object".into());
        }
        let override_prefix = env::var("EVENTS_BUS_SUBJECT_PREFIX").ok();
        if saved["subjectPrefix"] == "neo.events.job" && override_prefix.is_none() {
            return Err(
                "Legacy Events Bus subject in saved runtime config; coordinate migration".into(),
            );
        }
        let prefix = override_prefix.unwrap_or_else(|| {
            saved["subjectPrefix"]
                .as_str()
                .unwrap_or("relay.events.job")
                .to_owned()
        });
        let url = env::var("EVENTS_BUS_NATS_URL").unwrap_or_else(|_| {
            saved["natsUrl"]
                .as_str()
                .unwrap_or("nats://127.0.0.1:4222")
                .into()
        });
        let prefix = prefix
            .strip_suffix(".job")
            .map(|s| format!("{s}.reply"))
            .unwrap_or_else(|| format!("{prefix}.reply"));
        if !prefix.split('.').all(|s| {
            !s.is_empty()
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        }) {
            return Err("invalid NATS subject prefix".into());
        }
        Ok(Self { url, prefix })
    }
}
fn line(reader: &mut BufReader<TcpStream>) -> Result<String> {
    let mut buf = vec![];
    let n = reader
        .take(8193)
        .read_until(b'\n', &mut buf)
        .map_err(|e| e.to_string())?;
    if n == 0 || n > 8192 || !buf.ends_with(b"\r\n") {
        return Err("invalid NATS line".into());
    }
    buf.truncate(n - 2);
    String::from_utf8(buf).map_err(|_| "invalid NATS UTF-8".into())
}
fn write(reader: &mut BufReader<TcpStream>, data: &[u8]) -> Result<()> {
    reader.get_mut().write_all(data).map_err(|e| e.to_string())
}
fn connect(cfg: &Config) -> Result<BufReader<TcpStream>> {
    let url = Url::parse(&cfg.url).map_err(|e| e.to_string())?;
    if url.scheme() != "nats"
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(
            url.host_str(),
            Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
        )
    {
        return Err("native Models NATS transport requires local unauthenticated broker".into());
    }
    let host = url.host_str().unwrap().trim_matches(['[', ']']);
    let addresses = (host, url.port().unwrap_or(4222))
        .to_socket_addrs()
        .map_err(|e| e.to_string())?;
    let stream = addresses
        .filter_map(|a| TcpStream::connect_timeout(&a, Duration::from_secs(2)).ok())
        .next()
        .ok_or("Events Bus unavailable")?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream);
    let info = line(&mut reader)?;
    let caps: Value = serde_json::from_str(info.strip_prefix("INFO ").ok_or("missing NATS INFO")?)
        .map_err(|e| e.to_string())?;
    if !caps.is_object() || caps["tls_required"] == true || caps["auth_required"] == true {
        return Err("unsupported NATS broker authentication or TLS".into());
    }
    let conn = json!({"verbose":false,"pedantic":false,"name":"neo-reply-models-rust"});
    write(
        &mut reader,
        format!(
            "CONNECT {conn}\r\nSUB {}.models.> 1\r\nPING\r\n",
            cfg.prefix
        )
        .as_bytes(),
    )?;
    for _ in 0..16 {
        match line(&mut reader)?.as_str() {
            "PONG" => {
                reader
                    .get_mut()
                    .set_read_timeout(Some(Duration::from_secs(180)))
                    .map_err(|e| e.to_string())?;
                return Ok(reader);
            }
            "PING" => write(&mut reader, b"PONG\r\n")?,
            "+OK" => {}
            _ => return Err("NATS subscription handshake rejected".into()),
        }
    }
    Err("NATS subscription not acknowledged".into())
}
fn consume(reader: &mut BufReader<TcpStream>, cfg: &Config, store: &Store) -> Result<()> {
    let frame = line(reader)?;
    if frame == "PING" {
        return write(reader, b"PONG\r\n");
    }
    if frame == "PONG" || frame == "+OK" || frame.starts_with("INFO ") {
        return Ok(());
    }
    let parts: Vec<_> = frame.split_whitespace().collect();
    if parts.first() != Some(&"MSG") || !(parts.len() == 4 || parts.len() == 5) || parts[2] != "1" {
        return Err("unexpected NATS frame".into());
    }
    let n = parts
        .last()
        .unwrap()
        .parse::<usize>()
        .map_err(|_| "invalid NATS message length")?;
    if n > 2 * 1024 * 1024 {
        return Err("NATS message too large".into());
    }
    let mut payload = vec![0; n];
    reader.read_exact(&mut payload).map_err(|e| e.to_string())?;
    let mut tail = [0; 2];
    reader.read_exact(&mut tail).map_err(|e| e.to_string())?;
    if &tail != b"\r\n" {
        return Err("invalid NATS message terminator".into());
    }
    let parsed = serde_json::from_slice::<Value>(&payload)
        .map_err(|_| "invalid reply JSON".to_string())
        .and_then(|v| reply::apply(store, parts[1], &cfg.prefix, &v));
    if let Err(e) = parsed {
        eprintln!("[models] reply rejected: {e}")
    }
    Ok(())
}
pub fn start(cfg: Config, store: Store) -> Result<Arc<AtomicBool>> {
    let initial = connect(&cfg)?;
    let ready = Arc::new(AtomicBool::new(true));
    let flag = ready.clone();
    thread::Builder::new()
        .name("models-nats".into())
        .spawn(move || {
            let mut connection = initial;
            loop {
                if let Err(e) = consume(&mut connection, &cfg, &store) {
                    flag.store(false, Ordering::Release);
                    eprintln!("[models] reply subscription disconnected: {e}");
                    loop {
                        thread::sleep(Duration::from_secs(1));
                        if let Ok(r) = connect(&cfg) {
                            connection = r;
                            flag.store(true, Ordering::Release);
                            break;
                        }
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(ready)
}
