use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

struct Fixture {
    _temp: tempfile::TempDir,
    home: PathBuf,
    workspace: PathBuf,
    package: PathBuf,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        let workspace = home.join("Workspace");
        fs::create_dir_all(&workspace).unwrap();
        let rules = home.join(".agents/AGENTS.md");
        fs::create_dir_all(rules.parent().unwrap()).unwrap();
        fs::write(rules, "# Test Agent Rules\n").unwrap();
        let config = home.join(".config/neo/workspace.json");
        fs::create_dir_all(config.parent().unwrap()).unwrap();
        fs::write(
            &config,
            format!(
                "{{\"schemaVersion\":1,\"neoRoot\":\"{}\"}}",
                workspace.display()
            ),
        )
        .unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let package = temp.path().join("staged");
        Self {
            _temp: temp,
            home,
            workspace,
            package,
            root,
        }
    }
    fn stage(&self) -> Output {
        Command::new(env!("CARGO_BIN_EXE_neo-rs"))
            .args(["package", "stage", self.package.to_str().unwrap()])
            .env("NEO_HARNESS_ROOT", &self.root)
            .output()
            .unwrap()
    }
    fn bundled(&self, args: &[&str]) -> Output {
        Command::new(self.package.join("bin/neo"))
            .args(args)
            .current_dir(&self.workspace)
            .env("HOME", &self.home)
            .env_remove("NEO_HARNESS_ROOT")
            .env_remove("NEO_WORKSPACE_CONFIG")
            .env("PATH", "/usr/bin:/bin")
            .output()
            .unwrap()
    }
}

#[test]
fn clean_mac_candidate_bootstraps_and_discovers_skills_without_node_or_source_checkout() {
    let f = Fixture::new();
    let stage = f.stage();
    assert!(
        stage.status.success(),
        "{}",
        String::from_utf8_lossy(&stage.stderr)
    );
    let manifest: Value = serde_json::from_slice(&stage.stdout).unwrap();
    assert_eq!(manifest["productionInstall"], false);
    assert!(manifest["trackedAssets"].as_u64().unwrap() > 100);
    assert_eq!(manifest["computeContainerRuntimeAssets"], 4);
    for file in [
        "compute/runtime/service.mjs",
        "compute/runtime/web.mjs",
        "compute/runtime/launcher.mjs",
        "compute/runtime/Dockerfile.wrap",
    ] {
        assert!(
            f.package.join(file).is_file(),
            "missing Compute container wrapper asset: {file}"
        );
    }
    for obsolete in [
        "scripts/eval-project-worker-prompts.mjs",
        "scripts/audit-project-worker-evals.mjs",
        "gpu/cli.mjs",
        "compute/cli.mjs",
    ] {
        assert!(
            !f.package.join(obsolete).exists(),
            "bundled obsolete CLI Node extension: {obsolete}"
        );
    }
    // iPhoneHelm lives in its own repo and is installed only by an opt-in
    // global Skill link. It is not a bundled Harness asset or a broken
    // alias entry in a fresh Neo.app installation.
    assert!(!manifest["excludedExternalGitLinks"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v == "skills/iphone-helm"));
    assert!(f.package.join("agents/escalation.agent.md").is_file());
    assert!(f
        .package
        .join("skills/xchat-orchestrator/xchat-bootstrap.md")
        .is_file());
    assert!(!f.package.join("skills/iphone-helm").exists());
    assert!(!f.package.join("skills/neo-use").exists());
    assert!(!f.package.join(".git").exists());
    assert!(!f.package.join("Cargo.lock").exists());
    assert!(!f.package.join("target").exists());
    let workspace = f.bundled(&["workspace", "show"]);
    assert!(
        workspace.status.success(),
        "{}",
        String::from_utf8_lossy(&workspace.stderr)
    );
    let roots: Value = serde_json::from_slice(&workspace.stdout).unwrap();
    assert_eq!(
        roots["harnessRoot"],
        f.package.canonicalize().unwrap().to_string_lossy().as_ref()
    );
    let skills = f.bundled(&["skill", "list"]);
    assert!(
        skills.status.success(),
        "{}",
        String::from_utf8_lossy(&skills.stderr)
    );
    let discovered: Value = serde_json::from_slice(&skills.stdout).unwrap();
    assert!(discovered.as_array().unwrap().len() >= 12);
    assert!(discovered
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s["name"] == "neo-project"));
    assert!(discovered
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s["name"] == "xchat-orchestrator"));
    assert!(!discovered
        .as_array()
        .unwrap()
        .iter()
        .any(|s| matches!(s["name"].as_str(), Some("iphone-helm" | "neo-use"))));
    for skill in discovered.as_array().unwrap() {
        assert!(skill["path"]
            .as_str()
            .unwrap()
            .starts_with(f.package.canonicalize().unwrap().to_str().unwrap()));
    }
    let boot = f.bundled(&["bootstrap", "--json"]);
    assert!(
        boot.status.success(),
        "{}",
        String::from_utf8_lossy(&boot.stderr)
    );
    let bundle: Value = serde_json::from_slice(&boot.stdout).unwrap();
    assert!(bundle["agentRules"]
        .as_str()
        .unwrap()
        .contains("Test Agent Rules"));
    assert!(bundle["bootstrap"].as_str().unwrap().contains("XChat"));
    let list = f.bundled(&["project", "list"]);
    assert!(
        list.status.success(),
        "{}",
        String::from_utf8_lossy(&list.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&list.stdout).unwrap(),
        serde_json::json!([])
    );
    let help = f.bundled(&["--help"]);
    assert!(help.status.success());
    assert!(String::from_utf8_lossy(&help.stdout).contains("native Rust CLI"));
}
#[test]
fn distribution_rejects_existing_output_source_overlap_and_relative_paths() {
    let f = Fixture::new();
    let file = |path: &Path| {
        Command::new(env!("CARGO_BIN_EXE_neo-rs"))
            .args(["package", "stage", path.to_str().unwrap()])
            .env("NEO_HARNESS_ROOT", &f.root)
            .output()
            .unwrap()
    };
    let target = f.package.clone();
    assert!(file(&target).status.success());
    assert!(!file(&target).status.success());
    assert!(!file(&f.root.join("nested-output")).status.success());
    assert!(!file(&f.root).status.success());
    assert!(!file(Path::new("relative")).status.success());
}
#[test]
fn package_manifest_uses_only_tracked_assets_and_no_live_user_state() {
    let f = Fixture::new();
    assert!(f.stage().status.success());
    let list = Command::new("git")
        .args(["ls-files", "--stage", "-z", "--", "agents", "skills"])
        .current_dir(&f.root)
        .output()
        .unwrap();
    assert!(list.status.success());
    let tracked = String::from_utf8(list.stdout).unwrap();
    let modes = tracked
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(|s| s.split(' ').next().unwrap())
        .collect::<Vec<_>>();
    let count = modes
        .iter()
        .filter(|m| **m == "100644" || **m == "100755")
        .count();
    let report: Value =
        serde_json::from_slice(&fs::read(f.package.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(report["trackedAssets"], count);
    assert_eq!(
        report["excludedExternalGitLinks"].as_array().unwrap().len(),
        modes.len() - count
    );
    assert!(!f.package.join(".agents").exists());
    assert!(!f.package.join(".config").exists());
}

#[cfg(unix)]
#[test]
fn versioned_user_prefix_symlink_launcher_uses_its_own_bundle_assets() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new();
    let versioned = f.home.join(".local/share/neo-rust/versions/0.1.0");
    fs::create_dir_all(versioned.parent().unwrap()).unwrap();
    let stage = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        .args(["package", "stage", versioned.to_str().unwrap()])
        .env("NEO_HARNESS_ROOT", &f.root)
        .output()
        .unwrap();
    assert!(
        stage.status.success(),
        "{}",
        String::from_utf8_lossy(&stage.stderr)
    );
    let link = f.home.join(".local/bin/neo");
    fs::create_dir_all(link.parent().unwrap()).unwrap();
    symlink(versioned.join("bin/neo"), &link).unwrap();
    let output = Command::new(&link)
        .args(["workspace", "show"])
        .env("HOME", &f.home)
        .env("PATH", "/usr/bin:/bin")
        .env_remove("NEO_HARNESS_ROOT")
        .env_remove("NEO_WORKSPACE_CONFIG")
        .current_dir(&f.workspace)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let info: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(
        info["harnessRoot"],
        versioned.canonicalize().unwrap().to_string_lossy().as_ref()
    );
    let skills = Command::new(&link)
        .args(["skill", "list"])
        .env("HOME", &f.home)
        .env("PATH", "/usr/bin:/bin")
        .env_remove("NEO_HARNESS_ROOT")
        .current_dir(&f.workspace)
        .output()
        .unwrap();
    assert!(
        skills.status.success(),
        "{}",
        String::from_utf8_lossy(&skills.stderr)
    );
    let catalog: Value = serde_json::from_slice(&skills.stdout).unwrap();
    assert!(catalog.as_array().unwrap().len() >= 12);
    assert!(catalog
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s["name"] == "neo-project"));
    assert!(!catalog
        .as_array()
        .unwrap()
        .iter()
        .any(|s| matches!(s["name"].as_str(), Some("iphone-helm" | "neo-use"))));
}

#[cfg(unix)]
#[test]
fn iphone_helm_is_optional_and_discovered_from_independently_installed_global_skill() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new();
    assert!(f.stage().status.success());
    assert!(!f.package.join("skills/iphone-helm").exists());
    assert!(!f.package.join("skills/neo-use").exists());

    let list = |f: &Fixture| -> Value {
        let response = f.bundled(&["skill", "list"]);
        assert!(
            response.status.success(),
            "{}",
            String::from_utf8_lossy(&response.stderr)
        );
        serde_json::from_slice(&response.stdout).unwrap()
    };
    let has_iphone = |value: &Value| -> bool {
        value
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["name"] == "iphone-helm")
    };
    assert!(
        !has_iphone(&list(&f)),
        "iPhoneHelm must be absent before optional installation"
    );

    let independent = f.home.join("independent-iphone-helm/skills/iphone-helm");
    fs::create_dir_all(&independent).unwrap();
    fs::write(independent.join("SKILL.md"),
        "---\nname: iphone-helm\ndescription: Independently installed physical device QA Skill.\n---\n# iPhoneHelm\n")
        .unwrap();
    let global = f.home.join(".agents/skills/iphone-helm");
    fs::create_dir_all(global.parent().unwrap()).unwrap();
    symlink(&independent, &global).unwrap();
    let active = list(&f);
    let optional = active
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["name"] == "iphone-helm")
        .expect("Opt-in global iPhoneHelm Skill must become visible to Neo.app");
    assert_eq!(optional["path"], global.join("SKILL.md").to_str().unwrap());
    assert!(
        !f.package.join("skills/iphone-helm").exists(),
        "Enabling optional Skill must never alter the packaged Harness"
    );

    fs::remove_file(&global).unwrap();
    assert!(
        !has_iphone(&list(&f)),
        "Removing opt-in link must hide optional Skill without modifying Neo.app"
    );
}
