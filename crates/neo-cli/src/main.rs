mod agent;
mod workspace;

use std::env;

fn run(args: &[String]) -> Result<(), String> {
    let (command, rest) = args.split_first().ok_or_else(|| {
        "usage: neo-rs agent list|search ... (other native commands not yet supported)".to_string()
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
            Ok(())
        }
        "--help" | "-h" => {
            println!("Neo Harness Rust preview\n\n  neo-rs agent list [--project PATH] [--source project|global|shared|agency]\n  neo-rs agent search QUERY [--project PATH] [--source ...] [--limit N]\n\nOther commands are not yet supported; installed neo remains unchanged.");
            Ok(())
        }
        _ => Err(format!(
            "command '{}' not yet supported by neo-rs preview",
            command
        )),
    }
}

fn main() {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if let Err(error) = run(&args) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
