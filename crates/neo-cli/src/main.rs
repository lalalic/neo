mod agent;
mod bootstrap;
mod diagnostics;
mod project;
mod skill;
mod workspace;

use std::env;

fn run(args: &[String]) -> Result<i32, String> {
    let (command, rest) = args.split_first().ok_or_else(|| {
        "usage: neo-rs --help (preview commands only; installed neo remains unchanged)".to_string()
    })?;
    match command.as_str() {
        "agent" => {
            let root = workspace::harness_root()?;
            workspace::validate_workspace_config()?;
            let result = agent::run(rest, &root)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?
            );
            Ok(0)
        }
        "skill" if rest.first().is_some_and(|s| s == "package") => {
            let path = neo_harness_cli::skill_package::run(&rest[1..])?;
            println!("{path}");
            Ok(0)
        }
        "skill" => {
            let root = workspace::harness_root()?;
            workspace::validate_workspace_config()?;
            let result = skill::run(rest, &root)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?
            );
            Ok(0)
        }
        "bootstrap" => {
            let root = workspace::harness_root()?;
            workspace::validate_workspace_config()?;
            print!("{}", bootstrap::run(rest, &root)?);
            Ok(0)
        }
        "workspace" => {
            println!("{}", workspace::show(rest)?);
            Ok(0)
        }
        "project" if matches!(rest.first().map(|s| s.as_str()), Some("list" | "resolve")) => {
            println!("{}", project::run(rest)?);
            Ok(0)
        }
        "project" if rest.first().is_some_and(|s| s == "setup-agent") => {
            if rest.len() != 2 || rest[1].starts_with('-') {
                return Err("usage: neo project setup-agent NAME".into());
            }
            let resolved = project::run(&["resolve".into(), rest[1].clone()])?;
            let project: serde_json::Value =
                serde_json::from_str(&resolved).map_err(|_| "invalid project resolution JSON")?;
            let result = neo_harness_cli::project_setup::run(&project)?;
            println!(
                "{}",
                serde_json::to_string(&result).map_err(|e| e.to_string())?
            );
            Ok(0)
        }
        "project" if rest.first().is_some_and(|s| s == "tts") => {
            let response = neo_harness_cli::project_tts::run(&rest[1..])?;
            println!(
                "{}",
                serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
            );
            Ok(0)
        }
        "project" if rest.first().is_some_and(|s| s == "run") => {
            if let Some(value) = neo_harness_cli::run_live::run(&rest[1..])? {
                println!(
                    "{}",
                    serde_json::to_string(&value).map_err(|e| e.to_string())?
                );
            }
            Ok(0)
        }
        "mcp"
            if rest
                .first()
                .is_some_and(|s| matches!(s.as_str(), "tools" | "call")) =>
        {
            let (result, exit) = neo_harness_cli::mcp_local::mcp(rest)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?
            );
            Ok(exit)
        }
        "mcp" if rest.first().is_some_and(|s| s == "token") => {
            if rest[1..]
                .iter()
                .any(|s| matches!(s.as_str(), "--help" | "-h"))
            {
                println!("Usage: neo mcp token issue (--stdout | --output ABSOLUTE_PATH) [--origin HTTPS_URL] [--client-name NAME]\n       neo mcp token revoke --file ABSOLUTE_PATH [--origin HTTPS_URL]");
                return Ok(0);
            }
            let result = neo_harness_cli::mcp_token::run(&rest[1..])?;
            if let Some(secret) = result
                .get("access_token")
                .and_then(serde_json::Value::as_str)
            {
                println!("{secret}");
            } else {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?
                );
            }
            Ok(0)
        }
        "computer-use" => {
            let (result, exit) = neo_harness_cli::mcp_local::computer(rest)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?
            );
            Ok(exit)
        }
        "package" => {
            let result = neo_harness_cli::package::run(rest)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?
            );
            Ok(0)
        }
        "service" => {
            let (result, exit) = neo_harness_cli::service::run(rest)?;
            if let Some(value) = result {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?
                );
            }
            Ok(exit)
        }
        "escalation"
            if rest
                .first()
                .is_some_and(|s| matches!(s.as_str(), "cases" | "challenges")) =>
        {
            let value = neo_harness_cli::escalation_history::run(rest)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?
            );
            Ok(0)
        }
        "escalation" if rest == ["--help"] || rest == ["-h"] => {
            print!("{}", include_str!("../assets/escalation-help.txt"));
            Ok(0)
        }
        "escalation" if rest.first().is_some_and(|s| s == "test") => {
            if rest.len() != 1 {
                return Err("usage: neo escalation test".into());
            }
            let result = neo_harness_cli::escalation_self_test::run()?;
            println!(
                "{}",
                serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?
            );
            Ok(0)
        }
        "escalation" if rest.first().is_some_and(|s| s == "learn") => {
            if rest.len() != 1 {
                return Err("usage: neo escalation learn".into());
            }
            neo_harness_cli::escalation_learn::run()?;
            Ok(0)
        }
        "escalation" => {
            let result = neo_harness_cli::escalation_runtime::run_cli(rest)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?
            );
            Ok(if result["status"] == "failed" { 2 } else { 0 })
        }
        "eval" => neo_harness_cli::dynamic_extensions::eval(rest),
        "compute" | "gpu" => neo_harness_cli::dynamic_extensions::compute(rest),
        "status" | "doctor" => {
            let (text, status) = diagnostics::run(command, rest)?;
            println!("{text}");
            Ok(status)
        }
        "--help" | "-h" => {
            println!("Neo Harness Rust preview\n\n  neo-rs agent list [--project PATH] [--source project|global|shared|agency]\n  neo-rs agent search QUERY [--project PATH] [--source ...] [--limit N]\n  neo-rs skill list [--project PATH] | package SKILL_DIR OUTPUT.zip\n  neo-rs bootstrap [--json] [--project PATH]\n  neo-rs workspace show\n  neo-rs project list | resolve NAME | setup-agent NAME\n  neo-rs project run --project NAME [--url URL | --path PATH | --source SOURCE] [--dag NAME] [--dry-run] [--foreground] [--no-review]\n  neo-rs mcp tools | call TOOL --args-file PATH | token issue|revoke ...\n  neo-rs computer-use help | call COMMAND [--args-file PATH]\n  neo-rs escalation --handoff-file PATH [--cwd DIR] [--on-needs-user-file PATH] [--correlation-id ID]\n  neo-rs eval run|list|audit (optional Node Eval extension)\n  neo-rs compute|gpu build|run|web|services|doctor|cleanup (optional Node GPU extension)\n  neo-rs package stage ABSOLUTE_NEW_DIR\n  neo-rs status | doctor\n\nNative Run create/resume, specialty Vlog review, optional project-owned JS preflight and Relay foreground attach are supported. Other commands remain unsupported; installed neo remains unchanged.");
            Ok(0)
        }
        _ => Err(format!(
            "command '{}' not yet supported by neo-rs preview",
            command
        )),
    }
}

fn main() {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args
        .first()
        .is_some_and(|s| s == "__escalation-lock-guardian")
    {
        std::process::exit(neo_harness_cli::escalation_lock::guardian_main(&args[1..]));
    }
    match run(&args) {
        Ok(code) if code != 0 => std::process::exit(code),
        Ok(_) => {}
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
