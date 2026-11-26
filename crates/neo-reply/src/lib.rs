//! Neo Harness reply protocol. Consumers own request state and delivery;
//! the Events Bus does not interpret this contract.
use serde_json::Value;

#[derive(Debug, PartialEq, Eq)]
pub enum Payload<'a> {
    Text { seq: u64, text: &'a str },
    Heartbeat,
    Completed,
    Failed { error: &'a str },
}
#[derive(Debug, PartialEq, Eq)]
pub struct Reply<'a> {
    pub channel: &'a str,
    pub request_id: &'a str,
    pub payload: Payload<'a>,
}
fn token(value: &str) -> bool {
    value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}
fn channel_valid(value: &str) -> bool {
    (1..=32).contains(&value.len())
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
pub fn parse_source(source: &str) -> Result<(&str, &str), String> {
    let (channel, id) = source
        .strip_prefix("reply/")
        .and_then(|v| v.split_once('/'))
        .ok_or("invalid reply source")?;
    if !channel_valid(channel) || !(8..=100).contains(&id.len()) || !token(id) {
        return Err("invalid reply source".into());
    }
    Ok((channel, id))
}
/// Resolve the deployed reply subject namespace from transport configuration.
pub fn subject_prefix(configured: &str) -> Result<String, String> {
    if !configured.split('.').all(|v| !v.is_empty() && token(v)) {
        return Err("invalid NATS subject prefix".into());
    }
    Ok(format!(
        "{}.reply",
        configured.strip_suffix(".job").unwrap_or(configured)
    ))
}
fn bounded_text(value: &Value, max: usize) -> Option<&str> {
    value
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.encode_utf16().count() <= max)
}
/// Validate a transport event and correlate its subject. Channel-specific
/// request-ID format, ordering, deduplication and terminal state stay with
/// the caller.
pub fn validate<'a>(subject: &str, prefix: &str, event: &'a Value) -> Result<Reply<'a>, String> {
    let source = event
        .pointer("/source/id")
        .and_then(Value::as_str)
        .ok_or("invalid reply source")?;
    let (channel, request_id) = parse_source(source)?;
    if subject != format!("{prefix}.{channel}.{request_id}") {
        return Err("reply subject mismatch".into());
    }
    let kind = event["type"].as_str().ok_or("invalid reply type")?;
    let data = event["data"]
        .as_object()
        .ok_or("reply data must be object")?;
    let keys: &[&str] = match kind {
        "reply.text" => &["text", "seq"],
        "reply.failed" => &["error"],
        "reply.completed" | "reply.heartbeat" => &[],
        _ => return Err("unsupported reply type".into()),
    };
    if data.keys().any(|k| !keys.contains(&k.as_str())) {
        return Err("unsupported reply data field".into());
    }
    let payload = match kind {
        "reply.text" => Payload::Text {
            seq: event["data"]["seq"]
                .as_u64()
                .filter(|n| *n > 0 && *n <= 9_007_199_254_740_991)
                .ok_or("invalid reply sequence")?,
            text: bounded_text(&event["data"]["text"], 100_000)
                .ok_or("reply.text needs bounded text")?,
        },
        "reply.heartbeat" => Payload::Heartbeat,
        "reply.completed" => Payload::Completed,
        "reply.failed" => Payload::Failed {
            error: bounded_text(&event["data"]["error"], 1000)
                .ok_or("actual failure reason required")?,
        },
        _ => unreachable!(),
    };
    Ok(Reply {
        channel,
        request_id,
        payload,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    const PREFIX: &str = "relay.events.reply";
    const SUBJECT: &str = "relay.events.reply.models/unused";
    fn envelope(kind: &str, data: Value) -> Value {
        json!({"type":kind,"source":{"id":"reply/voice/request-123"},"data":data})
    }
    #[test]
    fn valid_shared_reply_contract() {
        let subject = "relay.events.reply.voice.request-123";
        let text = envelope("reply.text", json!({"seq":1,"text":"hello"}));
        let parsed = validate(subject, PREFIX, &text).unwrap();
        assert_eq!(parsed.channel, "voice");
        assert_eq!(parsed.request_id, "request-123");
        assert_eq!(
            parsed.payload,
            Payload::Text {
                seq: 1,
                text: "hello"
            }
        );
        for (kind, expected) in [
            ("reply.heartbeat", Payload::Heartbeat),
            ("reply.completed", Payload::Completed),
        ] {
            assert_eq!(
                validate(subject, PREFIX, &envelope(kind, json!({})))
                    .unwrap()
                    .payload,
                expected
            );
        }
        assert_eq!(
            validate(
                subject,
                PREFIX,
                &envelope("reply.failed", json!({"error":"actual reason"}))
            )
            .unwrap()
            .payload,
            Payload::Failed {
                error: "actual reason"
            }
        );
    }
    #[test]
    fn rejects_invalid_sources_and_payloads() {
        let subject = "relay.events.reply.voice.request-123";
        let text = envelope("reply.text", json!({"seq":1,"text":"hello"}));
        assert!(validate(SUBJECT, PREFIX, &text).is_err());
        for source in [
            "reply/Voice/request-123",
            "reply/voice/short",
            "reply/voice/request/123",
            "reply/voice/unsafe.*",
        ] {
            assert!(parse_source(source).is_err());
        }
        for (kind, data) in [
            ("reply.text", json!({"seq":0,"text":"bad"})),
            (
                "reply.text",
                json!({"seq":9007199254740992u64,"text":"bad"}),
            ),
            ("reply.text", json!({"seq":1,"text":"  "})),
            ("reply.text", json!({"seq":1,"text":"x".repeat(100001)})),
            ("reply.completed", json!({"text":"invalid"})),
            ("reply.failed", json!({"error":""})),
            ("reply.heartbeat", json!([])),
            ("reply.unknown", json!({})),
        ] {
            assert!(validate(subject, PREFIX, &envelope(kind, data)).is_err());
        }
    }
    #[test]
    fn subject_namespace_preserves_existing_config() {
        assert_eq!(
            subject_prefix("relay.events.job").unwrap(),
            "relay.events.reply"
        );
        assert_eq!(
            subject_prefix("custom.events").unwrap(),
            "custom.events.reply"
        );
        assert!(subject_prefix("invalid..prefix").is_err());
        assert!(subject_prefix("invalid.*").is_err());
    }
}
