use serde_json::{json, Value};
pub fn list(codex: bool) -> Value {
    if codex {
        serde_json::from_str(include_str!("codex-catalog.json")).expect("committed Codex catalog")
    } else {
        json!({"object":"list","data":[{"id":"neo","object":"model","owned_by":"neo"}]})
    }
}
