// Immutable synthetic migration contract fixtures. No historical CLI is executed.
use serde_json::Value;
use std::path::PathBuf;
fn path(name: &str, input: &Value) -> PathBuf {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/contracts");
    let prefix = format!("{name}-");
    for entry in std::fs::read_dir(&root).unwrap() {
        let file = entry.unwrap().path();
        if file
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with(&prefix) && n.ends_with(".json"))
        {
            let fixture: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
            if &fixture["input"] == input {
                return file;
            }
        }
    }
    panic!("missing contract fixture {name}: {input}");
}
pub fn expected(name: &str, input: &Value) -> Value {
    let file = path(name, input);
    let fixture: Value = serde_json::from_slice(
        &std::fs::read(&file)
            .unwrap_or_else(|e| panic!("missing contract fixture {}: {e}", file.display())),
    )
    .unwrap();
    assert_eq!(
        &fixture["input"], input,
        "fixture key collision or changed contract input"
    );
    fixture["expected"].clone()
}
// Assert the full normalized response against the frozen contract.
#[allow(dead_code)]
pub fn assert_output(
    name: &str,
    args: &[&str],
    out: &std::process::Output,
    replacements: &[(&str, &str)],
) {
    let normalize = |text: &str| {
        replacements
            .iter()
            .fold(text.to_string(), |value, (from, to)| {
                value.replace(from, to)
            })
            .replace("/private<FIXTURE>", "<FIXTURE>")
    };
    let input = serde_json::json!(args.iter().map(|s| normalize(s)).collect::<Vec<_>>());
    let stdout = normalize(&String::from_utf8_lossy(&out.stdout));
    let expected = serde_json::json!({"exit":out.status.code(),"stdout":serde_json::from_str::<Value>(&stdout).unwrap_or(Value::String(stdout))});
    let name = format!(
        "{name}-{}",
        std::thread::current().name().unwrap_or("unnamed")
    );
    assert_eq!(
        expected,
        self::expected(&name, &input),
        "native contract: {name} {input}"
    );
    if !out.status.success() {
        assert!(out.stdout.is_empty());
        assert!(!out.stderr.is_empty());
    }
}
