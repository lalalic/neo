//! Owner-led Escalation teaching. Tool/assistant messages live only in
//! memory; persistent lessons require owner confirmation or a fresh, distinct
//! read-only tool validation after the model reports VERIFIED.
use crate::{
    escalation_contract, escalation_experience, escalation_lock,
    escalation_server::OwnedServer,
    escalation_stateless::{self, ToolResult},
};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    io::{self, BufRead, IsTerminal, Write},
    path::Path,
    time::Duration,
};

const TEACH_RULES:&str="You are Neo's local Escalation learning agent receiving instructions directly from the owner. Use only authorized tools and verify real actions. Keep your replies concise, never repeat plaintext credentials or claim success without observed tool evidence. Once independently verified, you may end with [VERIFIED]. Do not save lessons yourself. Never bypass a necessary human approval. For a WebHelm site not in platform list, use an existing browser Session rather than inventing a platform action.";
const DRAFT_RULES:&str="Extract one reusable escalation troubleshooting lesson from this owner-led teaching conversation. Output exactly one JSON object with scenario_key, category, symptom, strategy_key, steps (ordered array), verification, failure_reason and lesson. Distinguish owner instruction from observed evidence. Omit session IDs, credentials, raw URLs and private paths. Never invent actions or verification.";

pub struct LearnConfig<'a> {
    pub endpoint: &'a str,
    pub model: &'a escalation_contract::Config,
    pub cwd: &'a Path,
    pub cases: &'a Path,
}
struct Observation {
    name: String,
    ok: bool,
    text: String,
}
struct Conversation {
    messages: Vec<Value>,
    observations: Vec<Observation>,
    failed: BTreeSet<String>,
    tools_enabled: bool,
}
impl Conversation {
    fn new() -> Self {
        Self {
            messages: vec![json!({"role":"system","content":TEACH_RULES})],
            observations: vec![],
            failed: BTreeSet::new(),
            tools_enabled: true,
        }
    }
    fn model<M: FnMut(&Value) -> Result<Value, String>>(
        request: &Value,
        model: &mut M,
    ) -> Result<Value, String> {
        let response = model(request)?;
        response
            .pointer("/choices/0/message")
            .filter(|v| v.is_object())
            .cloned()
            .ok_or("Local learning model returned no assistant message".into())
    }
    fn text(message: &Value) -> String {
        message["content"].as_str().unwrap_or("").trim().to_string()
    }
    fn ask<M, T>(
        &mut self,
        input: &str,
        settings: &LearnConfig<'_>,
        verify_only: bool,
        model: &mut M,
        tool: &mut T,
    ) -> Result<String, String>
    where
        M: FnMut(&Value) -> Result<Value, String>,
        T: FnMut(&str, &Value, &Path) -> Result<ToolResult, String>,
    {
        if input.trim().is_empty() {
            return Ok(String::new());
        }
        self.messages.push(json!({"role":"user","content":input}));
        for _ in 0..16 {
            let request = json!({"model":"neo-escalation","messages":self.messages,
                "temperature":0.2,"max_tokens":1400,"stream":false,
                "chat_template_kwargs":{"enable_thinking":false}});
            let mut request = request;
            if self.tools_enabled {
                request["tools"] = escalation_stateless::tool_specification();
                request["tool_choice"] = json!("auto");
            }
            let assistant = Self::model(&request, model)?;
            let calls = assistant["tool_calls"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            if calls.is_empty() {
                let answer = Self::text(&assistant);
                self.messages
                    .push(json!({"role":"assistant","content":answer}));
                return Ok(answer);
            }
            if !self.tools_enabled {
                return Err("Local learning model attempted tools while disabled".into());
            }
            if calls.len() > 4 {
                return Err("Local learning model requested too many tools".into());
            }
            self.messages.push(
                json!({"role":"assistant","content":assistant["content"],"tool_calls":calls}),
            );
            for (index, call) in calls.iter().enumerate() {
                let name = call
                    .pointer("/function/name")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let id = call["id"]
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| format!("learn-tool-{index}"));
                let arguments = call
                    .pointer("/function/arguments")
                    .cloned()
                    .unwrap_or(json!({}));
                let parsed = if arguments.is_object() {
                    arguments
                } else {
                    arguments
                        .as_str()
                        .and_then(|s| serde_json::from_str::<Value>(s).ok())
                        .unwrap_or(json!({}))
                };
                let key = json!({"name":name,"args":parsed}).to_string();
                let result = if self.failed.contains(&key) {
                    ToolResult{ok:false,text:"This exact command already failed; inspect the error and change approach".into()}
                } else if verify_only && !allowed_readonly(name, &parsed) {
                    ToolResult {
                        ok: false,
                        text: "Independent verification only allows read-only commands".into(),
                    }
                } else if !matches!(
                    name,
                    "shell" | "webhelm" | "credential_fill" | "computer_use"
                ) {
                    ToolResult {
                        ok: false,
                        text: "Unapproved learning tool".into(),
                    }
                } else {
                    tool(name, &parsed, settings.cwd).unwrap_or(ToolResult {
                        ok: false,
                        text: "Learning tool failed; raw error suppressed".into(),
                    })
                };
                if !result.ok {
                    self.failed.insert(key);
                }
                let text = result
                    .text
                    .chars()
                    .rev()
                    .take(12000)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect::<String>();
                self.observations.push(Observation {
                    name: name.into(),
                    ok: result.ok,
                    text: text.clone(),
                });
                self.messages.push(json!({"role":"tool","tool_call_id":id,
                    "content":json!({"ok":result.ok,"output":text}).to_string()}));
            }
        }
        Err("Local learning model reached the maximum number of tool turns".into())
    }
    fn draft<M>(&mut self, model: &mut M) -> Result<Value, String>
    where
        M: FnMut(&Value) -> Result<Value, String>,
    {
        let turns = self
            .messages
            .iter()
            .skip(1)
            .filter(|v| matches!(v["role"].as_str(), Some("user" | "assistant")))
            .rev()
            .take(40)
            .collect::<Vec<_>>();
        if turns.is_empty() {
            return Err("Teach a scenario before /remember".into());
        }
        let mut filtered = turns
            .into_iter()
            .rev()
            .map(|v| {
                json!({"role":v["role"],
            "content":v["content"].as_str().unwrap_or("").chars().take(6000).collect::<String>()})
            })
            .collect::<Vec<_>>();
        // Only summary data is given to the teaching model. Direct tool output
        // is not included and the old conversation is never persisted.
        if filtered.len() > 40 {
            filtered = filtered.split_off(filtered.len() - 40);
        }
        let observation = self
            .observations
            .iter()
            .rev()
            .take(24)
            .map(|o| json!({"tool":o.name,"ok":o.ok}))
            .collect::<Vec<_>>();
        let request = json!({"model":"neo-escalation","messages":[
            {"role":"system","content":DRAFT_RULES},
            {"role":"user","content":json!({"conversation":filtered,"actual_tools":observation}).to_string()}],
            "temperature":0,"max_tokens":2200,"stream":false,"response_format":{"type":"json_object"}});
        let answer = Self::model(&request, model)?;
        if answer["tool_calls"]
            .as_array()
            .is_some_and(|a| !a.is_empty())
        {
            return Err("A taught summary cannot call tools".into());
        }
        let text = Self::text(&answer);
        let text = text
            .strip_prefix("```json")
            .or_else(|| text.strip_prefix("```"))
            .map(|s| s.trim_end_matches("```").trim())
            .unwrap_or(text.as_str());
        let candidate: Value = serde_json::from_str(text)
            .map_err(|_| "Local model returned invalid taught lesson JSON")?;
        if !candidate["steps"]
            .as_array()
            .is_some_and(|steps| !steps.is_empty())
            || !candidate["scenario_key"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
            || !candidate["strategy_key"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
            || !candidate["lesson"].as_str().is_some_and(|s| !s.is_empty())
        {
            return Err("Lesson requires scenario, strategy, steps and principle".into());
        }
        Ok(candidate)
    }
}
fn allowed_readonly(name: &str, args: &Value) -> bool {
    match name {
        "shell" => {
            let Some(command) = args["command"].as_str() else {
                return false;
            };
            if command.contains(['\n', ';', '|', '&', '`', '$', '>', '<']) {
                return false;
            }
            let command = command.trim();
            [
                "cat ",
                "/bin/cat ",
                "ls ",
                "pwd",
                "stat ",
                "grep ",
                "git status",
                "git diff",
                "git log",
            ]
            .iter()
            .any(|prefix| command == *prefix || command.starts_with(prefix))
        }
        "computer_use" => matches!(
            args["command"].as_str(),
            Some("list_apps" | "get_app_state")
        ),
        "webhelm" => args["args"].as_array().is_some_and(|v| {
            v.len() >= 2
                && v[0] == "session"
                && matches!(v[1].as_str(), Some("list" | "snapshot" | "status"))
        }),
        _ => false,
    }
}
pub fn run_loop<R, W, M, T>(
    input: &mut R,
    output: &mut W,
    settings: &LearnConfig<'_>,
    mut model: M,
    mut tool: T,
) -> Result<(), String>
where
    R: BufRead,
    W: Write,
    M: FnMut(&Value) -> Result<Value, String>,
    T: FnMut(&str, &Value, &Path) -> Result<ToolResult, String>,
{
    if !escalation_contract::local_endpoint(settings.endpoint) {
        return Err("Learning requires a local inference endpoint".into());
    }
    let mut convo = Conversation::new();
    writeln!(
        output,
        "Neo Escalation Learn — local model, private in-memory conversation."
    )
    .map_err(|e| e.to_string())?;
    writeln!(
        output,
        "Give a scenario and steps. The agent tries them, verifies, then records automatically."
    )
    .map_err(|e| e.to_string())?;
    writeln!(
        output,
        "Commands: /quit (exit); /remember (optional manual save); /tools off (disable tools)."
    )
    .map_err(|e| e.to_string())?;
    loop {
        write!(output, "You> ").map_err(|e| e.to_string())?;
        output.flush().map_err(|e| e.to_string())?;
        let mut line = String::new();
        let read = input
            .read_line(&mut line)
            .map_err(|_| "Learning terminal input failed")?;
        if read == 0 {
            break;
        }
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if matches!(line, "/quit" | "/exit") {
            break;
        }
        if line == "/help" {
            writeln!(output,"Describe the scenario and steps, then correct failures. /remember asks for approval; /quit exits.").map_err(|e|e.to_string())?;
            continue;
        }
        if matches!(line, "/tools on" | "/tools off") {
            convo.tools_enabled = line == "/tools on";
            writeln!(
                output,
                "Local tools {}.",
                if convo.tools_enabled {
                    "enabled within authorized scope"
                } else {
                    "disabled"
                }
            )
            .map_err(|e| e.to_string())?;
            continue;
        }
        if line == "/remember" {
            let result = (|| {
                let candidate = convo.draft(&mut model)?;
                let record = escalation_experience::prepare_taught(
                    &candidate,
                    &settings.model.engine,
                    &settings.model.model,
                    &crate::escalation_ledger::timestamp(),
                )?;
                writeln!(
                    output,
                    "Proposed reusable lesson:\nScenario: {}\nSteps: {}\nVerify: {}\nPrinciple: {}",
                    record["scenario"]["symptom"].as_str().unwrap_or(""),
                    record["strategy"]["steps"].as_array().map_or(0, Vec::len),
                    record["strategy"]["verification"].as_str().unwrap_or(""),
                    record["strategy"]["lesson"].as_str().unwrap_or("")
                )
                .map_err(|e| e.to_string())?;
                writeln!(
                    output,
                    "This is owner-taught guidance, not independently verified resolution."
                )
                .map_err(|e| e.to_string())?;
                write!(output, "Save or update this lesson? [y/N] ").map_err(|e| e.to_string())?;
                output.flush().map_err(|e| e.to_string())?;
                let mut approval = String::new();
                input
                    .read_line(&mut approval)
                    .map_err(|_| "Teaching approval input failed")?;
                if matches!(approval.trim().to_lowercase().as_str(), "y" | "yes") {
                    let saved = escalation_experience::store_taught(&record, settings.cases)?;
                    writeln!(
                        output,
                        "{} lesson {}.",
                        if saved["updated"] == true {
                            "Updated"
                        } else {
                            "Saved"
                        },
                        record["scenario"]["key"].as_str().unwrap_or("")
                    )
                    .map_err(|e| e.to_string())?;
                } else {
                    writeln!(output, "Not saved. Continue teaching or /quit.")
                        .map_err(|e| e.to_string())?;
                }
                Ok::<(), String>(())
            })();
            if let Err(error) = result {
                writeln!(
                    output,
                    "Could not save lesson: {}",
                    escalation_experience::sanitize(&error, 220)
                )
                .map_err(|e| e.to_string())?;
            }
            continue;
        }
        if line.starts_with('/') {
            writeln!(output, "Unknown command. Type /help.").map_err(|e| e.to_string())?;
            continue;
        }
        let response = convo.ask(line, settings, false, &mut model, &mut tool);
        match response {
            Ok(answer) => {
                writeln!(
                    output,
                    "Agent> {}",
                    escalation_experience::sanitize(&answer, 1500)
                )
                .map_err(|e| e.to_string())?;
                if !answer.contains("[VERIFIED]") || !convo.observations.iter().any(|o| o.ok) {
                    continue;
                }
                let fresh_start = convo.observations.len();
                writeln!(output, "Checking independently before recording...")
                    .map_err(|e| e.to_string())?;
                let verification=convo.ask("Perform a NEW read-only tool check proving the original scenario is resolved. If and only if actual new evidence confirms success, end with [VERIFIED]. Otherwise report the blocker.",
                    settings,true,&mut model,&mut tool);
                match verification {
                    Ok(checked)
                        if checked.contains("[VERIFIED]")
                            && convo.observations.iter().skip(fresh_start).any(|o| o.ok) =>
                    {
                        let result = (|| {
                            let candidate = convo.draft(&mut model)?;
                            let mut record = escalation_experience::prepare_taught(
                                &candidate,
                                &settings.model.engine,
                                &settings.model.model,
                                &crate::escalation_ledger::timestamp(),
                            )?;
                            record["tool_verified"] = json!(true);
                            let tools = convo
                                .observations
                                .iter()
                                .map(|o| o.name.clone())
                                .collect::<BTreeSet<_>>();
                            record["observation"] = json!({"tools":tools,"calls":convo.observations.len(),
                                "failures":convo.observations.iter().filter(|o|!o.ok).count()});
                            if let Some(fresh) =
                                convo.observations.iter().skip(fresh_start).find(|o| o.ok)
                            {
                                record["verification_evidence"] =
                                    json!(escalation_experience::sanitize(&fresh.text, 240));
                            }
                            escalation_experience::store_taught(&record, settings.cases)?;
                            writeln!(
                                output,
                                "Verified and recorded: {}",
                                record["scenario"]["key"].as_str().unwrap_or("")
                            )
                            .map_err(|e| e.to_string())?;
                            convo = Conversation::new();
                            Ok::<(), String>(())
                        })();
                        if let Err(error) = result {
                            writeln!(
                                output,
                                "Could not record verified lesson: {}",
                                escalation_experience::sanitize(&error, 180)
                            )
                            .map_err(|e| e.to_string())?;
                        }
                    }
                    Ok(checked) => {
                        writeln!(
                            output,
                            "Agent> {}",
                            escalation_experience::sanitize(&checked, 1500)
                        )
                        .map_err(|e| e.to_string())?;
                        writeln!(output, "Not verified; describe a correction to retry.")
                            .map_err(|e| e.to_string())?;
                    }
                    Err(error) => {
                        writeln!(
                            output,
                            "Verification unavailable: {}",
                            escalation_experience::sanitize(&error, 200)
                        )
                        .map_err(|e| e.to_string())?;
                    }
                }
            }
            Err(error) => {
                writeln!(
                    output,
                    "Agent error: {}",
                    escalation_experience::sanitize(&error, 200)
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    writeln!(output, "Learning session ended. Conversation discarded.")
        .map_err(|e| e.to_string())?;
    Ok(())
}
pub fn run() -> Result<(), String> {
    if !io::stdin().is_terminal() {
        return Err("neo escalation learn requires an interactive terminal (TTY)".into());
    }
    let config = escalation_contract::config()?;
    let mut guardian = escalation_lock::acquire(&escalation_lock::config()?)?;
    let result = (|| {
        let mut owned = None;
        let endpoint = if config.engine == "external" {
            config
                .base_url
                .clone()
                .filter(|s| escalation_contract::local_endpoint(s))
                .ok_or("Local inference must be a loopback model endpoint")?
        } else {
            let server = OwnedServer::start(&config, &mut guardian)?;
            let endpoint = server.endpoint().to_string();
            owned = Some(server);
            endpoint
        };
        let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
        let settings = LearnConfig {
            endpoint: &endpoint,
            model: &config,
            cwd: &cwd,
            cases: &escalation_experience::directory()?,
        };
        let mut tool_settings = crate::escalation_tool_executor::Settings::new(cwd.clone());
        tool_settings.apple_login_authorized =
            std::env::var("NEO_ESCALATION_APPLE_LOGIN_AUTHORIZED").is_ok_and(|s| s == "true");
        let mut stdin = io::stdin().lock();
        let mut stdout = io::stdout().lock();
        let result = run_loop(
            &mut stdin,
            &mut stdout,
            &settings,
            |body| escalation_stateless::live_model(&endpoint, body, Duration::from_secs(180)),
            |name, args, _| crate::escalation_tool_executor::execute(name, args, &tool_settings),
        );
        if let Some(mut server) = owned {
            server.close();
        }
        result
    })();
    let cleaned = guardian.finish();
    match (result, cleaned) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(e), _) => Err(e),
        (Ok(()), Err(_)) => Err("Learning session model cleanup failed".into()),
    }
}
