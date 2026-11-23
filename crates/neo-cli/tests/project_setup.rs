use neo_harness_cli::project_setup;
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
struct Fixture {
    _tmp: tempfile::TempDir,
    bootstrap: PathBuf,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let bootstrap = tmp.path().join("sample/setup/bootstrap.md");
        fs::create_dir_all(bootstrap.parent().unwrap()).unwrap();
        fs::write(&bootstrap, "# Test setup instructions\n").unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        Self {
            _tmp: tmp,
            bootstrap,
            root,
        }
    }
    fn project(&self) -> Value {
        json!({"xchat_project":"sample","setup":{"bootstrap":self.bootstrap}})
    }
}
#[test]
fn native_setup_agent_handoff_url_and_prompt_match_reference_without_opening_browser() {
    let f = Fixture::new();
    let mut invoked = Vec::<String>::new();
    let output = project_setup::run_with(&f.project(), |url| {
        invoked.push(url.into());
        Ok(())
    })
    .unwrap();
    assert_eq!(output["opened"], true);
    assert_eq!(output["promptSubmitted"], false);
    assert_eq!(output["browser"], "Google Chrome");
    assert_eq!(invoked.len(), 1);
    let native = url::Url::parse(&invoked[0]).unwrap();
    assert_eq!(native.domain(), Some("chatgpt.com"));
    assert_eq!(native.path(), "/");
    let text = native.query_pairs().find(|(k, _)| k == "prompt").unwrap().1;
    assert!(text.contains("Set up sample using @neo on my Mac."));
    assert!(text.contains(f.bootstrap.to_str().unwrap()));
    let node=Command::new("node").args(["-e",r#"const project=JSON.parse(process.argv[1]);
const prompt=`Set up ${project.xchat_project} using @neo on my Mac. Read and follow this bootstrap file at its absolute path: ${project.setup.bootstrap}. Check existing state first, ask for necessary permissions, and verify the real outcome.`;
const url=new URL('https://chatgpt.com/');url.searchParams.set('prompt',prompt);console.log(JSON.stringify({url:url.href,prompt}));"#,&f.project().to_string()])
  .current_dir(&f.root).output().unwrap();
    assert!(node.status.success());
    let reference: Value = serde_json::from_slice(&node.stdout).unwrap();
    assert_eq!(reference["url"], invoked[0]);
    assert_eq!(reference["prompt"], text.as_ref());
}
#[test]
fn native_setup_agent_rejects_missing_or_relative_bootstrap_before_chrome_launch() {
    let mut attempted = false;
    for input in [
        json!({"xchat_project":"sample"}),
        json!({"xchat_project":"sample","setup":{"bootstrap":"relative/setup.md"}}),
        json!({"xchat_project":"sample","setup":{"bootstrap":"/missing/bootstrap.md"}}),
    ] {
        let result = project_setup::run_with(&input, |_| {
            attempted = true;
            Ok(())
        });
        assert!(result.is_err());
    }
    assert!(!attempted);
}
#[test]
fn native_setup_agent_propagates_browser_open_error_without_claiming_prompt_submission() {
    let f = Fixture::new();
    let result = project_setup::run_with(&f.project(), |_| {
        Err("synthetic chrome startup failure".into())
    });
    assert_eq!(
        result.err().as_deref(),
        Some("synthetic chrome startup failure")
    );
}
#[test]
fn native_setup_agent_cli_rejects_wrong_argument_shape_before_any_browser_side_effect() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    for args in [
        vec!["project", "setup-agent"],
        vec!["project", "setup-agent", "--bad"],
        vec!["project", "setup-agent", "sample", "extra"],
    ] {
        let result = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
            .args(&args)
            .env("NEO_HARNESS_ROOT", &root)
            .output()
            .unwrap();
        assert!(!result.status.success());
        assert!(result.stdout.is_empty());
    }
}
