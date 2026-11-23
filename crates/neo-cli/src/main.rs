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
        "project" if rest.first().is_some_and(|s| s == "run") => {
            let preview = neo_harness_cli::run_dry::run(&rest[1..])?;
            println!(
                "{}",
                serde_json::to_string(&preview).map_err(|e| e.to_string())?
            );
            Ok(0)
        }
        "status" | "doctor" => {
            let (text, status) = diagnostics::run(command, rest)?;
            println!("{text}");
            Ok(status)
        }
        "--help" | "-h" => {
            println!("Neo Harness Rust preview\n\n  neo-rs agent list [--project PATH] [--source project|global|shared|agency]\n  neo-rs agent search QUERY [--project PATH] [--source ...] [--limit N]\n  neo-rs skill list [--project PATH]\n  neo-rs bootstrap [--json] [--project PATH]\n  neo-rs workspace show\n  neo-rs project list | resolve NAME\n  neo-rs project run --dry-run --project NAME [--url URL | --path PATH | --source SOURCE] [--dag NAME]\n  neo-rs status | doctor\n\nActual Run execution and remaining commands are not yet supported; installed neo remains unchanged.");
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
    match run(&args) {
        Ok(code) if code != 0 => std::process::exit(code),
        Ok(_) => {}
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
