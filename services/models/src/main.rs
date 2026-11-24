//! Candidate binary. Live cutover is prohibited until Orchestrator parity
//! and the documented three real Codex MVPs have passed.
use neo_models::{
    engine::Engine,
    http::{self, App},
    nats,
    notifier::NeoNotifier,
    orchestrator::Orchestrator,
    orchestrator_client::{Grants, HttpClient},
    store::Store,
    webhelm::WebHelm,
    Result,
};
use std::{
    env, fs,
    os::unix::{
        fs::{OpenOptionsExt, PermissionsExt},
        io::AsRawFd,
    },
    path::PathBuf,
    sync::{atomic::AtomicBool, Arc},
};
fn run() -> Result<()> {
    if env::var("NEO_ORCHESTRATOR_RELAY_EVENTS").as_deref() == Ok("1") {
        return Err(
            "native Relay event monitor not yet migrated; refusing to silently disable it".into(),
        );
    }
    let home = PathBuf::from(env::var_os("HOME").ok_or("HOME unavailable")?);
    let base = env::var_os("NEO_MODELS_STATE_DIR")
        .map(PathBuf::from)
        .ok_or("candidate requires explicit NEO_MODELS_STATE_DIR")?;
    if base == home.join(".local/share/neo/model-gateway") {
        return Err("candidate cannot own production Models state before parity gate".into());
    }
    let port = env::var("NEO_MODEL_GATEWAY_PORT")
        .unwrap_or("8786".into())
        .parse::<u16>()
        .map_err(|_| "invalid Models port")?;
    if port < 1024 || port == 8769 {
        return Err("candidate requires a nonproduction loopback port".into());
    }
    let token_path = env::var_os("NEO_MODELS_TOKEN_FILE")
        .map(PathBuf::from)
        .unwrap_or(home.join(".config/neo/models/token"));
    let meta = fs::symlink_metadata(&token_path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.permissions().mode() & 0o077 != 0 {
        return Err("model token file permissions must be 0600".into());
    }
    let token = fs::read_to_string(token_path)
        .map_err(|e| e.to_string())?
        .trim()
        .to_owned();
    if token.len() < 24 {
        return Err("private Bearer token required".into());
    }
    let prod = home.join(".local/share/neo/model-gateway");
    if let Ok(prod) = prod.canonicalize() {
        let mut existing = base.as_path();
        while !existing.exists() {
            existing = existing
                .parent()
                .ok_or("candidate state path must be absolute")?;
        }
        let canonical = existing.canonicalize().map_err(|e| e.to_string())?;
        if canonical.starts_with(&prod) || (base.exists() && prod.starts_with(&canonical)) {
            return Err("candidate state path overlaps production".into());
        }
    }
    if !base.is_absolute() {
        return Err("candidate state path must be absolute".into());
    }
    let store = Store::open(base.clone())?;
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .open(base.join(".native-owner.lock"))
        .map_err(|e| e.to_string())?;
    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        return Err("Models state already has a native owner".into());
    }
    let legacy_origin = env::var("NEO_MODELS_LEGACY_ORIGIN").ok();
    if let Some(origin) = &legacy_origin {
        if !regex::Regex::new(r"^http://127\.0\.0\.1:[0-9]+$")
            .unwrap()
            .is_match(origin)
        {
            return Err("legacy origin must be loopback".into());
        }
    }
    let transport = Arc::new(WebHelm::from_env(&home, &base)?);
    let engine = Engine::new(store.clone(), transport.clone());
    let ready = if env::var("NEO_MODEL_REPLY_EVENTS").as_deref() == Ok("0") {
        Arc::new(AtomicBool::new(false))
    } else {
        nats::start(nats::Config::from_env(&home)?, store.clone())?
    };
    let server = tiny_http::Server::http(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    let token = Arc::new(token);
    let grants = Grants::default();
    let orchestrator = Orchestrator::open(
        store,
        Arc::new(HttpClient {
            port,
            token: token.clone(),
            grants: grants.clone(),
        }),
        Some(transport),
        Some(Arc::new(NeoNotifier::from_env(&home)?)),
    )?;
    if orchestrator.health()["ready"] == true {
        orchestrator.start(ready.clone());
    }
    println!("Neo native Models candidate on loopback port {port}");
    http::serve(
        server,
        App {
            engine,
            token,
            grants,
            orchestrator,
            ready,
            legacy_origin,
        },
    )
}
fn main() {
    if let Err(e) = run() {
        eprintln!("[models] {e}");
        std::process::exit(1)
    }
}
