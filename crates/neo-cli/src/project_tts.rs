//! Native macOS speech artifact CLI. Actual TTS remains owned by macOS `say`;
//! ffmpeg is only the installed format adapter, not a new inference service.
use crate::process_guard;
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant},
};
use uuid::Uuid;

const HELP: &str = "neo project tts (--text TEXT | --text-file PATH) --output ABSOLUTE.m4a [--voice Tingting] [--rate 200] [--node local]";
#[derive(Debug, Clone)]
pub struct Options {
    pub text: String,
    pub output: PathBuf,
    pub voice: String,
    pub rate: u32,
    pub node: String,
}

pub fn parse(args: &[String]) -> Result<Option<Options>, String> {
    let mut opts = std::collections::HashMap::<String, String>::new();
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if matches!(arg.as_str(), "--help" | "-h") {
            if args.len() != 1 {
                return Err("help cannot be combined with options".into());
            }
            return Ok(None);
        }
        if !arg.starts_with("--") {
            return Err(format!("unexpected argument: {arg}"));
        }
        let (name, inline) = arg[2..]
            .split_once('=')
            .map_or((arg[2..].as_ref(), None), |(key, value)| (key, Some(value)));
        if !matches!(
            name,
            "text" | "text-file" | "output" | "voice" | "rate" | "node"
        ) || opts.contains_key(name)
        {
            return Err(format!("unknown/duplicate TTS option: {arg}"));
        }
        let value = if let Some(inline) = inline {
            inline.to_owned()
        } else {
            i += 1;
            args.get(i).cloned().unwrap_or_default()
        };
        if value.trim().is_empty() {
            return Err(format!("--{name} requires a nonempty value"));
        }
        opts.insert(name.to_owned(), value);
        i += 1;
    }
    if opts.contains_key("text") == opts.contains_key("text-file") {
        return Err("provide exactly one of --text or --text-file".into());
    }
    let output = opts
        .get("output")
        .ok_or("--output requires an absolute path")?;
    let output = PathBuf::from(output);
    if !output.is_absolute() {
        return Err("--output requires an absolute path".into());
    }
    let extension = output
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "m4a" | "wav") {
        return Err("output must be .m4a or .wav".into());
    }
    let node = opts.get("node").map_or("local", String::as_str).to_owned();
    if node != "local" {
        return Err(
            "unsupported TTS node; select local (Neo Master). No SSH aliases are used.".into(),
        );
    }
    let voice = opts.remove("voice").unwrap_or_else(|| "Tingting".into());
    if voice.chars().count() > 80
        || voice.is_empty()
        || !voice
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '(' | ')' | '_' | '-'))
    {
        return Err("invalid voice name".into());
    }
    let raw_rate = opts.get("rate").map_or("200", String::as_str);
    let rate = raw_rate
        .parse::<u32>()
        .map_err(|_| "--rate must be 90–350 words/minute")?;
    if !(90..=350).contains(&rate) {
        return Err("--rate must be 90–350 words/minute".into());
    }
    let text = if let Some(value) = opts.remove("text") {
        value
    } else {
        let file = opts.get("text-file").ok_or("missing text file")?;
        fs::read_to_string(file).map_err(|e| format!("Cannot read narration file: {e}"))?
    };
    if text.trim().is_empty() || text.encode_utf16().count() > 6000 {
        return Err("TTS input must be 1–6000 characters".into());
    }
    if text.chars().any(|c| matches!(c as u32,0..=8|11|14..=31)) {
        return Err("TTS input contains control characters".into());
    }
    Ok(Some(Options {
        text,
        output,
        voice,
        rate,
        node: node.to_owned(),
    }))
}
fn execute(cmd: &str, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut command = Command::new(cmd);
    command.args(args);
    let result = process_guard::capture(&mut command, Duration::from_secs(120), 2 * 1024 * 1024)
        .map_err(|e| {
            format!(
                "{} failed: {e}",
                Path::new(cmd)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
            )
        })?;
    if !result.status.success() {
        let detail = if !result.stderr.is_empty() {
            &result.stderr
        } else {
            &result.stdout
        };
        return Err(format!(
            "{} failed: {}",
            Path::new(cmd)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy(),
            String::from_utf8_lossy(detail)
                .chars()
                .take(500)
                .collect::<String>()
        ));
    }
    Ok(result.stdout)
}
fn bytes_ready(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|m| m.is_file() && m.len() >= 2048)
}

pub fn synthesize(opts: &Options) -> Result<Value, String> {
    let since = Instant::now();
    if fs::symlink_metadata(&opts.output).is_ok() {
        return Err(format!(
            "refusing to overwrite existing TTS artifact: {}",
            opts.output.display()
        ));
    }
    let parent = opts.output.parent().ok_or("missing TTS output parent")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let parent = parent.canonicalize().map_err(|e| e.to_string())?;
    let aiff = parent.join(format!(".{}.aiff", Uuid::new_v4()));
    let encoded = parent.join(format!(
        ".{}.{}",
        Uuid::new_v4(),
        opts.output
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
    ));
    let rate = opts.rate.to_string();
    let extension = opts
        .output
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase();
    let result = (|| {
        execute(
            "/usr/bin/say",
            &[
                "-v",
                &opts.voice,
                "-r",
                &rate,
                "-o",
                aiff.to_str().ok_or("invalid temp path")?,
                &opts.text,
            ],
        )?;
        if !bytes_ready(&aiff) {
            return Err("TTS engine generated no audio".into());
        }
        let source = aiff.to_str().ok_or("invalid temp path")?;
        let output = encoded.to_str().ok_or("invalid temp path")?;
        let mut args = vec!["-hide_banner", "-loglevel", "error", "-y", "-i", source];
        if extension == "wav" {
            args.extend(["-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le"]);
        } else {
            args.extend(["-ar", "24000", "-ac", "1", "-c:a", "aac", "-b:a", "96k"]);
        }
        args.push(output);
        execute("ffmpeg", &args)?;
        if !bytes_ready(&encoded) {
            return Err("encoded TTS audio is empty".into());
        }
        let details = execute(
            "ffprobe",
            &[
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_type",
                "-of",
                "json",
                output,
            ],
        )?;
        let probed: Value =
            serde_json::from_slice(&details).map_err(|_| "TTS ffprobe returned invalid JSON")?;
        let duration = probed["format"]["duration"]
            .as_str()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or_default();
        if !duration.is_finite()
            || duration < 0.25
            || !probed["streams"]
                .as_array()
                .is_some_and(|arr| arr.iter().any(|s| s["codec_type"] == "audio"))
        {
            return Err("TTS file failed duration/audio-stream validation".into());
        }
        #[cfg(unix)]
        fs::set_permissions(&encoded, fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
        // Publish only if the target is still absent; hard_link cannot silently
        // replace an output created concurrently while speech was rendering.
        fs::hard_link(&encoded, &opts.output)
            .map_err(|e| format!("cannot publish TTS artifact without overwrite: {e}"))?;
        Ok(
            json!({"status":"PASS","engine":"macos-say","node":opts.node,
            "voice":opts.voice,"output":opts.output,"format":extension,
            "durationSeconds":(duration*1000.0).round()/1000.0,
            "elapsedMs":since.elapsed().as_millis()}),
        )
    })();
    let _ = fs::remove_file(&aiff);
    let _ = fs::remove_file(&encoded);
    result
}
pub fn run(args: &[String]) -> Result<Value, String> {
    match parse(args)? {
        None => Ok(json!({"help":HELP})),
        Some(opts) => synthesize(&opts),
    }
}
