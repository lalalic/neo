//! Private, strictly read-only local model acceptance. A freshly generated
//! secret nonce is not included in the Handoff; a model must retrieve it via
//! an actual named Shell tool result. The nonce never enters the CLI result.
use crate::{
    escalation_contract::{self, Config, Request},
    escalation_lock,
    escalation_server::OwnedServer,
    escalation_stateless::{self, ToolResult},
};
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    process::Command,
    time::{Duration, Instant},
};

fn valid_nonce(s: &str) -> bool {
    s.len() == 32
        && s.bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'))
}
fn unique_nonce() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "Self-test nonce randomness unavailable")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn fixture(dir: &Path, nonce: &str) -> Result<std::path::PathBuf, String> {
    if !valid_nonce(nonce) {
        return Err("Invalid self-test nonce".into());
    }
    let output = dir.join("nonce.txt");
    let mut opts = OpenOptions::new();
    opts.create_new(true).write(true);
    #[cfg(unix)]
    opts.mode(0o600);
    let mut file = opts
        .open(&output)
        .map_err(|_| "Cannot create private self-test nonce fixture")?;
    file.write_all(format!("{nonce}\n").as_bytes())
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(output)
}
/// Testable read-only proof. The mock model cannot know the nonce without
/// requesting the one allowed file-read tool. All other tool requests fail.
pub fn prove_with<M>(
    config: &Config,
    endpoint: &str,
    nonce: &str,
    dir: &Path,
    mut model: M,
) -> Result<Value, String>
where
    M: FnMut(&Value) -> Result<Value, String>,
{
    let started = Instant::now();
    let file = fixture(dir, nonce)?;
    let command = format!("cat {}", file.display());
    let request=Request{
        cwd:dir.into(),
        handoff:format!("Local Agent read-only self-test. Do not contact anyone, send notifications, open a website, or change files.\nUse your terminal / Shell tool to run exactly `{command}`.\nThe secret test value is not in this handoff; do not guess it.\nReport status=resolved only after observing its actual value using a tool.\nInclude the exact file value as a string in the evidence array; otherwise return status=failed.\nFor this test you NEVER notify anyone. Set notification to JSON null, reason to JSON null, and user_action to JSON null. Return a complete JSON object with status, summary, reason, user_action, evidence and notification."),
        on_needs_user:"Self-test only. Never notify a human; if a tool cannot run, return failed.".into(),
        correlation_id:None,
    };
    let mut observed = false;
    let output=escalation_stateless::run_with(endpoint,"You are performing a read-only local inference smoke test. Use exactly the requested Shell cat command to observe the unknown value. Never guess the nonce. The tool-free final JSON must use notification:null, reason:null and user_action:null because no notification or human action occurred.",
        &request,config,&mut model,|name,args,_|{
            if name!="shell"||args["command"]!=command{
                return Ok(ToolResult{ok:false,text:"Self-test permits only the exact private fixture read".into()});
            }
            let data=Command::new("/bin/cat").arg(&file).output()
                .map_err(|_|"Self-test file-read tool unavailable")?;
            observed=data.status.success();
            Ok(ToolResult{ok:observed,text:String::from_utf8_lossy(&data.stdout).to_string()})
        })?;
    let (raw, events) = escalation_contract::parse_session(&output)?;
    let parsed = escalation_contract::normalize(&raw).map_err(|err| {
        if err != "Invalid local notification report" {
            return err;
        }
        let n = &raw["notification"];
        let kind = |v: &Value| -> &'static str {
            match v {
                Value::Null => "null-or-missing",
                Value::Bool(_) => "boolean",
                Value::Number(_) => "number",
                Value::String(_) => "string",
                Value::Array(_) => "array",
                Value::Object(_) => "object",
            }
        };
        format!(
            "{err} (shape notification={}, attempted={}, delivered={}, channel={}, details={})",
            kind(n),
            kind(&n["attempted"]),
            kind(&n["delivered"]),
            kind(&n["channel"]),
            kind(&n["details"])
        )
    })?;
    if !observed
        || parsed["status"] != "resolved"
        || !parsed["evidence"].as_array().is_some_and(|items| {
            items
                .iter()
                .any(|v| v.as_str().is_some_and(|s| s.contains(nonce)))
        })
    {
        return Err("Local Agent failed to demonstrate actual file-reading evidence".into());
    }
    if events
        .iter()
        .filter(|e| e["type"] == "tool_result" && e["is_error"] != true)
        .count()
        != 1
    {
        return Err(
            "Local Agent self-test must demonstrate one permitted successful tool read".into(),
        );
    }
    Ok(
        json!({"status":"pass","backend":"local","engine":config.engine,"model":config.model,
        "checks":{"shell_tool_execution":true,"unknown_value_verified":true,
            "model_process_released":if config.engine=="external"{Value::Null}else{json!(true)},
            "no_human_notification_requested":true},
        "duration_ms":started.elapsed().as_millis()}),
    )
}
pub fn run() -> Result<Value, String> {
    let config = escalation_contract::config()?;
    let guard_config = escalation_lock::config()?;
    let mut guardian = escalation_lock::acquire(&guard_config)?;
    let work = (|| {
        let temp = tempfile::Builder::new()
            .prefix("neo-escalation-test-")
            .tempdir()
            .map_err(|_| "Cannot create private self-test folder")?;
        #[cfg(unix)]
        fs::set_permissions(temp.path(), fs::Permissions::from_mode(0o700))
            .map_err(|_| "Cannot protect private self-test folder")?;
        let nonce = unique_nonce()?;
        let mut owned = None;
        let endpoint = if config.engine == "external" {
            config
                .base_url
                .clone()
                .filter(|s| escalation_contract::local_endpoint(s))
                .ok_or("Local loopback inference endpoint required")?
        } else {
            let server = OwnedServer::start(&config, &mut guardian)?;
            let endpoint = server.endpoint().to_string();
            owned = Some(server);
            endpoint
        };
        let deadline = Instant::now() + Duration::from_secs(u64::from(config.budget_seconds));
        let proof = prove_with(&config, &endpoint, &nonce, temp.path(), |request| {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("Local Agent self-test budget expired".into());
            }
            escalation_stateless::live_model(&endpoint, request, remaining)
        });
        if let Some(mut server) = owned {
            server.close();
        }
        proof
    })();
    let cleaned = guardian.finish();
    match (work, cleaned) {
        (Ok(result), Ok(())) => Ok(result),
        (Err(error), _) => Err(error),
        (Ok(_), Err(_)) => Err("Owned inference cleanup failed after self-test".into()),
    }
}
