//! Native Neo Compute control-plane. Provider calls are explicit and paid
//! work remains fail-closed without owner spend/upload consent.
use crate::process_guard;
use regex::Regex;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

pub const HELP:&str="Neo Compute — native Rust CLI\n  neo compute build [--project ROOT] [--dockerfile Dockerfile] [--name SERVICE]\n                [--builder github|local] [--image ghcr.io/OWNER/NAME:TAG]\n                [--push] [--dry-run]\n  neo compute run SERVICE [--provider hf|vast] --input NAME=PATH ...\n                --output NAME=PATH ... --allow-spend --allow-upload\n                [--budget USD] [--max-seconds 1200] [--dry-run]\n  neo compute run --image ghcr.io/OWNER/NAME:TAG [options]\n  neo compute services\n  neo compute web add|remove|token|rotate|status|start|stop|serve ...\n  neo compute doctor\n  neo compute cleanup --lease PATH\n";
fn err(s: &str) -> String {
    s.into()
}
fn rx(s: &str) -> Regex {
    Regex::new(s).expect("constant Compute syntax")
}
pub(crate) fn home() -> Result<PathBuf, String> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|v| v.is_absolute())
        .ok_or("HOME unavailable".into())
}
pub(crate) fn registry() -> Result<PathBuf, String> {
    Ok(env::var_os("NEO_GPU_REGISTRY_FILE")
        .map(PathBuf::from)
        .unwrap_or(home()?.join(".config/neo/gpu/services.json")))
}
pub(crate) fn state_dir() -> Result<PathBuf, String> {
    Ok(env::var_os("NEO_GPU_STATE_DIR")
        .map(PathBuf::from)
        .unwrap_or(home()?.join(".local/state/neo/gpu")))
}
pub(crate) fn read_json(path: &Path, default: Value) -> Result<Value, String> {
    if !path.exists() {
        return Ok(default);
    }
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 4 * 1024 * 1024 {
        return Err("Invalid or unsafe Compute state file".into());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|_| "Invalid JSON Compute state".into())
}
pub fn service_registry() -> Result<Value, String> {
    read_json(&registry()?, json!({"version":1,"services":{}}))
}
#[derive(Debug, Default)]
struct Opts {
    pos: Vec<String>,
    values: BTreeMap<String, String>,
    multi: BTreeMap<String, Vec<String>>,
    switches: BTreeSet<String>,
}
fn options(
    args: &[String],
    values: &[&str],
    multi: &[&str],
    switches: &[&str],
) -> Result<Opts, String> {
    let mut out = Opts::default();
    let mut i = 0;
    while i < args.len() {
        let key = &args[i];
        if !key.starts_with("--") {
            out.pos.push(key.clone());
            i += 1;
            continue;
        }
        if switches.contains(&key.as_str()) {
            if !out.switches.insert(key.clone()) {
                return Err(format!("Repeated option {key}"));
            }
            i += 1;
            continue;
        }
        if !values.contains(&key.as_str()) && !multi.contains(&key.as_str()) {
            return Err(format!("Unknown option {key}"));
        }
        let value = args
            .get(i + 1)
            .filter(|v| !v.is_empty() && !v.starts_with("--"))
            .ok_or_else(|| format!("Missing value for {key}"))?;
        if multi.contains(&key.as_str()) {
            out.multi
                .entry(key.clone())
                .or_default()
                .push(value.clone());
        } else if out.values.insert(key.clone(), value.clone()).is_some() {
            return Err(format!("Repeated option {key}"));
        }
        i += 2;
    }
    Ok(out)
}
impl Opts {
    fn get<'a>(&'a self, name: &str, default: &'a str) -> &'a str {
        self.values.get(name).map_or(default, String::as_str)
    }
    fn flag(&self, name: &str) -> bool {
        self.switches.contains(name)
    }
    fn mult(&self, name: &str) -> Vec<String> {
        self.multi.get(name).cloned().unwrap_or_default()
    }
}
pub(crate) fn amount(raw: &str, label: &str, max: f64) -> Result<f64, String> {
    let n = raw
        .parse::<f64>()
        .map_err(|_| format!("{label} must be a positive number"))?;
    if !n.is_finite() || n <= 0. || n > max {
        return Err(format!("{label} must be >0 and <={max}"));
    }
    Ok(n)
}
pub(crate) fn number(raw: &str, label: &str, min: u64, max: u64) -> Result<u64, String> {
    let n = raw
        .parse::<u64>()
        .map_err(|_| format!("{label} must be an integer in [{min}, {max}]"))?;
    if n < min || n > max {
        return Err(format!("{label} must be an integer in [{min}, {max}]"));
    }
    Ok(n)
}
pub(crate) fn money_json(amount: f64) -> Value {
    if amount.fract() == 0.0 {
        json!(amount as u64)
    } else {
        json!(amount)
    }
}
fn versioned_image(s: &str) -> bool {
    rx(r"^ghcr\.io/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+$").is_match(s)
}
fn absolute(raw: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw);
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        env::current_dir().map_err(|e| e.to_string())?.join(path)
    };
    Ok(path)
}
fn parse_bindings(raw: &[String], input: bool) -> Result<Vec<Value>, String> {
    let mut seen = BTreeSet::<String>::new();
    let mut rows = Vec::new();
    for binding in raw {
        let (name, file) = binding.split_once('=').unwrap_or_else(|| {
            (
                Path::new(binding)
                    .file_name()
                    .and_then(|v| v.to_str())
                    .unwrap_or(""),
                binding.as_str(),
            )
        });
        if !rx(r"^[A-Za-z][A-Za-z0-9_-]{0,63}(?:\.[A-Za-z0-9]{1,10})?$").is_match(name) {
            return Err(format!(
                "Invalid {} name {name}",
                if input { "input" } else { "output" }
            ));
        }
        if !seen.insert(name.to_string()) {
            return Err("Duplicate input or output name".into());
        }
        let path = absolute(file)?;
        if input {
            let meta =
                fs::symlink_metadata(&path).map_err(|_| "Input must be a 1..64MiB local file")?;
            if !meta.is_file()
                || meta.file_type().is_symlink()
                || meta.len() == 0
                || meta.len() > 64 * 1024 * 1024
            {
                return Err("Input must be a 1..64MiB local file".into());
            }
        } else {
            if !path.parent().is_some_and(Path::is_dir) {
                return Err("Output directory missing".into());
            }
            if path.exists() {
                return Err("Refusing to overwrite output".into());
            }
        }
        rows.push(json!({"name":name,"file":path}));
    }
    Ok(rows)
}
pub fn plan_run(args: &[String]) -> Result<Value, String> {
    let opt = options(
        args,
        &[
            "--image",
            "--provider",
            "--flavor",
            "--budget",
            "--max-seconds",
            "--gpu",
            "--disk",
            "--max-hourly",
            "--countries",
            "--ssh-key",
        ],
        &["--input", "--output"],
        &["--allow-spend", "--allow-upload", "--dry-run"],
    )?;
    if opt.pos.len() > 1 {
        return Err("Provide at most one service name".into());
    }
    let service = opt.pos.first().cloned();
    let registry = service_registry()?;
    let saved = service
        .as_ref()
        .and_then(|name| registry["services"].get(name));
    if service.is_some() && saved.is_none() {
        return Err(format!(
            "Unknown Compute service {}; run neo compute build first",
            service.unwrap_or_default()
        ));
    }
    let image = opt
        .values
        .get("--image")
        .cloned()
        .or_else(|| saved.and_then(|v| v["image"].as_str().map(str::to_string)))
        .ok_or("A versioned GHCR image is required")?;
    if !versioned_image(&image) {
        return Err("A versioned GHCR image is required".into());
    }
    let provider = opt.get("--provider", "hf");
    if !matches!(provider, "hf" | "vast") {
        return Err("Provider must be hf or vast".into());
    }
    let inputs = parse_bindings(&opt.mult("--input"), true)?;
    let outputs = parse_bindings(&opt.mult("--output"), false)?;
    if outputs.is_empty() {
        return Err("At least one --output NAME=PATH is required".into());
    }
    let seconds = number(opt.get("--max-seconds", "1200"), "--max-seconds", 180, 1800)?;
    let budget = amount(opt.get("--budget", "2"), "--budget", 5.)?;
    let disk = number(opt.get("--disk", "80"), "--disk", 40, 500)?;
    let hourly = amount(opt.get("--max-hourly", ".85"), "--max-hourly", 5.)?;
    let mut plan = json!({"image":image,"service":service,"provider":provider,"inputs":inputs,"outputs":outputs,
        "maxSeconds":seconds,"budget":money_json(budget),"flavor":opt.get("--flavor","l4x1"),
        "gpu":opt.get("--gpu","RTX 4090"),"disk":disk,"maxHourly":money_json(hourly),
        "countries":opt.get("--countries","US,CA").split(',').collect::<Vec<_>>(),
        "sshKey":opt.values.get("--ssh-key"),"dryRun":opt.flag("--dry-run"),
        "allowSpend":opt.flag("--allow-spend"),"allowUpload":opt.flag("--allow-upload")});
    if service.is_none() {
        plan.as_object_mut().unwrap().remove("service");
    }
    if !opt.values.contains_key("--ssh-key") {
        plan.as_object_mut().unwrap().remove("sshKey");
    }
    Ok(plan)
}
// `doctor` is a strict read-only capability inventory. Invoking `--version`
// on external GPU CLIs can create provider caches, Python bytecode, and HOME
// state, so inspect the executable bit without spawning any third-party code.
fn tool_ok(command: &str) -> bool {
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    if command.is_empty() {
        return false;
    }
    let executable = |path: &Path| {
        fs::metadata(path).is_ok_and(|meta| {
            meta.is_file() && {
                #[cfg(unix)]
                {
                    meta.permissions().mode() & 0o111 != 0
                }
                #[cfg(not(unix))]
                {
                    true
                }
            }
        })
    };
    if command.contains('/') {
        return Path::new(command).is_absolute() && executable(Path::new(command));
    }
    env::var_os("PATH")
        .map(|paths| {
            env::split_paths(&paths).any(|dir| dir.is_absolute() && executable(&dir.join(command)))
        })
        .unwrap_or(false)
}
pub fn doctor() -> Result<Value, String> {
    Ok(
        json!({"native":"rust","localContainerRuntime":tool_ok(&env::var("NEO_GPU_CONTAINER_ENGINE")
        .unwrap_or_else(|_|"docker".into())),"hfCli":tool_ok("hf"),"vastCli":tool_ok("vastai"),
        "githubCli":tool_ok("gh"),"serviceCount":service_registry()?["services"].as_object().map_or(0,|v|v.len())}),
    )
}
fn output(data: &Value) {
    println!("{}", serde_json::to_string_pretty(data).unwrap_or_default());
}
pub fn run(args: &[String]) -> Result<i32, String> {
    match args.split_first() {
        None => {
            print!("{HELP}");
            Ok(0)
        }
        Some((command, _))
            if matches!(command.as_str(), "help" | "--help" | "-h") && args.len() == 1 =>
        {
            print!("{HELP}");
            Ok(0)
        }
        Some((command, rest)) => match command.as_str() {
            "services" if rest.is_empty() => {
                output(&service_registry()?);
                Ok(0)
            }
            "doctor" if rest.is_empty() => {
                output(&doctor()?);
                Ok(0)
            }
            "run" => {
                let plan = plan_run(rest)?;
                if plan["dryRun"] == true {
                    let mut result = plan;
                    result["mode"] = json!("dry_run");
                    output(&result);
                    return Ok(0);
                }
                if plan["allowSpend"] != true {
                    return Err(err("Paid GPU rental requires --allow-spend"));
                }
                if plan["inputs"].as_array().is_some_and(|a| !a.is_empty())
                    && plan["allowUpload"] != true
                {
                    return Err(err("Private inputs require --allow-upload"));
                }
                match plan["provider"].as_str() {
                    Some("hf") => {
                        output(&run_hf(&plan)?);
                        Ok(0)
                    }
                    Some("vast") => {
                        output(&run_vast(&plan)?);
                        Ok(0)
                    }
                    _ => Err(err("Unknown Compute rental provider")),
                }
            }
            "build" => {
                let plan = image_plan(rest)?;
                if plan["dryRun"] == true {
                    // Preserve build mode batch/web and omit internal
                    // safety gates from the public Node-compatible plan.
                    let mut shown = plan.clone();
                    shown.as_object_mut().unwrap().remove("dryRun");
                    shown.as_object_mut().unwrap().remove("pushAuthorized");
                    output(&shown);
                    return Ok(0);
                }
                native_build(&plan)?;
                output(
                    &json!({"event":"neo_gpu_service_built","service":plan["name"],
                    "image":plan["image"],"published":plan["push"]}),
                );
                Ok(0)
            }
            "web" => crate::compute_web::run(rest),
            "cleanup" => {
                output(&cleanup_lease(rest)?);
                Ok(0)
            }
            _ => Err(format!("Unknown neo compute command: {command}")),
        },
    }
}

pub(crate) fn capture(
    exe: &str,
    args: &[&str],
    cwd: Option<&Path>,
    timeout: Duration,
) -> Result<String, String> {
    let mut cmd = Command::new(exe);
    cmd.args(args);
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    let result = process_guard::capture(&mut cmd, timeout, 6 * 1024 * 1024)?;
    if !result.status.success() {
        return Err(format!(
            "Compute dependency `{exe} {}` failed ({})",
            args.first().copied().unwrap_or(""),
            result.status.code().unwrap_or(-1)
        ));
    }
    String::from_utf8(result.stdout).map_err(|_| "Non-UTF8 dependency output".into())
}
fn git(project: &Path, args: &[&str]) -> Result<String, String> {
    let p = project.to_str().ok_or("Non-UTF8 project path")?;
    let mut sub = vec!["-C", p];
    sub.extend(args);
    capture("git", &sub, None, Duration::from_secs(15)).map(|s| s.trim().to_string())
}
fn slug(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();
    let lower = rx("[^a-z0-9-]+").replace_all(&lower, "-");
    let slug = lower.trim_matches('-');
    if slug.is_empty() {
        "app".into()
    } else {
        slug.into()
    }
}
fn hex_key(parts: &[&[u8]]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
    }
    let hash = hasher.finalize();
    hash.iter().map(|b| format!("{b:02x}")).collect::<String>()[..12].into()
}
fn root() -> Result<PathBuf, String> {
    crate::workspace::harness_root()
}
pub fn image_plan(args: &[String]) -> Result<Value, String> {
    let opt = options(
        args,
        &[
            "--project",
            "--dockerfile",
            "--name",
            "--image",
            "--builder",
            "--mode",
            "--port",
        ],
        &[],
        &["--push", "--no-push", "--dry-run"],
    )?;
    if !opt.pos.is_empty() {
        return Err(
            "usage: neo compute build [--project ROOT] [--dockerfile PATH] [--push]".into(),
        );
    }
    if opt.flag("--push") && opt.flag("--no-push") {
        return Err("--push and --no-push conflict".into());
    }
    let project = absolute(opt.get("--project", "."))?
        .canonicalize()
        .map_err(|_| "Compute Project unavailable")?;
    if !project.is_dir()
        || git(&project, &["rev-parse", "--show-toplevel"])? != project.to_string_lossy()
    {
        return Err("--project must be the Git repository root".into());
    }
    let dockerfile = project
        .join(opt.get("--dockerfile", "Dockerfile"))
        .canonicalize()
        .map_err(|_| "Dockerfile unavailable")?;
    if !dockerfile.starts_with(&project) || !dockerfile.is_file() {
        return Err("Dockerfile must reside in the project repo".into());
    }
    let relative = dockerfile
        .strip_prefix(&project)
        .map_err(|e| e.to_string())?
        .to_str()
        .ok_or("Invalid Dockerfile path")?;
    let commit = git(&project, &["rev-parse", "HEAD"])?;
    if !rx("^[a-fA-F0-9]{40}$").is_match(&commit) {
        return Err("Git HEAD is not a valid commit".into());
    }
    let remote = git(&project, &["remote", "get-url", "origin"])?;
    let refs = rx(
        r"^(?:git@github\.com:|https://github\.com/)([a-zA-Z0-9_.-]+)/([a-zA-Z0-9_.-]+?)(?:\.git)?$",
    );
    let caps = refs
        .captures(&remote)
        .ok_or("GitHub build requires a GitHub origin remote")?;
    let owner = &caps[1];
    let repo = &caps[2];
    let name = opt
        .values
        .get("--name")
        .cloned()
        .unwrap_or_else(|| slug(repo));
    if !rx(r"^[a-z][a-z0-9-]{0,63}$").is_match(&name) {
        return Err("Invalid service name".into());
    }
    let mode = opt.get("--mode", "batch");
    if !matches!(mode, "batch" | "web") {
        return Err("Compute build mode must be batch or web".into());
    }
    let port = number(opt.get("--port", "7860"), "--port", 1, 65535)?;
    if port == 8000 {
        return Err("Web app port conflicts with internal service".into());
    }
    let runtime = root()?.join("gpu/runtime");
    let mut hasher = Sha256::new();
    for filename in ["service.mjs", "web.mjs", "launcher.mjs", "Dockerfile.wrap"] {
        hasher.update(
            fs::read(runtime.join(filename))
                .map_err(|_| "Compute wrapper runtime asset missing")?,
        );
    }
    let runtime_hash = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let docker = fs::read(&dockerfile).map_err(|e| e.to_string())?;
    let version = hex_key(&[
        commit.as_bytes(),
        &docker,
        runtime_hash.as_bytes(),
        mode.as_bytes(),
        port.to_string().as_bytes(),
        name.as_bytes(),
    ]);
    let image = opt.values.get("--image").cloned().unwrap_or_else(|| {
        format!(
            "ghcr.io/{}/{}-gpu:sha-{version}",
            owner.to_ascii_lowercase(),
            slug(repo)
        )
    });
    if !versioned_image(&image) {
        return Err("Expected an explicit versioned ghcr.io image reference".into());
    }
    let builder = opt.get("--builder", "github");
    if !matches!(builder, "github" | "local") {
        return Err("--builder must be github or local".into());
    }
    if builder == "github" && !opt.flag("--dry-run") {
        if !git(&project, &["status", "--porcelain", "--untracked-files=no"])?.is_empty() {
            return Err("Commit tracked source changes before hosted GitHub builds".into());
        }
        if git(&project, &["ls-tree", "HEAD", "--", relative])?.is_empty() {
            return Err("Dockerfile must be tracked in pushed Git commit".into());
        }
        if git(&project, &["rev-parse", "@{u}"])? != commit {
            return Err("Push the source commit before hosted GitHub builds".into());
        }
    }
    Ok(
        json!({"name":name,"image":image,"project":project,"repository":format!("{owner}/{repo}"),
        "commit":commit,"dockerfile":relative,"builder":builder,"push":!opt.flag("--no-push"),
        "mode":mode,"appPort":port,"runtimeHash":runtime_hash,"buildId":Value::Null,"dryRun":opt.flag("--dry-run"),
        "pushAuthorized":opt.flag("--push")}),
    )
}
pub(crate) fn write_private_state(path: &Path, value: &Value) -> Result<(), String> {
    #[cfg(unix)]
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let parent = path.parent().ok_or("Invalid Compute state path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    if let Ok(meta) = fs::symlink_metadata(path) {
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err("Unsafe Compute state target".into());
        }
    }
    let temp = parent.join(format!(".neo-compute-{}.tmp", uuid::Uuid::new_v4()));
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    opts.mode(0o600);
    let mut file = opts.open(&temp).map_err(|e| e.to_string())?;
    use std::io::Write;
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    if let Err(e) = file
        .write_all(&bytes)
        .and_then(|_| file.sync_all())
        .and_then(|_| fs::rename(&temp, path))
    {
        let _ = fs::remove_file(temp);
        return Err(e.to_string());
    }
    Ok(())
}
fn native_build(plan: &Value) -> Result<(), String> {
    // Creating a local image is an explicit build action. Publishing a
    // registry image or dispatching GitHub Actions additionally requires an
    // explicit --push flag; --no-push is the safe local-only alternative.
    if plan["push"] == true && plan["pushAuthorized"] != true {
        return Err(
            "Publishing Compute image requires explicit --push; use --no-push for local-only build"
                .into(),
        );
    }
    let builder = plan["builder"].as_str().unwrap_or("");
    if builder == "github" {
        return build_github(plan);
    }
    if builder != "local" {
        return Err("Unknown Compute image builder".into());
    }
    let engine = env::var("NEO_GPU_CONTAINER_ENGINE").unwrap_or_else(|_| "docker".into());
    let project = Path::new(plan["project"].as_str().ok_or("Invalid Compute project")?);
    let dockerfile = project.join(plan["dockerfile"].as_str().ok_or("Invalid Dockerfile")?);
    let image = plan["image"].as_str().ok_or("Missing image tag")?;
    let base = format!(
        "neo-compute-base:{}",
        image.split(':').next_back().unwrap_or("unknown")
    );
    let cmd = [
        "build",
        "--pull",
        "-f",
        dockerfile.to_str().ok_or("Non-UTF8 Dockerfile")?,
        "-t",
        &base,
        project.to_str().ok_or("Non-UTF8 Project")?,
    ];
    capture(&engine, &cmd, Some(project), Duration::from_secs(90 * 60))?;
    let inspected = capture(
        &engine,
        &["image", "inspect", &base],
        None,
        Duration::from_secs(20),
    )?;
    let docs: Value =
        serde_json::from_str(&inspected).map_err(|_| "Invalid Docker image inspection JSON")?;
    let config = &docs[0]["Config"];
    let command = config["Entrypoint"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(config["Cmd"].as_array().into_iter().flatten())
        .map(|v| {
            v.as_str()
                .map(str::to_string)
                .ok_or("Docker image command must consist of strings")
        })
        .collect::<Result<Vec<_>, _>>()?;
    if command.is_empty() {
        return Err("Project Dockerfile needs executable CMD or ENTRYPOINT".into());
    }
    let runtime = root()?.join("gpu/runtime");
    let wrap = runtime.join("Dockerfile.wrap");
    let runtime_arg = format!("neo-runtime={}", runtime.display());
    let base_arg = format!("NEO_BASE_IMAGE={base}");
    let command_arg = format!(
        "NEO_GPU_CMD_JSON={}",
        serde_json::to_string(&command).map_err(|e| e.to_string())?
    );
    let mode_arg = format!("NEO_GPU_MODE={}", plan["mode"].as_str().unwrap_or("batch"));
    let port_arg = format!("NEO_GPU_APP_PORT={}", plan["appPort"]);
    let name_arg = format!(
        "NEO_GPU_SERVICE_NAME={}",
        plan["name"].as_str().unwrap_or("")
    );
    capture(
        &engine,
        &[
            "build",
            "-f",
            wrap.to_str().ok_or("Non-UTF8 runtime wrapper")?,
            "--build-context",
            &runtime_arg,
            "--build-arg",
            &base_arg,
            "--build-arg",
            &command_arg,
            "--build-arg",
            &mode_arg,
            "--build-arg",
            &port_arg,
            "--build-arg",
            &name_arg,
            "-t",
            image,
            project.to_str().ok_or("Non-UTF8 Project")?,
        ],
        Some(project),
        Duration::from_secs(90 * 60),
    )?;
    if plan["push"] == true {
        capture(
            &engine,
            &["push", image],
            None,
            Duration::from_secs(25 * 60),
        )?;
    }
    let mut manifest = service_registry()?;
    let name = plan["name"].as_str().ok_or("Invalid service name")?;
    manifest["services"][name] = json!({"image":image,"repository":plan["repository"],"project":plan["project"],
        "sourceCommit":plan["commit"],"createdAt":chrono::Utc::now().to_rfc3339(),"published":plan["push"],
        "mode":plan["mode"],"appPort":plan["appPort"]});
    write_private_state(&registry()?, &manifest)
}

/// Existing paid-provider leases are authoritative; a missing or ambiguous
/// provider ID cannot be guessed, and cleanup is never performed implicitly.
fn validate_lease(raw: &str) -> Result<PathBuf, String> {
    let file = absolute(raw)?;
    let root = state_dir()?;
    if file.parent() != Some(root.as_path())
        || !file
            .file_name()
            .and_then(|v| v.to_str())
            .is_some_and(|s| rx(r"^lease-[a-f0-9]{18}\.json$").is_match(s))
    {
        return Err("Invalid GPU lease path".into());
    }
    Ok(file)
}
fn hf_status(job: &str) -> Result<String, String> {
    let status = capture(
        "hf",
        &["jobs", "inspect", job, "--json"],
        None,
        Duration::from_secs(25),
    )?;
    let row: Value = serde_json::from_str(&status).map_err(|_| "Invalid HF status JSON")?;
    let row = if row.is_array() { &row[0] } else { &row };
    Ok(row["status"]["stage"]
        .as_str()
        .or_else(|| row["status"].as_str())
        .unwrap_or("")
        .into())
}
pub(crate) fn hf_cancel(job: &str) -> Result<String, String> {
    if !rx(r"^[a-f0-9]{24}$").is_match(job) {
        return Err("Invalid HF Job ID".into());
    }
    let _ = capture(
        "hf",
        &["jobs", "cancel", job],
        None,
        Duration::from_secs(25),
    );
    for attempt in 0..8 {
        if let Ok(status) = hf_status(job) {
            if matches!(
                status.as_str(),
                "CANCELED" | "COMPLETED" | "FAILED" | "ERROR" | "TIMED_OUT"
            ) {
                return Ok(status);
            }
        }
        if attempt != 7 {
            std::thread::sleep(Duration::from_secs(2));
        }
    }
    Err(format!("HF Job cancellation not verified: {job}"))
}
fn hf_reconcile_label(label: &str) -> Result<String, String> {
    if !rx(r"^neo-gpu-[a-z0-9-]{8,90}$").is_match(label) {
        return Err("Unsafe HF reconciliation label".into());
    }
    // Only the exact provider-owned label is eligible. A pending create
    // may have returned an ambiguous error AFTER acceptance, so the
    // authoritative HF job listing must be checked before claiming cleanup.
    let rows = capture(
        "hf",
        &["jobs", "ls", "--name", label, "--json"],
        None,
        Duration::from_secs(25),
    )?;
    let value: Value =
        serde_json::from_str(&rows).map_err(|_| "Invalid HF reconciliation job list JSON")?;
    let values = value
        .as_array()
        .ok_or("Invalid HF reconciliation job list")?;
    let mut canceled = 0usize;
    for row in values {
        if row["name"].as_str() != Some(label) {
            continue;
        }
        let id = row["id"]
            .as_str()
            .filter(|v| rx(r"^[a-f0-9]{24}$").is_match(v))
            .ok_or("Invalid HF Job ID in exact-label reconciliation")?;
        let status = row["status"]["stage"]
            .as_str()
            .or_else(|| row["status"].as_str())
            .ok_or("Missing HF reconciliation Job status")?;
        if matches!(status, "SCHEDULING" | "RUNNING") {
            hf_cancel(id)?;
            canceled += 1;
        } else if !matches!(
            status,
            "CANCELED" | "COMPLETED" | "FAILED" | "ERROR" | "TIMED_OUT"
        ) {
            return Err("Unknown HF reconciliation Job state; retry later".into());
        }
    }
    Ok(if canceled > 0 {
        "reconciled_canceled"
    } else {
        "reconciled_no_active_jobs"
    }
    .into())
}
pub(crate) fn hf_cleanup(lease: &Value) -> Result<String, String> {
    if let Some(id) = lease["jobId"].as_str() {
        return hf_cancel(id);
    }
    let label = lease["label"]
        .as_str()
        .ok_or("HF lease lacks Job ID or reconciliation label")?;
    hf_reconcile_label(label)
}
pub(crate) fn vast_instances() -> Result<Vec<Value>, String> {
    let text = capture(
        "vastai",
        &["show", "instances", "--raw"],
        None,
        Duration::from_secs(45),
    )?;
    let rows: Value = serde_json::from_str(&text).map_err(|_| "Invalid Vast instance list JSON")?;
    rows.as_array()
        .cloned()
        .ok_or_else(|| "Invalid Vast instance list".into())
}
fn vast_destroy(id: u64) -> Result<(), String> {
    if id == 0 {
        return Err("Invalid Vast instance ID".into());
    }
    let id = id.to_string();
    let _ = capture(
        "vastai",
        &["destroy", "instance", &id, "-y"],
        None,
        Duration::from_secs(55),
    );
    if vast_instances()?
        .iter()
        .any(|row| row["id"].as_u64().is_some_and(|v| v.to_string() == id))
    {
        return Err(format!("Vast.ai destroy not verified: {id}"));
    }
    Ok(())
}
pub(crate) fn cleanup_vast(lease: &Value) -> Result<String, String> {
    if let Some(id) = lease["instanceId"].as_u64() {
        vast_destroy(id)?;
        return Ok("destroyed".into());
    }
    let label = lease["label"]
        .as_str()
        .filter(|s| s.starts_with("neo-gpu-") && s.len() <= 100)
        .ok_or("Vast lease missing instance identifier/label")?;
    let targets = vast_instances()?
        .into_iter()
        .filter(|row| row["label"].as_str() == Some(label))
        .collect::<Vec<_>>();
    if targets.is_empty() {
        return Err("Vast creation unconfirmed; keep lease for later reconciliation".into());
    }
    for row in targets {
        vast_destroy(row["id"].as_u64().ok_or("Invalid Vast instance ID")?)?;
    }
    Ok("destroyed".into())
}
pub fn cleanup_lease(args: &[String]) -> Result<Value, String> {
    let opts = options(args, &["--lease"], &[], &[])?;
    if !opts.pos.is_empty() || opts.values.len() != 1 {
        return Err("usage: neo compute cleanup --lease ABSOLUTE_PATH".into());
    }
    let raw = opts.values.get("--lease").ok_or("--lease is required")?;
    if !Path::new(raw).is_absolute() {
        return Err("Compute lease path must be absolute".into());
    }
    let path = validate_lease(raw)?;
    let mut lease = read_json(&path, Value::Null)?;
    if lease.is_null() {
        return Err("GPU lease does not exist".into());
    }
    if lease["phase"] == "destroyed" {
        return Ok(json!({"phase":"destroyed","already":true}));
    }
    let status = match lease["provider"].as_str() {
        Some("hf") => hf_cleanup(&lease)?,
        Some("vast") => cleanup_vast(&lease)?,
        _ => return Err("Unsupported GPU lease provider".into()),
    };
    lease["phase"] = json!("destroyed");
    lease["terminalStatus"] = json!(status);
    write_private_state(&path, &lease)?;
    Ok(json!({"phase":"destroyed","terminalStatus":status}))
}

pub(crate) fn uid() -> Result<String, String> {
    let mut bytes = [0u8; 9];
    getrandom::fill(&mut bytes).map_err(|_| "Compute random ID unavailable")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn lease_new(provider: &str, plan: &Value) -> Result<(PathBuf, Value), String> {
    let id = uid()?;
    let path = state_dir()?.join(format!("lease-{id}.json"));
    if path.exists() {
        return Err("Compute lease ID collision".into());
    }
    let timeout = plan["maxSeconds"]
        .as_u64()
        .ok_or("Missing Compute runtime deadline")?;
    let data = json!({"provider":provider,"phase":"creating","image":plan["image"],
        "deadline":chrono::Utc::now().timestamp_millis()+timeout as i64*1000,
        "createdAt":chrono::Utc::now().to_rfc3339()});
    write_private_state(&path, &data)?;
    Ok((path, data))
}
pub(crate) fn hf_rate(flavor: &str) -> Result<f64, String> {
    if !rx("^[A-Za-z0-9_-]{2,32}$").is_match(flavor) {
        return Err("Invalid HF GPU flavor".into());
    }
    let text = capture(
        "hf",
        &["jobs", "hardware", "--json"],
        None,
        Duration::from_secs(25),
    )?;
    let rows: Value = serde_json::from_str(&text).map_err(|_| "Invalid HF hardware rate JSON")?;
    let row = rows
        .as_array()
        .and_then(|rows| rows.iter().find(|v| v["name"].as_str() == Some(flavor)))
        .ok_or_else(|| format!("HF GPU flavor unavailable: {flavor}"))?;
    let rate = row["cost/hour"]
        .as_f64()
        .or_else(|| {
            row["cost/hour"]
                .as_str()
                .and_then(|s| s.trim_start_matches('$').parse::<f64>().ok())
        })
        .ok_or("Invalid HF hourly rate")?;
    if !rate.is_finite() || rate <= 0. {
        return Err("Invalid HF hourly rate".into());
    }
    Ok(rate)
}
fn run_hf(plan: &Value) -> Result<Value, String> {
    let image = plan["image"].as_str().ok_or("Compute image missing")?;
    let flavor = plan["flavor"].as_str().ok_or("HF flavor missing")?;
    let seconds = plan["maxSeconds"]
        .as_u64()
        .ok_or("Compute timeout missing")?;
    let budget = plan["budget"].as_f64().ok_or("Compute budget missing")?;
    let rate = hf_rate(flavor)?;
    if rate * seconds as f64 / 3600.0 + 0.25 > budget {
        return Err("HF estimated cost exceeds budget; no Job created".into());
    }
    let (lease, mut data) = lease_new("hf", plan)?;
    let mut job_id: Option<String> = None;

    let result = (|| {
        let label = format!("neo-gpu-{}", uid()?);
        // Persist the exact provider label *before* the create call: a CLI
        // can time out after the rental is accepted. Reconciliation must
        // never depend on an ID that may not have been printed.
        data["label"] = json!(label);
        write_private_state(&lease, &data)?;
        // A separate watchdog protects against CLI crashes after a provider
        // accepts a paid request but before returning its Job ID.
        watchdog_start(&lease)?;
        let timeout = format!("{seconds}s");
        let create = capture(
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
                "/opt/neo-gpu/node",
                "/opt/neo-gpu/launcher.mjs",
            ],
            None,
            Duration::from_secs(50),
        );
        let id = match create {
            Ok(text) => text.trim().to_string(),
            Err(_) => {
                // A provider CLI can fail after accepting the request. Treat
                // ambiguous create as unreconciled unless billing/auth tells
                // us definitively it could not accept it.
                return Err(
                    "HF Job create response failed; reconcile by label before retry".into(),
                );
            }
        };
        if !rx(r"^[a-f0-9]{24}$").is_match(&id) {
            return Err("HF create response missing Job ID; reconcile by label".into());
        }
        job_id = Some(id.clone());
        data["phase"] = json!("running");
        data["jobId"] = json!(id);
        data["label"] = json!(label);
        write_private_state(&lease, &data)?;
        let endpoint = crate::compute_transport::Endpoint::hf(&id)?;
        let deadline = std::time::Instant::now() + Duration::from_secs(seconds);
        let inputs = plan["inputs"].as_array().ok_or("Invalid Compute inputs")?;
        let outputs = plan["outputs"]
            .as_array()
            .ok_or("Invalid Compute outputs")?;
        let files = crate::compute_transport::run_service(&endpoint, inputs, outputs, deadline)?;
        Ok(
            json!({"event":"NEO_GPU_RUN_PASS","provider":"hf","jobId":id,"outputs":files,"lease":lease}),
        )
    })();
    let cleaned = if let Some(id) = job_id {
        match hf_cancel(&id) {
            Ok(status) => {
                data["phase"] = json!("destroyed");
                data["terminalStatus"] = json!(status);
                write_private_state(&lease, &data).map(|_| status)
            }
            Err(e) => {
                data["phase"] = json!("cleanup_failed");
                let _ = write_private_state(&lease, &data);
                Err(e)
            }
        }
    } else {
        data["phase"] = json!("unreconciled_create");
        // Preserve actual provider label for manual reconciliation.
        write_private_state(&lease, &data).map(|_| String::new())
    };
    match (result, cleaned) {
        (Ok(value), Ok(_)) => Ok(value),
        (Err(error), Ok(_)) => Err(error),
        (_, Err(error)) => Err(format!(
            "Compute provider cleanup could not be confirmed: {error}; lease preserved"
        )),
    }
}

pub(crate) fn vast_offers(plan: &Value) -> Result<Vec<Value>, String> {
    let gpu = plan["gpu"].as_str().ok_or("Vast GPU selection missing")?;
    if !rx(r"^[a-zA-Z0-9_ -]{2,64}$").is_match(gpu) {
        return Err("Invalid Vast GPU model".into());
    }
    let filter = format!(
        "gpu_name={} num_gpus=1 rentable=true",
        gpu.replace(' ', "_")
    );
    let text = capture(
        "vastai",
        &["search", "offers", &filter, "--raw"],
        None,
        Duration::from_secs(45),
    )?;
    let offers: Value = serde_json::from_str(&text).map_err(|_| "Invalid Vast offers response")?;
    let offers = offers.as_array().ok_or("Invalid Vast offers response")?;
    let max = plan["maxHourly"]
        .as_f64()
        .ok_or("Vast hourly rate limit missing")?;
    let disk = plan["disk"]
        .as_u64()
        .ok_or("Vast disk requirement missing")?;
    let countries = plan["countries"]
        .as_array()
        .ok_or("Vast countries list missing")?;
    let mut selected = offers
        .iter()
        .filter(|offer| {
            let cost = offer["dph_total"].as_f64().unwrap_or(f64::INFINITY);
            offer["gpu_name"].as_str() == Some(gpu)
                && offer["num_gpus"].as_u64() == Some(1)
                && offer["rentable"] == true
                && offer["verification"] == "verified"
                && offer["reliability2"].as_f64().is_some_and(|n| n >= 0.98)
                && offer["gpu_ram"].as_f64().is_some_and(|n| n >= 20000.0)
                && offer["cpu_ram"].as_f64().is_some_and(|n| n >= 32000.0)
                && offer["disk_space"]
                    .as_f64()
                    .is_some_and(|n| n >= disk as f64)
                && cost.is_finite()
                && cost > 0.0
                && cost <= max
                && offer["driver_version"]
                    .as_str()
                    .and_then(|s| s.split('.').next())
                    .and_then(|v| v.parse::<u64>().ok())
                    .is_some_and(|n| n >= 560)
                && (countries.is_empty()
                    || countries.iter().any(|c| {
                        c.as_str()
                            == offer["geolocation"]
                                .as_str()
                                .and_then(|s| s.split(',').next_back())
                                .map(str::trim)
                    }))
        })
        .cloned()
        .collect::<Vec<_>>();
    selected.sort_by(|a, b| {
        a["dph_total"]
            .as_f64()
            .unwrap_or(f64::INFINITY)
            .total_cmp(&b["dph_total"].as_f64().unwrap_or(f64::INFINITY))
    });
    Ok(selected)
}
#[cfg(unix)]
pub(crate) fn watchdog_start(path: &Path) -> Result<(), String> {
    use std::os::unix::process::CommandExt;
    use std::process::Stdio;
    let exe = env::current_exe().map_err(|e| e.to_string())?;
    let mut command = Command::new(exe);
    command
        .arg("__compute-watchdog")
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0);
    command
        .spawn()
        .map_err(|_| "Cannot spawn independent Vast cost watchdog")?;
    Ok(())
}
#[cfg(not(unix))]
fn watchdog_start(_path: &Path) -> Result<(), String> {
    Err("Vast rental requires a supported watchdog host".into())
}
fn vast_ssh_url(instance: u64, deadline: std::time::Instant) -> Result<url::Url, String> {
    while std::time::Instant::now() < deadline {
        let raw = capture(
            "vastai",
            &["ssh-url", &instance.to_string()],
            None,
            Duration::from_secs(15),
        );
        if let Ok(text) = raw {
            if let Ok(parsed) = url::Url::parse(text.trim()) {
                let username = parsed.username();
                if parsed.scheme() == "ssh"
                    && parsed.host_str().is_some()
                    && parsed.port().is_some_and(|p| p > 0)
                    && (username.is_empty() || rx(r"^[A-Za-z0-9_.-]+$").is_match(username))
                {
                    return Ok(parsed);
                }
            }
        }
        std::thread::sleep(Duration::from_secs(3));
    }
    Err("Vast SSH destination unavailable".into())
}
pub(crate) struct Tunnel {
    child: std::process::Child,
    pub(crate) port: u16,
}
impl Drop for Tunnel {
    fn drop(&mut self) {
        #[cfg(unix)]
        unsafe {
            libc::kill(-(self.child.id() as i32), libc::SIGTERM);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
pub(crate) fn vast_tunnel(
    instance: u64,
    key: &Path,
    deadline: std::time::Instant,
) -> Result<Tunnel, String> {
    use std::net::TcpListener;
    #[cfg(unix)]
    use std::os::unix::process::CommandExt;
    use std::process::Stdio;
    if !key.is_file() {
        return Err("Vast SSH private key not found".into());
    }
    let url = vast_ssh_url(instance, deadline)?;
    let host = url.host_str().ok_or("Missing Vast SSH hostname")?;
    let port = url.port().ok_or("Missing Vast SSH port")?;
    let user = if url.username().is_empty() {
        "root"
    } else {
        url.username()
    };
    if !rx(r"^[A-Za-z0-9_.-]+$").is_match(host) {
        return Err("Unsafe Vast SSH hostname".into());
    }
    for _ in 0..35 {
        if std::time::Instant::now() >= deadline {
            break;
        }
        let reserved =
            TcpListener::bind("127.0.0.1:0").map_err(|_| "Cannot reserve loopback tunnel port")?;
        let local = reserved.local_addr().map_err(|e| e.to_string())?.port();
        drop(reserved);
        let alias = format!("vast-{instance}");
        let mapping = format!("127.0.0.1:{local}:127.0.0.1:8000");
        let destination = format!("{user}@{host}");
        let mut command = Command::new("ssh");
        command.args(["-N", "-T", "-i"]).arg(key).args([
            "-p",
            &port.to_string(),
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=8",
            "-o",
            "ServerAliveInterval=8",
            "-o",
            "ServerAliveCountMax=3",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            &format!("HostKeyAlias={alias}"),
            "-L",
            &mapping,
            &destination,
        ]);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(unix)]
        command.process_group(0);
        let child = command
            .spawn()
            .map_err(|_| "Cannot launch Vast SSH tunnel")?;
        let mut tunnel = Tunnel { child, port: local };
        let endpoint = crate::compute_transport::Endpoint::local(local)?;
        for _ in 0..3 {
            std::thread::sleep(Duration::from_secs(2));
            if tunnel
                .child
                .try_wait()
                .map_err(|_| "Cannot observe Vast tunnel")?
                .is_some()
            {
                break;
            }
            if endpoint
                .json_get("/health", Duration::from_secs(2))
                .is_ok_and(|r| r["ok"] == true && r["service"] == "neo-gpu-v1")
            {
                return Ok(tunnel);
            }
        }
    }
    Err("Vast SSH tunnel/service unavailable".into())
}
fn run_vast(plan: &Value) -> Result<Value, String> {
    let instances = vast_instances()?;
    if instances.iter().any(|i| {
        i["label"]
            .as_str()
            .is_some_and(|s| s.starts_with("neo-gpu-"))
    }) {
        return Err("Another Neo Vast instance exists; clean it before renting".into());
    }
    let choices = vast_offers(plan)?;
    let best = choices
        .first()
        .ok_or("No verified Vast GPU offer meets hardware/price constraints")?;
    let rate = best["dph_total"].as_f64().ok_or("Vast rate unavailable")?;
    let seconds = plan["maxSeconds"]
        .as_u64()
        .ok_or("Vast timeout unavailable")?;
    let budget = plan["budget"].as_f64().ok_or("Vast budget unavailable")?;
    if rate * seconds as f64 / 3600.0 + 1.0 > budget {
        return Err("Vast cost estimate + safety margin exceeds budget".into());
    }
    let offer = best["id"].as_u64().ok_or("Vast offer ID missing")?;
    let image = plan["image"].as_str().ok_or("Vast image unavailable")?;
    let (lease, mut data) = lease_new("vast", plan)?;
    let label = format!("neo-gpu-{}", uid()?);
    data["label"] = json!(label);
    data["rate"] = json!(rate);
    write_private_state(&lease, &data)?;
    // The watchdog is independent of this CLI and starts before provider
    // creation, protecting uncertain results and hard deadlines.
    watchdog_start(&lease)?;
    let disk = plan["disk"].as_u64().ok_or("Vast disk missing")?;
    let onstart="nohup /opt/neo-gpu/node /opt/neo-gpu/launcher.mjs > /tmp/neo-gpu-service.log 2>&1 < /dev/null &";
    let mut instance: Option<u64> = None;
    let result = (|| {
        let text = capture(
            "vastai",
            &[
                "create",
                "instance",
                &offer.to_string(),
                "--image",
                image,
                "--disk",
                &disk.to_string(),
                "--ssh",
                "--direct",
                "--onstart-cmd",
                onstart,
                "--cancel-unavail",
                "--label",
                &label,
                "--raw",
            ],
            None,
            Duration::from_secs(55),
        )?;
        let response: Value = serde_json::from_str(&text)
            .map_err(|_| "Vast create returned invalid JSON; reconcile by label")?;
        let id = response["new_contract"]
            .as_u64()
            .filter(|n| *n > 0)
            .ok_or("Vast create missing instance ID; reconcile by label")?;
        instance = Some(id);
        data["instanceId"] = json!(id);
        data["phase"] = json!("running");
        write_private_state(&lease, &data)?;
        let key = plan["sshKey"]
            .as_str()
            .map(PathBuf::from)
            .unwrap_or_else(|| home().unwrap_or_default().join(".ssh/id_ed25519"));
        let deadline = std::time::Instant::now() + Duration::from_secs(seconds);
        let tunnel = vast_tunnel(
            id,
            &key,
            std::cmp::min(
                deadline
                    .checked_sub(Duration::from_secs(120))
                    .unwrap_or(deadline),
                std::time::Instant::now() + Duration::from_secs(420),
            ),
        )?;
        let endpoint = crate::compute_transport::Endpoint::local(tunnel.port)?;
        let inputs = plan["inputs"].as_array().ok_or("Vast inputs missing")?;
        let outputs = plan["outputs"].as_array().ok_or("Vast outputs missing")?;
        let files = crate::compute_transport::run_service(&endpoint, inputs, outputs, deadline)?;
        drop(tunnel);
        Ok(
            json!({"event":"NEO_GPU_RUN_PASS","provider":"vast","instanceId":id,"outputs":files,"lease":lease}),
        )
    })();
    data["phase"] = json!(if instance.is_some() {
        "cleanup_requested"
    } else {
        "unreconciled_create"
    });
    let _ = write_private_state(&lease, &data);
    let cleaned = cleanup_vast(&data);
    match cleaned {
        Ok(status) => {
            data["phase"] = json!("destroyed");
            data["terminalStatus"] = json!(status);
            write_private_state(&lease, &data)?;
            result
        }
        Err(error) => {
            data["phase"] = json!("cleanup_failed");
            let _ = write_private_state(&lease, &data);
            Err(format!("Vast cleanup or creation reconciliation not verified: {error}; lease and watchdog retained"))
        }
    }
}
/// Hidden process-owned watchdog for paid Vast leases only. The deadline is
/// set at creation and never extended by browser or task activity.
pub fn watchdog(path: &Path) -> i32 {
    let path = match validate_lease(path.to_str().unwrap_or("")) {
        Ok(p) => p,
        Err(_) => return 2,
    };
    loop {
        let Ok(mut lease) = read_json(&path, Value::Null) else {
            return 2;
        };
        if lease.is_null() {
            return 2;
        }
        if lease["phase"] == "destroyed" {
            return 0;
        }
        let now = chrono::Utc::now().timestamp_millis();
        let Some(deadline) = lease["deadline"].as_i64() else {
            return 2;
        };
        if now >= deadline {
            let result = match lease["provider"].as_str() {
                Some("vast") => cleanup_vast(&lease),
                Some("hf") => hf_cleanup(&lease),
                _ => Err("Unsupported Compute watchdog lease provider".into()),
            };
            if let Ok(status) = result {
                lease["phase"] = json!("destroyed");
                lease["terminalStatus"] = json!(status);
                return if write_private_state(&path, &lease).is_ok() {
                    0
                } else {
                    2
                };
            }
            lease["phase"] = json!("cleanup_failed");
            let _ = write_private_state(&path, &lease);
        }
        std::thread::sleep(Duration::from_secs(6));
    }
}

fn build_github(plan: &Value) -> Result<(), String> {
    if plan["push"] != true || plan["pushAuthorized"] != true {
        return Err("Hosted Compute builds must have explicit --push authorization".into());
    }
    let repository = plan["repository"]
        .as_str()
        .ok_or("Compute repository unavailable")?;
    let view = capture(
        "gh",
        &["repo", "view", repository, "--json", "isPrivate"],
        None,
        Duration::from_secs(20),
    )?;
    let info: Value =
        serde_json::from_str(&view).map_err(|_| "Invalid GH repository visibility")?;
    if info["isPrivate"] != false {
        return Err(
            "Hosted Compute builder cannot access a private project; use --builder local".into(),
        );
    }
    let owner = repository
        .split('/')
        .next()
        .ok_or("Invalid GitHub repository owner")?
        .to_lowercase();
    let image = plan["image"].as_str().ok_or("Compute image missing")?;
    if !image.starts_with(&format!("ghcr.io/{owner}/"))
        || !rx(r":sha-[a-f0-9]{12}$").is_match(image)
    {
        return Err(
            "Hosted builds require immutable owner-scoped GHCR :sha-XXXXXXXXXXXX tag".into(),
        );
    }
    let repo = env::var("NEO_GPU_BUILDER_REPO").unwrap_or_else(|_| "lalalic/neo".into());
    if !rx(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$").is_match(&repo) {
        return Err("Invalid hosted Compute builder repository".into());
    }
    let build_id = format!(
        "ncompute-{}-{}",
        chrono::Utc::now().timestamp_millis(),
        uid()?
    );
    let fields = [
        format!("repository={repository}"),
        format!("commit={}", plan["commit"].as_str().unwrap_or("")),
        format!("dockerfile={}", plan["dockerfile"].as_str().unwrap_or("")),
        format!("image={image}"),
        format!("build_id={build_id}"),
        format!(
            "runtime_hash={}",
            plan["runtimeHash"].as_str().unwrap_or("")
        ),
        format!("mode={}", plan["mode"].as_str().unwrap_or("batch")),
        format!("app_port={}", plan["appPort"]),
        format!("service_name={}", plan["name"].as_str().unwrap_or("")),
    ];
    let mut args = vec![
        "workflow",
        "run",
        "neo-gpu-image.yml",
        "--repo",
        &repo,
        "--ref",
        "main",
    ];
    for field in &fields {
        args.push("-f");
        args.push(field);
    }
    capture("gh", &args, None, Duration::from_secs(30))?;
    println!(
        "{}",
        json!({"event":"image_build_dispatched","buildId":build_id,"image":image,"repository":repo})
    );
    let deadline = std::time::Instant::now() + Duration::from_secs(50 * 60);
    loop {
        if std::time::Instant::now() >= deadline {
            return Err(format!(
                "Hosted build status unknown; reconcile GitHub Actions by ID {build_id}"
            ));
        }
        let rows = capture(
            "gh",
            &[
                "run",
                "list",
                "--repo",
                &repo,
                "--workflow",
                "neo-gpu-image.yml",
                "--limit",
                "20",
                "--json",
                "databaseId,displayTitle,status,conclusion",
            ],
            None,
            Duration::from_secs(20),
        )?;
        let jobs: Value = serde_json::from_str(&rows).map_err(|_| "Invalid GitHub Actions list")?;
        let found = jobs.as_array().and_then(|items| {
            items.iter().find(|r| {
                r["displayTitle"]
                    .as_str()
                    .is_some_and(|s| s.contains(&build_id))
            })
        });
        if let Some(job) = found {
            if job["status"] == "completed" {
                if job["conclusion"] != "success" {
                    return Err("Hosted Compute build failed; inspect GitHub Actions run".into());
                }
                let mut manifest = service_registry()?;
                let name = plan["name"].as_str().ok_or("Compute service missing")?;
                manifest["services"][name] = json!({"image":image,"repository":repository,"project":plan["project"],
                    "sourceCommit":plan["commit"],"createdAt":chrono::Utc::now().to_rfc3339(),
                    "published":true,"mode":plan["mode"],"appPort":plan["appPort"]});
                write_private_state(&registry()?, &manifest)?;
                return Ok(());
            }
        }
        std::thread::sleep(Duration::from_secs(8));
    }
}
