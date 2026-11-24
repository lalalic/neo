use serde_json::Value;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

struct Fixture {
    tmp: tempfile::TempDir,
}
impl Fixture {
    fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        Self { tmp }
    }
    fn path(&self, name: &str) -> PathBuf {
        self.tmp.path().join(name)
    }
    fn call(&self, args: &[&str]) -> Output {
        let mut process = Command::new(env!("CARGO_BIN_EXE_neo-rs"));
        process
            .args(["project", "tts"])
            .args(args)
            .output()
            .unwrap()
    }
    fn verify_audio(&self, path: &Path, min_duration: f64) {
        let output = Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_type",
                "-of",
                "json",
                path.to_str().unwrap(),
            ])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        let duration = report["format"]["duration"]
            .as_str()
            .unwrap()
            .parse::<f64>()
            .unwrap();
        assert!(
            duration > min_duration,
            "audio shorter than expected: {duration}"
        );
        assert!(report["streams"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["codec_type"] == "audio"));
        assert!(fs::metadata(path).unwrap().len() > 2048);
    }
}
#[test]
fn native_synthesizes_real_chinese_m4a_and_wav_with_verified_audio_stream() {
    let f = Fixture::new();
    for (format, text, rate) in [
        ("m4a", "今天阳光很好，我们一起看看水面的波纹。", "200"),
        (
            "wav",
            "石头边的溪水慢慢向前流，风吹过来，树叶也动了。",
            "225",
        ),
    ] {
        let output = f.path(&format!("nested/speech.{format}"));
        let args = [
            "--text",
            text,
            "--output",
            output.to_str().unwrap(),
            "--voice",
            "Tingting",
            "--rate",
            rate,
        ];
        let result = f.call(&args);
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let doc: Value = serde_json::from_slice(&result.stdout).unwrap();
        assert_eq!(doc["status"], "PASS");
        assert_eq!(doc["format"], format);
        assert_eq!(doc["voice"], "Tingting");
        assert_eq!(doc["engine"], "macos-say");
        assert_eq!(doc["output"], output.to_string_lossy().as_ref());
        assert!(doc["durationSeconds"].as_f64().unwrap() > 1.0);
        f.verify_audio(&output, 1.0);
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(&output).unwrap().permissions().mode() & 0o777,
            0o600
        );
        // Repeating the same target must never replace this verified artifact.
        let bytes = fs::read(&output).unwrap();
        let repeated = f.call(&args);
        assert!(!repeated.status.success());
        assert_eq!(fs::read(&output).unwrap(), bytes);
    }
}
#[test]
fn native_accepts_narration_file_and_preserves_reference_cli_help() {
    let f = Fixture::new();
    let narrator = f.path("narration.txt");
    fs::write(&narrator, "路上有光，风里有一点凉意。\n").unwrap();
    let wav = f.path("file.wav");
    let result = f.call(&[
        "--text-file",
        narrator.to_str().unwrap(),
        "--output",
        wav.to_str().unwrap(),
    ]);
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    f.verify_audio(&wav, 0.5);
    let rust = f.call(&["--help"]);
    assert!(rust.status.success());
    let a: Value = serde_json::from_slice(&rust.stdout).unwrap();
    assert!(a.is_object());
    assert!(a.to_string().contains("--text"));
}
#[test]
fn native_rejects_same_invalid_tts_arguments_as_node_without_audio_writes() {
    let f = Fixture::new();
    let output = f.path("output.m4a");
    let output = output.to_str().unwrap();
    let matrix = vec![
        vec!["--text", "hello"],
        vec!["--text", "", "--output", output],
        vec![
            "--text",
            "hello",
            "--text-file",
            "anything",
            "--output",
            output,
        ],
        vec!["--text", "hello", "--output", "relative.m4a"],
        vec!["--text", "hello", "--output", output, "--node", "work"],
        vec!["--text", "hello", "--output", output, "--rate", "500"],
        vec!["--text", "hello", "--output", output, "--rate", "ninety"],
        vec![
            "--text",
            "hello",
            "--output",
            output,
            "--voice",
            "../../../bad",
        ],
        vec!["--text", "hello", "--output", output, "--output", output],
        vec!["--text", "hello", "--output", output, "--unknown", "x"],
        vec![
            "--text",
            "hello",
            "--output",
            output,
            "--voice",
            "bad;touch /tmp/unsafe",
        ],
        vec!["--help", "--text", "hello"],
    ];
    for args in matrix {
        let native = f.call(&args);
        assert!(
            !native.status.success(),
            "invalid TTS args accepted: {args:?}"
        );
        assert_eq!(native.status.code(), Some(1), "{args:?}");
        assert!(
            native.stdout.is_empty(),
            "invalid TTS must never emit PASS: {args:?}"
        );
    }
    assert!(!f.path("output.m4a").exists());
}
#[test]
fn engine_failure_removes_only_temporary_files_and_leaves_no_false_pass() {
    let f = Fixture::new();
    let stub_dir = f.path("bin");
    fs::create_dir_all(&stub_dir).unwrap();
    let fake = stub_dir.join("ffmpeg");
    fs::write(&fake, "#!/bin/sh\necho encode-failed >&2\nexit 44\n").unwrap();
    #[cfg(unix)]
    fs::set_permissions(&fake, fs::Permissions::from_mode(0o755)).unwrap();
    let output = f.path("speech.wav");
    let path = format!("{}:{}", stub_dir.display(), std::env::var("PATH").unwrap());
    let failed = Command::new(env!("CARGO_BIN_EXE_neo-rs"))
        .args([
            "project",
            "tts",
            "--text",
            "你好，这是一个失败处理测试。",
            "--output",
            output.to_str().unwrap(),
        ])
        .env("PATH", path)
        .output()
        .unwrap();
    assert!(!failed.status.success());
    assert!(String::from_utf8_lossy(&failed.stderr).contains("encode-failed"));
    assert!(failed.stdout.is_empty());
    assert!(!output.exists());
    let names = fs::read_dir(f.tmp.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    assert!(!names
        .iter()
        .any(|s| s.starts_with('.') && s.ends_with(".aiff")));
}
