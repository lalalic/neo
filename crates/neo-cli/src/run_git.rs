//! Isolated private Run Git history. Never invokes network remotes or stages
//! generated Run inputs. Git invocations disable user hooks and signing.
use crate::run_dry::Prepared;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};

fn git(run: &Path, args: &[&str]) -> Result<String, String> {
    let result = Command::new("git")
        .args([
            "-c",
            "user.name=Neo Project Runner",
            "-c",
            "user.email=neo-run@localhost",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "core.hooksPath=/dev/null",
            "-C",
        ])
        .arg(run)
        .args(args)
        .output()
        .map_err(|e| format!("Run Git: git {} failed: {e}", args.first().unwrap_or(&"?")))?;
    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!(
            "Run Git: git {} failed: {}",
            args.first().unwrap_or(&"?"),
            stderr.trim().chars().take(350).collect::<String>()
        ));
    }
    Ok(String::from_utf8_lossy(&result.stdout).trim().to_string())
}
fn marker(run: &Path) -> PathBuf {
    run.join(".git")
}
fn excludes(run: &Path) -> Result<(), String> {
    let file = run.join(".git/info/exclude");
    fs::create_dir_all(file.parent().ok_or("Run Git missing info parent")?)
        .map_err(|e| e.to_string())?;
    let current = fs::read_to_string(&file).unwrap_or_default();
    if !current
        .lines()
        .any(|line| line.trim_end_matches('\r') == ".ghost.*")
    {
        let mut writer = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file)
            .map_err(|e| e.to_string())?;
        if !current.is_empty() && !current.ends_with('\n') {
            writer.write_all(b"\n").map_err(|e| e.to_string())?;
        }
        writer.write_all(b".ghost.*\n").map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn check_existing(run: &Path) -> Result<(), String> {
    let root = marker(run);
    let meta = fs::symlink_metadata(&root).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err("Run Git: existing Run Git must be an independent local repository".into());
    }
    let actual = git(run, &["rev-parse", "--show-toplevel"])?;
    let canonical = run.canonicalize().map_err(|e| e.to_string())?;
    if Path::new(&actual).canonicalize().ok().as_deref() != Some(canonical.as_path()) {
        return Err("Run Git: existing Run Git must be an independent local repository".into());
    }
    if !git(run, &["remote"])?.is_empty() {
        return Err("Run Git: Run Git must have no remotes".into());
    }
    let ignore = run.join(".gitignore");
    let meta = fs::symlink_metadata(&ignore)
        .map_err(|_| "Run Git: Run .gitignore is missing or unsafe".to_string())?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err("Run Git: Run .gitignore is missing or unsafe".into());
    }
    Ok(())
}

pub fn ensure(run: &Path, prepared: &Prepared) -> Result<(), String> {
    let Some(spec) = prepared
        .selected
        .declaration
        .get("versioning")
        .filter(|v| !v.is_null())
    else {
        return Ok(());
    };
    if spec["mode"] != "local-git" || spec["template"] != "run-template" {
        return Err("Run Git: versioning requires local-git and run-template".into());
    }
    let file = prepared.selected.project.join("run-template/.gitignore");
    let file_meta = fs::symlink_metadata(&file)
        .map_err(|_| "Run Git: project run-template/.gitignore is missing or unsafe".to_string())?;
    if file_meta.file_type().is_symlink()
        || !file_meta.is_file()
        || !file
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(&prepared.selected.project)
    {
        return Err("Run Git: project run-template/.gitignore is missing or unsafe".into());
    }
    let rules = fs::read_to_string(&file).map_err(|e| e.to_string())?;
    if rules.trim().is_empty() {
        return Err("Run Git: empty run-template/.gitignore".into());
    }
    let existing = fs::symlink_metadata(marker(run)).is_ok();
    if existing {
        check_existing(run)?;
        excludes(run)?;
        let head = git(run, &["rev-parse", "--verify", "HEAD"]);
        if head.is_err() {
            let indexed = git(run, &["ls-files"])?;
            if !indexed.is_empty() && indexed != ".gitignore" {
                return Err(
                    "Run Git: unfinished Run Git initialization has unexpected staged files".into(),
                );
            }
            git(run, &["add", "--", ".gitignore"])?;
            git(
                run,
                &[
                    "commit",
                    "-q",
                    "-m",
                    "run: initialize local version history",
                ],
            )?;
        }
        return Ok(());
    }
    let ignore = run.join(".gitignore");
    if let Ok(meta) = fs::symlink_metadata(&ignore) {
        if meta.file_type().is_symlink()
            || !meta.is_file()
            || fs::read_to_string(&ignore).map_err(|e| e.to_string())? != rules
        {
            return Err(
                "Run Git: existing Run .gitignore differs from project run-template; preserve file"
                    .into(),
            );
        }
    } else {
        let mut writer = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&ignore)
            .map_err(|e| e.to_string())?;
        #[cfg(unix)]
        writer
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
        writer
            .write_all(rules.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    #[cfg(unix)]
    fs::set_permissions(run, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    git(run, &["init", "-q", "-b", "run"])?;
    excludes(run)?;
    #[cfg(unix)]
    fs::set_permissions(marker(run), fs::Permissions::from_mode(0o700))
        .map_err(|e| e.to_string())?;
    git(run, &["add", "--", ".gitignore"])?;
    git(
        run,
        &[
            "commit",
            "-q",
            "-m",
            "run: initialize local version history",
        ],
    )?;
    Ok(())
}
