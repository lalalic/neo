mod agent;
mod bootstrap;
mod diagnostics;
mod project;
mod skill;
mod workspace;

use std::env;

fn run(args: &[String]) -> Result<i32, String> {
    let (command, rest) = args
        .split_first()
        .ok_or_else(|| "usage: neo --help".to_string())?;
    match command.as_str() {
        "setup" => {
            let result = neo_harness_cli::setup::run(rest)?;
            println!("{}", serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?);
            Ok(if result["ok"] == true { 0 } else { 1 })
        }
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
        "eval" => neo_harness_cli::eval::run(rest),
        "compute" => neo_harness_cli::compute::run(rest),
        "gpu" => Err("The obsolete `neo gpu` alias was removed. Use `neo compute` instead.".into()),
        "status" | "doctor" => {
            let (text, status) = diagnostics::run(command, rest)?;
            println!("{text}");
            Ok(status)
        }
        "--help" | "-h" => {
            println!("Neo Harness — native Rust CLI\n\n  neo agent list [--project PATH] [--source project|global|shared|agency]\n  neo agent search QUERY [--project PATH] [--source ...] [--limit N]\n  neo skill list [--project PATH] | package SKILL_DIR OUTPUT.zip\n  neo bootstrap [--json] [--project PATH]\n  neo workspace show\n  neo project list | resolve NAME | setup-agent NAME\n  neo project run --project NAME [--url URL | --path PATH | --source SOURCE] [--dag NAME] [--dry-run] [--foreground] [--no-review]\n  neo mcp tools | call TOOL --args-file PATH | token issue|revoke ...\n  neo computer-use help | call COMMAND [--args-file PATH]\n  neo escalation --handoff-file PATH [--cwd DIR] [--on-needs-user-file PATH] [--correlation-id ID]\n  neo eval run|list|audit (native Rust Eval using canonical Relay PromptBuilder)\n  neo compute build|run|web|services|doctor|cleanup (native Rust; paid actions require explicit authorization)\n  neo setup code-tools\n  neo package stage ABSOLUTE_NEW_DIR\n  neo service list | status NAME | start NAME | stop NAME | restart NAME\n  neo escalation cases | challenges | test | learn\n  neo project tts --help\n  neo status | doctor\n\nNative Run create/resume, specialty Vlog review, optional project-owned JS preflight and Relay foreground attach are supported. ");
            Ok(0)
        }
        _ => Err(format!("command '{}' not yet supported by neo", command)),
    }
}

fn main() {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.first().is_some_and(|s| s == "__compute-watchdog") {
        std::process::exit(args.get(1).map_or(2, |path| {
            neo_harness_cli::compute::watchdog(std::path::Path::new(path))
        }));
    }
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
