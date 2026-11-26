//! CLI frontend for Neo's WebChat/XChat Harness Builder.
use crate::xchat_builder;
use std::path::Path;

pub fn run(args: &[String], root: &Path) -> Result<String, String> {
    let (manifest, is_json) = xchat_builder::build(args, root)?;
    if is_json {
        Ok(serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())? + "\n")
    } else {
        Ok(xchat_builder::render(&manifest))
    }
}
