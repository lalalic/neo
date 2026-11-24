//! Deterministic, local-only Rust Harness distribution staging. Only committed
//! Git asset blobs are copied. External Git symlinks never dereference into
//! an unrelated repository or a user's private machine.
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    env, fs,
    path::{Component, Path, PathBuf},
    process::Command,
};

fn git(root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let result = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|e| format!("Cannot inspect committed Harness assets: {e}"))?;
    if !result.status.success() {
        return Err(format!(
            "Cannot inspect committed Harness assets: {}",
            String::from_utf8_lossy(&result.stderr).trim()
        ));
    }
    Ok(result.stdout)
}
fn safe_relative(path: &str) -> bool {
    if !["agents", "skills"]
        .iter()
        .any(|namespace| path.starts_with(&format!("{namespace}/")))
    {
        return false;
    }
    if !path
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'/'))
    {
        return false;
    }
    !path.split('/').any(|part| {
        part.is_empty()
            || part == "."
            || part == ".."
            || (part.starts_with('.') && part != ".shortcut")
    }) && Path::new(path)
        .components()
        .all(|part| matches!(part, Component::Normal(_)))
}
fn write_committed_assets(root: &Path, out: &Path) -> Result<(usize, Vec<String>), String> {
    let rows = git(
        root,
        &["ls-files", "--stage", "-z", "--", "agents", "skills"],
    )?;
    let mut total = 0;
    let mut excluded = Vec::new();
    for raw in rows.split(|b| *b == 0).filter(|bytes| !bytes.is_empty()) {
        let record =
            std::str::from_utf8(raw).map_err(|_| "Invalid UTF-8 in Git tracked asset manifest")?;
        let (meta, rel) = record
            .split_once('\t')
            .ok_or("Invalid Git tracked asset record")?;
        let mode = meta.split(' ').next().unwrap_or("");
        if !safe_relative(rel) {
            return Err(format!("Unsafe tracked Harness asset: {rel}"));
        }
        if mode == "120000" {
            // Link targets could resolve outside the repo or change without a
            // commit. Record the omission, not a mutable external snapshot.
            excluded.push(rel.to_string());
            continue;
        }
        if !matches!(mode, "100644" | "100755") {
            return Err(format!("Unsupported Git asset mode {mode}: {rel}"));
        }
        let reference = format!("HEAD:{rel}");
        let bytes = git(root, &["show", &reference])?;
        if bytes.len() > 16 * 1024 * 1024 {
            return Err(format!("Tracked Harness asset exceeds 16 MiB: {rel}"));
        }
        let dest = out.join(rel);
        let parent = dest.parent().ok_or("Invalid asset parent")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        fs::set_permissions(
            &dest,
            fs::Permissions::from_mode(if mode == "100755" { 0o755 } else { 0o644 }),
        )
        .map_err(|e| e.to_string())?;
        total += 1;
    }
    excluded.sort();
    Ok((total, excluded))
}
/// Container image wrapper files are workload assets, not Neo CLI Node
/// executables. They remain bundled until the image's internal runtime is
/// separately migrated. Eval and Compute CLI never delegate to these scripts.
const COMPUTE_CONTAINER_ASSETS: &[&str] = &[
    "gpu/runtime/service.mjs",
    "gpu/runtime/web.mjs",
    "gpu/runtime/launcher.mjs",
    "gpu/runtime/Dockerfile.wrap",
];
fn write_container_assets(root: &Path, out: &Path) -> Result<usize, String> {
    for &rel in COMPUTE_CONTAINER_ASSETS {
        let record = git(root, &["ls-files", "--stage", "--", rel])?;
        let line = String::from_utf8(record).map_err(|e| e.to_string())?;
        if !line.starts_with("100644 ") && !line.starts_with("100755 ") {
            return Err(format!(
                "Native Compute package requires regular tracked container asset: {rel}"
            ));
        }
        let data = git(root, &["show", &format!("HEAD:{rel}")])?;
        if data.len() > 4 * 1024 * 1024 {
            return Err("Compute container asset exceeded 4MiB".into());
        }
        let target = out.join(rel);
        fs::create_dir_all(
            target
                .parent()
                .ok_or("Invalid container runtime asset path")?,
        )
        .map_err(|e| e.to_string())?;
        fs::write(&target, data).map_err(|e| e.to_string())?;
    }
    Ok(COMPUTE_CONTAINER_ASSETS.len())
}
fn is_inside(outer: &Path, inner: &Path) -> bool {
    inner.starts_with(outer)
}

pub fn stage(target: &Path) -> Result<Value, String> {
    if !target.is_absolute() {
        return Err("Rust distribution path must be absolute".into());
    }
    if fs::symlink_metadata(target).is_ok() {
        return Err("Rust distribution output already exists; refusing to replace it".into());
    }
    let root = crate::workspace::harness_root()?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let resolved = git(&root, &["rev-parse", "--show-toplevel"])?;
    let source = PathBuf::from(
        String::from_utf8(resolved)
            .map_err(|e| e.to_string())?
            .trim(),
    )
    .canonicalize()
    .map_err(|e| e.to_string())?;
    if root != source {
        return Err("Rust distribution requires the canonical tracked Harness Git root".into());
    }
    let parent = target
        .parent()
        .ok_or("Invalid distribution parent")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let destination = parent.join(target.file_name().ok_or("Output name missing")?);
    if is_inside(&source, &destination) || is_inside(&destination, &source) {
        return Err("Rust distribution must be staged outside the source Git checkout".into());
    }
    let exe = env::current_exe().map_err(|e| e.to_string())?;
    let revision = String::from_utf8(git(&root, &["rev-parse", "HEAD"])?)
        .map_err(|e| e.to_string())?
        .trim()
        .to_string();
    fs::create_dir(&destination).map_err(|e| e.to_string())?;
    let written = (|| {
        let bin = destination.join("bin");
        fs::create_dir(&bin).map_err(|e| e.to_string())?;
        let name = bin.join("neo");
        fs::copy(&exe, &name).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        fs::set_permissions(&name, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
        let (count, external) = write_committed_assets(&root, &destination)?;
        let container_assets = write_container_assets(&root, &destination)?;
        let manifest = json!({"schemaVersion":1,"name":"neo-harness-rust",
            "version":env!("CARGO_PKG_VERSION"),"revision":revision,
            "platform":env::consts::OS,"architecture":env::consts::ARCH,
            "entrypoint":"bin/neo","trackedAssets":count,
            "computeContainerRuntimeAssets":container_assets,
            "excludedExternalGitLinks":external,
            "productionInstall":false});
        fs::write(
            destination.join("manifest.json"),
            serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())? + "\n",
        )
        .map_err(|e| e.to_string())?;
        fs::write(destination.join("README.md"),"# Neo Harness native Rust CLI\n\nRun `bin/neo --help`. This is a local staged candidate, not an installation or production cutover. `manifest.json` lists external Git-link Skills intentionally omitted because their targets are outside the tracked Harness checkout. Compute and Eval CLI command routing is native Rust. Project-specific JS test cases and optional JS preflight scripts require their explicitly declared project Node runner. Container images still use a separately bundled internal JS runtime.\n").map_err(|e|e.to_string())?;
        Ok(manifest)
    })();
    if written.is_err() {
        let _ = fs::remove_dir_all(&destination);
    }
    written
}
pub fn run(args: &[String]) -> Result<Value, String> {
    if args.len() != 2 || args[0] != "stage" {
        return Err("usage: neo-rs package stage ABSOLUTE_EMPTY_OUTPUT_DIR".into());
    }
    stage(Path::new(&args[1]))
}
