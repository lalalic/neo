//! Native Models Gateway. This crate is not yet a production replacement.
pub mod attachments;
pub mod catalog;
pub mod engine;
pub mod http;
pub mod input;
pub mod nats;
pub mod orchestrator;
pub mod orchestrator_client;
pub mod reply;
pub mod sse;
pub mod store;
pub mod webhelm;
pub type Result<T> = std::result::Result<T, String>;
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn key() -> Result<String> {
    let mut bytes = [0u8; 20];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
