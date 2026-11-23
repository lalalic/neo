//! Explicit native stateless tool adapters. This module only executes tools
//! through the existing macOS Shell, WebHelm CLI and NeoY Computer Use facade.
//! Model-requested tool names and arguments are validated before dispatch.
use crate::{escalation_stateless::ToolResult, process_guard};
use regex::Regex;
use serde_json::{json, Value};
use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

const LIMIT: usize = 12000;
const ALLOWED_COMPUTER: &[&str] = &[
    "click",
    "drag",
    "get_app_state",
    "key",
    "list_apps",
    "perform_secondary_action",
    "scroll",
    "select_text",
    "set_value",
    "type",
];

pub struct Settings {
    pub cwd: PathBuf,
    pub webhelm_executable: PathBuf,
    /// False unless owner explicitly authorized filling Apple sign-in fields.
    pub apple_login_authorized: bool,
    /// Injectable synthetic credential sources for isolated acceptance tests.
    /// A production executor may instead use inherited owner USER_* variables.
    pub apple_accounts: Option<String>,
    pub apple_passwords: Option<String>,
}
impl Settings {
    pub fn new(cwd: PathBuf) -> Self {
        Self {
            cwd,
            webhelm_executable: PathBuf::from("webhelm"),
            apple_login_authorized: false,
            apple_accounts: None,
            apple_passwords: None,
        }
    }
}
fn tail(text: &str) -> String {
    let last = text.chars().rev().take(LIMIT).collect::<String>();
    last.chars().rev().collect()
}
fn cleanse(text: &str, exact: &[&str]) -> String {
    let mut value = Regex::new(r"(?im)\bUSER_(?:ACCOUNTS|PASSWORDS)\s*=\s*[^\r\n]+")
        .expect("static credential mask regex")
        .replace_all(text, "USER_CREDENTIALS=[redacted]")
        .to_string();
    for secret in exact.iter().filter(|secret| !secret.is_empty()) {
        value = value.replace(secret, "[credential]");
    }
    tail(&value)
}
fn run(
    command: &Path,
    args: &[String],
    cwd: &Path,
    input: Option<&str>,
    secrets: &[&str],
) -> Result<ToolResult, String> {
    if !cwd.is_dir() {
        return Err("Escalation original working directory is unavailable".into());
    }
    let mut cmd = Command::new(command);
    // Credentials for the narrowly authorized Apple-fill path are passed
    // only via its one stdin request. Shell, WebHelm and their descendants
    // must not inherit the owner's raw account/password environment.
    let ambient_accounts = env::var("USER_ACCOUNTS").ok();
    let ambient_passwords = env::var("USER_PASSWORDS").ok();
    cmd.env_remove("USER_ACCOUNTS")
        .env_remove("USER_PASSWORDS")
        .args(args)
        .current_dir(cwd);
    let capture = process_guard::capture_with_input(
        &mut cmd,
        input.map(str::as_bytes),
        Duration::from_secs(90),
        512 * 1024,
    )?;
    let output = if !capture.stdout.is_empty() {
        capture.stdout
    } else {
        capture.stderr
    };
    let mut all_secrets = secrets.to_vec();
    all_secrets.extend(ambient_accounts.as_deref());
    all_secrets.extend(ambient_passwords.as_deref());
    Ok(ToolResult {
        ok: capture.status.success(),
        text: cleanse(&String::from_utf8_lossy(&output), &all_secrets),
    })
}
fn valid_session(session: &str) -> bool {
    session.len() == 16 && session.bytes().all(|byte| byte.is_ascii_hexdigit())
}
fn apple_fields(args: &Value, settings: &Settings) -> Result<ToolResult, String> {
    let id = args["session_id"].as_str().unwrap_or("");
    if !valid_session(id) {
        return Err("Expected an existing WebHelm session ID".into());
    }
    if !settings.apple_login_authorized {
        return Ok(ToolResult {
            ok: false,
            text: "Apple credential filling requires explicit owner authorization".into(),
        });
    }
    let accounts = settings
        .apple_accounts
        .clone()
        .or_else(|| env::var("USER_ACCOUNTS").ok())
        .unwrap_or_default();
    let passwords = settings
        .apple_passwords
        .clone()
        .or_else(|| env::var("USER_PASSWORDS").ok())
        .unwrap_or_default();
    let account = accounts
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();
    let pass = passwords.split(',').map(str::trim).collect::<Vec<_>>();
    let email = Regex::new(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").map_err(|e| e.to_string())?;
    let matched = account
        .iter()
        .enumerate()
        .filter(|(i, s)| email.is_match(s) && pass.get(*i).is_some_and(|p| !p.is_empty()))
        .map(|(i, s)| (*s, pass[i]))
        .collect::<Vec<_>>();
    if matched.len() != 1 {
        return Ok(ToolResult {
            ok: false,
            text: if matched.is_empty() {
                "No paired Apple Account email and password found in local USER_ACCOUNTS / USER_PASSWORDS".into()
            } else {
                "Multiple possible Apple Accounts found; ask owner to select before trying any"
                    .into()
            },
        });
    }
    let (account, password) = matched[0];
    // Exact fields plus URL/frame checks mirror the existing WebHelm Apple
    // adapter. Secrets are delivered to one authorized subprocess via stdin,
    // never argv, the model result, or an on-disk temporary payload.
    let account_js = serde_json::to_string(account).map_err(|e| e.to_string())?;
    let password_js = serde_json::to_string(password).map_err(|e| e.to_string())?;
    let expression = format!(
        r#"(()=>{{const account={account_js};const password={password_js};
        const u=document.getElementById("account_name_text_field");
        const p=document.getElementById("password_text_field");
        if(!u||!p)return {{ok:false,reason:"Apple login inputs not found"}};
        const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;
        set.call(u,account);u.dispatchEvent(new Event("input",{{bubbles:true}}));
        u.dispatchEvent(new Event("change",{{bubbles:true}}));
        set.call(p,password);p.dispatchEvent(new Event("input",{{bubbles:true}}));
        p.dispatchEvent(new Event("change",{{bubbles:true}}));
        return {{ok:u.value===account&&p.value===password}};}})()"#
    );
    let encoded = serde_json::to_string(&expression).map_err(|e| e.to_string())?;
    let code = format!(
        r#"const tree=(await cdp('Page.getFrameTree')).frameTree;
const child=tree.childFrames?.find(x=>x.frame.url.startsWith('https://idmsa.apple.com/'))?.frame;
if(!tree.frame.url.startsWith('https://appstoreconnect.apple.com/') || !child)
 throw Error('Refusing to fill credentials outside Apple App Store Connect sign-in');
const context=await cdp('Page.createIsolatedWorld',{{frameId:child.id,worldName:'neo_secure_apple_fill'}});
const r=await cdp('Runtime.evaluate',{{expression:{encoded},contextId:context.executionContextId,returnByValue:true}});
if(!r.result?.value?.ok)throw Error('Unable to locate or fill Apple sign-in fields');
console.log('Apple sign-in fields filled from authorized local environment. No credentials disclosed.');"#
    );
    let argv = vec!["session".into(), "exec".into(), id.into()];
    let result = run(
        &settings.webhelm_executable,
        &argv,
        &settings.cwd,
        Some(&code),
        &[account, password],
    )?;
    if result.ok {
        return Ok(ToolResult{ok:true,text:"Apple sign-in fields were filled securely from USER_ACCOUNTS and USER_PASSWORDS. No submission was performed.".into()});
    }
    Ok(ToolResult {
        ok: false,
        text: format!("Apple secure fill failed: {}", tail(&result.text)),
    })
}

pub fn execute_with<F>(
    name: &str,
    args: &Value,
    settings: &Settings,
    mut computer: F,
) -> Result<ToolResult, String>
where
    F: FnMut(&str, &Value) -> Result<Value, String>,
{
    if !args.is_object() {
        return Err("Stateless tool arguments must be a JSON object".into());
    }
    match name {
        "shell" => {
            let cmd = args["command"]
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .ok_or("Shell command missing")?;
            let forbidden = Regex::new(
                r"(?i)USER_(?:ACCOUNTS|PASSWORDS)|(?:^|[;|&\s])(?:printenv|env|set)(?:\s|[;|&]|$)",
            )
            .map_err(|e| e.to_string())?;
            if forbidden.is_match(cmd) {
                return Ok(ToolResult{ok:false,
                text:"Reading or printing environment credentials through Shell is blocked. Use credential_fill with the existing WebHelm session_id.".into()});
            }
            run(
                Path::new("/bin/zsh"),
                &["-lc".into(), cmd.into()],
                &settings.cwd,
                None,
                &[],
            )
        }
        "webhelm" => {
            let raw = args["args"].as_array().ok_or("Invalid WebHelm args")?;
            if raw.is_empty() || raw.len() > 25 || raw.iter().any(|v| v.as_str().is_none()) {
                return Err("Invalid WebHelm args".into());
            }
            if !args
                .as_object()
                .is_some_and(|o| o.keys().all(|key| matches!(key.as_str(), "args" | "code")))
            {
                return Err("WebHelm accepts only args and optional session exec code".into());
            }
            let cli = raw
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect::<Vec<_>>();
            let session_exec = cli.first().is_some_and(|v| v == "session")
                && cli.get(1).is_some_and(|v| v == "exec");
            let code = if let Some(value) = args.get("code") {
                if !session_exec || !value.as_str().is_some_and(|v| v.len() <= 30000) {
                    return Err(
                        "WebHelm code is only supported for session exec ID (max 30000 characters)"
                            .into(),
                    );
                }
                value.as_str()
            } else {
                None
            };
            if session_exec && !code.is_some_and(|s| !s.trim().is_empty()) {
                return Ok(ToolResult {
                    ok: false,
                    text: "session exec requires JavaScript code. Pass the code property".into(),
                });
            }
            if session_exec && (cli.len() != 3 || cli[2].starts_with('-')) {
                return Err("WebHelm session exec requires one existing session identifier".into());
            }
            run(&settings.webhelm_executable, &cli, &settings.cwd, code, &[])
        }
        "computer_use" => {
            let command = args["command"].as_str().unwrap_or("");
            if !ALLOWED_COMPUTER.contains(&command) {
                return Err("Unapproved Computer Use command".into());
            }
            let options = args.get("args").cloned().unwrap_or_else(|| json!({}));
            if !options.is_object() {
                return Err("Computer Use arguments must be a JSON object".into());
            }
            let result = computer(command, &options)?;
            let text = serde_json::to_string(&result).map_err(|e| e.to_string())?;
            Ok(ToolResult {
                ok: result["isError"] != true,
                text: cleanse(&text, &[]),
            })
        }
        "credential_fill" => apple_fields(args, settings),
        _ => Err("Unknown agent tool".into()),
    }
}
pub fn execute(name: &str, args: &Value, settings: &Settings) -> Result<ToolResult, String> {
    execute_with(name, args, settings, crate::mcp_local::computer_direct)
}
