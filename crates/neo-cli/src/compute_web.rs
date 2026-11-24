//! Rust Compute Web control plane. Session config/token and provider state
//! are private, atomic and cannot be used to bypass the existing spend gate.
use crate::compute;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use regex::Regex;
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{
    env, fs,
    path::{Path, PathBuf},
    time::Duration,
};
pub(crate) fn web_root() -> Result<PathBuf, String> {
    Ok(env::var_os("NEO_COMPUTE_WEB_DIR")
        .map(PathBuf::from)
        .unwrap_or(compute::home()?.join(".config/neo/compute/web")))
}
pub(crate) fn sessions_root() -> Result<PathBuf, String> {
    Ok(env::var_os("NEO_COMPUTE_WEB_SESSIONS")
        .map(PathBuf::from)
        .unwrap_or(compute::home()?.join(".local/state/neo/compute/web")))
}
pub(crate) fn validate(name: &str) -> Result<&str, String> {
    if !Regex::new("^[a-z][a-z0-9-]{0,63}$").unwrap().is_match(name) {
        return Err("Invalid web service name".into());
    }
    Ok(name)
}
fn config_file() -> Result<PathBuf, String> {
    Ok(web_root()?.join("services.json"))
}
fn session_file(name: &str) -> Result<PathBuf, String> {
    Ok(sessions_root()?.join(format!("{}.json", validate(name)?)))
}
fn token_file(name: &str) -> Result<PathBuf, String> {
    Ok(web_root()?.join(format!("tokens/{}.token", validate(name)?)))
}
fn registry() -> Result<Value, String> {
    compute::read_json(&config_file()?, json!({"version":1,"services":{}}))
}
pub(crate) fn session(name: &str) -> Result<Value, String> {
    compute::read_json(&session_file(name)?, json!({"phase":"stopped"}))
}
pub(crate) fn service(name: &str) -> Result<Value, String> {
    let entry = registry()?["services"][validate(name)?].clone();
    if entry.is_null() {
        return Err(format!("Unknown Compute web service: {name}"));
    }
    Ok(entry)
}
pub(crate) fn origin() -> String {
    env::var("NEO_COMPUTE_WEB_ORIGIN").unwrap_or_else(|_| "https://compute.qili2.com".into())
}
pub(crate) fn url(name: &str) -> String {
    format!("{}/{name}/", origin().trim_end_matches('/'))
}
fn token() -> Result<String, String> {
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).map_err(|_| "Compute token entropy unavailable")?;
    Ok(URL_SAFE_NO_PAD.encode(seed))
}
fn new_token(name: &str) -> Result<String, String> {
    use std::io::Write;
    let path = token_file(name)?;
    let parent = path.parent().ok_or("Token directory unavailable")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    let mut flags = fs::OpenOptions::new();
    flags.write(true).create_new(true);
    #[cfg(unix)]
    flags.mode(0o600);
    let mut file = flags
        .open(&path)
        .map_err(|_| "Compute Web token already exists")?;
    let secret = token()?;
    file.write_all(format!("{secret}\n").as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(secret)
}
pub(crate) fn existing_token(name: &str) -> Result<String, String> {
    let path = token_file(name)?;
    let info = fs::symlink_metadata(&path).map_err(|_| "Compute Web token unavailable")?;
    if !info.is_file() || info.file_type().is_symlink() || info.len() > 2048 {
        return Err("Unsafe Compute Web token file".into());
    }
    Ok(fs::read_to_string(path)
        .map_err(|_| "Cannot read Compute Web token")?
        .trim()
        .to_string())
}
pub(crate) fn safe_status(name: &str) -> Result<Value, String> {
    let mut state = session(name)?;
    if let Some(file) = state["lease"].as_str() {
        let lease = compute::read_json(Path::new(file), Value::Null)?;
        if lease["phase"] == "destroyed"
            && !matches!(state["phase"].as_str(), Some("stopped" | "failed"))
        {
            state["phase"] = json!("stopped");
            state["terminalStatus"] = lease["terminalStatus"].clone();
            compute::write_private_state(&session_file(name)?, &state)?;
        }
    }
    Ok(state)
}
/// Kernel advisory lock: process death automatically releases ownership.
/// A leftover lock filename is not authority and cannot permanently block
/// a Compute Web service after a caller crashes.
struct Lock {
    file: fs::File,
}
impl Lock {
    fn take(name: &str) -> Result<Self, String> {
        let path = session_file(name)?.with_extension("json.lock");
        fs::create_dir_all(path.parent().ok_or("Invalid Web lock directory")?)
            .map_err(|e| e.to_string())?;
        let mut open = fs::OpenOptions::new();
        open.write(true).create(true);
        #[cfg(unix)]
        open.mode(0o600);
        let file = open
            .open(path)
            .map_err(|_| "Cannot open Web operation lock")?;
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
                return Err("Compute Web service has an operation in progress".into());
            }
        }
        Ok(Self { file })
    }
}
impl Drop for Lock {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            let _ = unsafe { libc::flock(self.file.as_raw_fd(), libc::LOCK_UN) };
        }
    }
}
fn options(
    args: &[String],
    values: &[&str],
    switches: &[&str],
) -> Result<(Vec<String>, Value), String> {
    let mut pos = Vec::new();
    let mut map = serde_json::Map::new();
    let mut i = 0;
    while i < args.len() {
        let key = &args[i];
        if !key.starts_with("--") {
            pos.push(key.clone());
            i += 1;
            continue;
        }
        if map.contains_key(key) {
            return Err(format!("Repeated Web option {key}"));
        }
        if switches.contains(&key.as_str()) {
            map.insert(key.clone(), json!(true));
            i += 1;
            continue;
        }
        if !values.contains(&key.as_str()) {
            return Err(format!("Unknown Web option {key}"));
        }
        let value = args
            .get(i + 1)
            .filter(|s| !s.is_empty() && !s.starts_with("--"))
            .ok_or_else(|| format!("Web option {key} needs value"))?;
        map.insert(key.clone(), json!(value));
        i += 2;
    }
    Ok((pos, Value::Object(map)))
}
fn number(
    value: Option<&str>,
    default: &str,
    label: &str,
    min: u64,
    max: u64,
) -> Result<u64, String> {
    compute::number(value.unwrap_or(default), label, min, max)
}
fn money(value: Option<&str>, default: &str, label: &str) -> Result<f64, String> {
    compute::amount(value.unwrap_or(default), label, 5.0)
}
fn add(args: &[String]) -> Result<Value, String> {
    let (pos, opt) = options(
        args,
        &[
            "--provider",
            "--budget",
            "--max-seconds",
            "--flavor",
            "--gpu",
            "--disk",
            "--max-hourly",
            "--countries",
        ],
        &[],
    )?;
    if pos.len() != 1 {
        return Err("usage: neo compute web add SERVICE [--provider hf|vast]".into());
    }
    let name = validate(&pos[0])?;
    if registry()?["services"].get(name).is_some() {
        return Err("Compute Web service already exists".into());
    }
    let built = compute::service_registry()?["services"][name].clone();
    if built["mode"] != "web" || built["published"] != true {
        return Err(
            "Build and publish this service with neo compute build --mode web first".into(),
        );
    }
    let provider = opt["--provider"].as_str().unwrap_or("hf");
    if !matches!(provider, "hf" | "vast") {
        return Err("Unknown Compute Web provider".into());
    }
    let seconds = number(
        opt["--max-seconds"].as_str(),
        "3600",
        "--max-seconds",
        300,
        3600,
    )?;
    let budget = money(opt["--budget"].as_str(), "2", "--budget")?;
    let disk = number(opt["--disk"].as_str(), "80", "--disk", 40, 500)?;
    let hourly = money(opt["--max-hourly"].as_str(), ".85", "--max-hourly")?;
    let settings = json!({"image":built["image"],"provider":provider,"seconds":seconds,"budget":compute::money_json(budget),
        "flavor":opt["--flavor"].as_str().unwrap_or("l4x1"),"gpu":opt["--gpu"].as_str().unwrap_or("RTX 4090"),
        "disk":disk,"maxHourly":hourly,
        "countries":opt["--countries"].as_str().unwrap_or("US,CA").split(',').collect::<Vec<_>>(),
        "appPort":built["appPort"].as_u64().unwrap_or(7860)});
    let key = new_token(name)?;
    let mut all = registry()?;
    all["services"][name] = settings;
    if let Err(e) = compute::write_private_state(&config_file()?, &all) {
        let _ = fs::remove_file(token_file(name)?);
        return Err(e);
    }
    Ok(
        json!({"service":name,"url":url(name),"token":key,"provider":provider,
        "hardShutdownSeconds":seconds,"note":"Save token securely. Possession permits browser Start GPU actions up to configured budget."}),
    )
}
fn status(args: &[String]) -> Result<Value, String> {
    if args.len() > 1 {
        return Err("usage: neo compute web status [SERVICE]".into());
    }
    if let Some(name) = args.first() {
        let name = validate(name)?;
        return Ok(json!({"service":name,"config":service(name)?,
            "session":safe_status(name)?,"url":url(name)}));
    }
    let mut result = serde_json::Map::new();
    for (name, config) in registry()?["services"]
        .as_object()
        .ok_or("Invalid Web service registry")?
    {
        result.insert(
            name.clone(),
            json!({"provider":config["provider"],
            "session":safe_status(name)?["phase"],"url":url(name)}),
        );
    }
    Ok(Value::Object(result))
}
fn rotate(args: &[String]) -> Result<Value, String> {
    if args.len() != 1 {
        return Err("usage: neo compute web rotate SERVICE".into());
    }
    let name = validate(&args[0])?;
    service(name)?;
    let _lock = Lock::take(name)?;
    let path = token_file(name)?;
    let previous = existing_token(name)?;
    if previous.is_empty() {
        return Err("Existing Web token invalid".into());
    }
    let next = token()?;
    let tmp = path.with_extension(format!("rotation-{}", uuid::Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    use std::io::Write;
    let mut file = options.open(&tmp).map_err(|e| e.to_string())?;
    file.write_all(format!("{next}\n").as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(json!({"service":name,"token":next,"rotated":true}))
}
fn update(args: &[String]) -> Result<Value, String> {
    if args.len() != 1 {
        return Err("usage: neo compute web update SERVICE".into());
    }
    let name = validate(&args[0])?;
    service(name)?;
    let _lock = Lock::take(name)?;
    if safe_status(name)?["phase"] != "stopped" {
        return Err("Stop and verify Compute session before updating".into());
    }
    let built = compute::service_registry()?["services"][name].clone();
    if built["mode"] != "web" || built["published"] != true {
        return Err("Build and publish replacement Web image first".into());
    }
    let mut data = registry()?;
    let old = data["services"][name]["image"].clone();
    data["services"][name]["image"] = built["image"].clone();
    if built["appPort"].as_u64().is_some() {
        data["services"][name]["appPort"] = built["appPort"].clone();
    }
    compute::write_private_state(&config_file()?, &data)?;
    Ok(
        json!({"service":name,"previousImage":old,"image":built["image"],
        "changed":old!=built["image"],"url":url(name),"tokenPreserved":true}),
    )
}
fn remove(args: &[String]) -> Result<Value, String> {
    if args.len() != 1 {
        return Err("usage: neo compute web remove SERVICE".into());
    }
    let name = validate(&args[0])?;
    service(name)?;
    let _lock = Lock::take(name)?;
    if !matches!(
        safe_status(name)?["phase"].as_str(),
        Some("stopped" | "failed")
    ) {
        return Err("Stop and verify Compute provider before removing service".into());
    }
    let mut all = registry()?;
    all["services"]
        .as_object_mut()
        .ok_or("Invalid Web service registry")?
        .remove(name);
    compute::write_private_state(&config_file()?, &all)?;
    let _ = fs::remove_file(token_file(name)?);
    let _ = fs::remove_file(session_file(name)?);
    Ok(json!({"service":name,"phase":"removed"}))
}
fn web_token(args: &[String]) -> Result<Value, String> {
    if args.len() != 1 {
        return Err("usage: neo compute web token SERVICE".into());
    }
    let name = validate(&args[0])?;
    service(name)?;
    Ok(json!({"service":name,"token":existing_token(name)?,"url":url(name)}))
}

fn provider_rate(config: &Value) -> Result<(f64, Option<u64>), String> {
    let provider = config["provider"]
        .as_str()
        .ok_or("Web GPU provider missing")?;
    if provider == "hf" {
        let rate = compute::hf_rate(config["flavor"].as_str().unwrap_or("l4x1"))?;
        return Ok((rate, None));
    }
    if provider == "vast" {
        let candidates = compute::vast_offers(&json!({"gpu":config["gpu"],"disk":config["disk"],
            "maxHourly":config["maxHourly"],"countries":config["countries"]}))?;
        let best = candidates.first().ok_or("No suitable Vast Web GPU offer")?;
        let rate = best["dph_total"].as_f64().ok_or("Vast Web rate missing")?;
        return Ok((rate, best["id"].as_u64()));
    }
    Err("Unknown Compute Web provider".into())
}
fn start(args: &[String]) -> Result<Value, String> {
    let (names, opts) = options(args, &[], &["--allow-spend"])?;
    if names.len() != 1 {
        return Err("usage: neo compute web start SERVICE --allow-spend".into());
    }
    let name = validate(&names[0])?;
    let config = service(name)?;
    if opts["--allow-spend"] != true {
        return Err("Compute Web session requires explicit --allow-spend".into());
    }
    let _lock = Lock::take(name)?;
    let prior = safe_status(name)?;
    if !matches!(prior["phase"].as_str(), Some("stopped" | "failed")) {
        return Err("Compute Web session already active or requires reconciliation".into());
    }
    let (rate, offer) = provider_rate(&config)?;
    let seconds = config["seconds"]
        .as_u64()
        .ok_or("Web session deadline missing")?;
    let budget = config["budget"]
        .as_f64()
        .ok_or("Web spending budget missing")?;
    if rate * seconds as f64 / 3600.0
        + if config["provider"] == "hf" {
            0.25
        } else {
            1.0
        }
        > budget
    {
        return Err("Compute Web estimated cost exceeds budget; no paid session created".into());
    }
    let provider = config["provider"].as_str().ok_or("Unknown Web provider")?;
    let image = config["image"].as_str().ok_or("Missing Web image")?;
    let label = format!("neo-gpu-web-{}", compute::uid()?);
    let now = chrono::Utc::now().timestamp_millis();
    let deadline = now + seconds as i64 * 1000;
    let lease = compute::state_dir()?.join(format!("lease-{}.json", compute::uid()?));
    let mut data = json!({"provider":provider,"phase":"creating","label":label,
        "image":image,"deadline":deadline,"createdAt":chrono::Utc::now().to_rfc3339()});
    compute::write_private_state(&lease, &data)?;
    let mut session = json!({"provider":provider,"image":image,"phase":"starting",
        "startedAt":now,"deadline":deadline,"budget":budget,"rate":rate,"service":name,
        "label":label,"lease":lease});
    compute::write_private_state(&session_file(name)?, &session)?;
    // Start an independent watchdog before the provider create, and retain
    // an unreconciled lease if the provider's response is ambiguous.
    compute::watchdog_start(&lease)?;
    let resource = if provider == "hf" {
        let flavor = config["flavor"].as_str().ok_or("HF Web flavor missing")?;
        let timeout = format!("{seconds}s");
        let raw = compute::capture(
            "hf",
            &[
                "jobs",
                "run",
                "--flavor",
                flavor,
                "--timeout",
                &timeout,
                "--attempts",
                "1",
                "--expose",
                "8000",
                "--detach",
                "--format",
                "quiet",
                "--name",
                &label,
                image,
                "/bin/sh",
                "-c",
                compute::RUNTIME_EXEC,
            ],
            None,
            Duration::from_secs(55),
        );
        let id = raw.map_err(|_| "HF Web create uncertain; reconcile by persisted label")?;
        let id = id.trim();
        if id.len() != 24 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("HF Web create returned no valid Job ID; reconcile by label".into());
        }
        json!({"jobId":id})
    } else {
        if compute::vast_instances()?.iter().any(|r| {
            r["label"]
                .as_str()
                .is_some_and(|v| v.starts_with("neo-gpu-"))
        }) {
            return Err("An existing Neo Vast GPU instance must be reconciled first".into());
        }
        let chosen = offer.ok_or("No Vast Web offer")?;
        let disk = config["disk"].as_u64().ok_or("Vast Web disk unavailable")?;
        let onstart = compute::runtime_onstart(true);
        let raw = compute::capture(
            "vastai",
            &[
                "create",
                "instance",
                &chosen.to_string(),
                "--image",
                image,
                "--disk",
                &disk.to_string(),
                "--ssh",
                "--direct",
                "--onstart-cmd",
                &onstart,
                "--cancel-unavail",
                "--label",
                &label,
                "--raw",
            ],
            None,
            Duration::from_secs(55),
        )
        .map_err(|_| "Vast Web create uncertain; reconcile by persisted label")?;
        let result: Value = serde_json::from_str(&raw)
            .map_err(|_| "Invalid Vast Web create JSON; reconcile by label")?;
        json!({"instanceId":result["new_contract"].as_u64().filter(|n|*n>0)
            .ok_or("Vast Web create missing instance ID; reconcile by label")?})
    };
    for (key, value) in resource
        .as_object()
        .ok_or("Invalid Web provider resource")?
    {
        session[key] = value.clone();
        data[key] = value.clone();
    }
    data["phase"] = json!("running");
    compute::write_private_state(&lease, &data)?;
    session["phase"] = json!("running");
    compute::write_private_state(&session_file(name)?, &session)?;
    Ok(json!({"service":name,"phase":"running","deadline":deadline}))
}
fn stop(args: &[String]) -> Result<Value, String> {
    if args.len() != 1 {
        return Err("usage: neo compute web stop SERVICE".into());
    }
    let name = validate(&args[0])?;
    service(name)?;
    let _lock = Lock::take(name)?;
    let mut state = safe_status(name)?;
    if matches!(state["phase"].as_str(), Some("stopped" | "failed")) {
        return Ok(json!({"service":name,"phase":state["phase"]}));
    }
    if matches!(state["phase"].as_str(), Some("starting" | "unreconciled")) {
        return Err("Session creation uncertain; reconcile the provider label first".into());
    }
    state["phase"] = json!("stopping");
    compute::write_private_state(&session_file(name)?, &state)?;
    let path = state["lease"]
        .as_str()
        .ok_or("Active session lacks a provider lease")?;
    match compute::cleanup_lease(&["--lease".into(), path.into()]) {
        Ok(done) => {
            state["phase"] = json!("stopped");
            state["terminalStatus"] = done["terminalStatus"].clone();
            state["stoppedAt"] = json!(chrono::Utc::now().timestamp_millis());
            compute::write_private_state(&session_file(name)?, &state)?;
            Ok(json!({"service":name,"phase":"stopped","terminalStatus":done["terminalStatus"]}))
        }
        Err(error) => {
            state["phase"] = json!("cleanup_failed");
            compute::write_private_state(&session_file(name)?, &state)?;
            Err(format!(
                "Compute Web cleanup unverified; preserve lease: {error}"
            ))
        }
    }
}
pub fn run(args: &[String]) -> Result<i32, String> {
    let Some((command, rest)) = args.split_first() else {
        println!("neo compute web add|update|remove|token|rotate|status|start|stop|serve");
        return Ok(0);
    };
    let result = match command.as_str() {
        "add" => add(rest)?,
        "remove" => remove(rest)?,
        "update" => update(rest)?,
        "token" => web_token(rest)?,
        "rotate" => rotate(rest)?,
        "status" => status(rest)?,
        "start" => start(rest)?,
        "stop" => stop(rest)?,
        "serve" => return crate::compute_gateway::serve(rest),
        _ => return Err("Unknown Compute Web command".into()),
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?
    );
    Ok(0)
}
