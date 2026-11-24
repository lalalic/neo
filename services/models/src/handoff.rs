//! Independently verify browser Project and user-authored receipt; read only.
use crate::{
    orchestrator::HandoffVerifier,
    store::{project_id, thread_id},
    webhelm::WebHelm,
    Result,
};
use serde_json::{json, Value};
use url::Url;

const INSPECT: &str = r#"return await (async () => {
  for (let i=0;i<80;i++) {
    const observed=await js("(() => ({url: location.href, conversation: !!document.querySelector('[role=region][aria-label=Conversation]'), error: /could not load this chatgpt conversation|conversation not found/i.test(document.body?.innerText||'') }))()");
    if(observed?.error||(observed?.conversation&&String(observed.url||'').includes('/g/g-p-')))return observed;
    await sleep(250);
  }
  return {conversation:false};
})()"#;

fn canonical(value: &Value, project: &str, thread: &str) -> bool {
    let Some(url) = value["url"].as_str().and_then(|s| Url::parse(s).ok()) else {
        return false;
    };
    let parts = url
        .path_segments()
        .map(|p| p.filter(|s| !s.is_empty()).collect::<Vec<_>>())
        .unwrap_or_default();
    url.scheme() == "https"
        && url.host_str() == Some("chatgpt.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && parts.len() == 4
        && parts[0] == "g"
        && parts[2] == "c"
        && (parts[1] == project || parts[1].starts_with(&format!("{project}-")))
        && parts[3] == thread
}
impl HandoffVerifier for WebHelm {
    fn verify(&self, project: &str, c: &Value) -> Result<()> {
        let previous = c["previousThreadId"]
            .as_str()
            .filter(|s| thread_id(s))
            .ok_or("invalid predecessor")?;
        let next = c["nextThreadId"]
            .as_str()
            .filter(|s| thread_id(s))
            .ok_or("invalid successor")?;
        let generation = c["expectedGeneration"]
            .as_u64()
            .ok_or("invalid handoff generation")?;
        let receipt = c["handoffReceipt"]
            .as_str()
            .filter(|s| {
                (16..=128).contains(&s.len())
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            })
            .ok_or("invalid handoff receipt")?;
        if !project_id(project) || previous == next {
            return Err("invalid handoff identities".into());
        }
        for thread in [previous, next] {
            let observed = self.inspect(thread, INSPECT)?;
            if observed["conversation"] != true
                || observed["error"] == true
                || !canonical(&observed, project, thread)
            {
                return Err("Orchestrator thread not loaded in verified Project".into());
            }
        }
        let markers = json!([
            "neo.orchestrator.handoff.v1",
            format!("previousThreadId={previous}"),
            format!("expectedGeneration={generation}"),
            format!("handoffReceipt={receipt}")
        ]);
        let expression = format!(
            r#"(() => {{
            const marks={markers};
            return [...document.querySelectorAll('[data-message-author-role="user"], [data-conversation-role="user"]')].some(element=>{{
                const bubble=element.matches('h4[data-conversation-role="user"]')?element.parentElement?.querySelector('.bg-user-message'):element;
                const text=bubble?.textContent||'';
                return marks.every(mark=>text.includes(mark));
            }});
        }})()"#
        );
        let script = format!(
            r#"return await (async()=>{{
            let latest={{receiptMatches:false,url:''}};
            for(let i=0;i<80;i++){{
                const receiptMatches=await js({});
                const url=(await page_info()).url;
                latest={{receiptMatches,url}};
                const p=String(url||'').split(/[?#]/,1)[0].split('/').filter(Boolean);
                if(receiptMatches&&p.length===6&&p[0]==='https:'&&p[1]==='chatgpt.com'&&p[2]==='g'&&p[4]==='c'&&(p[3]==={}||p[3].startsWith({}))&&p[5]==={})break;
                await sleep(250);
            }}
            return latest;
        }})()"#,
            json!(expression),
            json!(project),
            json!(format!("{project}-")),
            json!(next)
        );
        let observed = self.inspect(next, &script)?;
        if observed["receiptMatches"] != true || !canonical(&observed, project, next) {
            return Err("Successor user turn lacks independently verified handoff receipt".into());
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn verifies_exact_project_and_thread() {
        let p = "g-p-testproject";
        let t = "thread12345";
        assert!(canonical(
            &json!({"url":format!("https://chatgpt.com/g/{p}-slug/c/{t}")}),
            p,
            t
        ));
        for url in [
            format!("https://chatgpt.com/c/{t}"),
            format!("https://chatgpt.com/g/{p}evil/c/{t}"),
            format!("https://chatgpt.com.evil/g/{p}/c/{t}"),
            format!("https://user@chatgpt.com/g/{p}/c/{t}"),
            format!("https://chatgpt.com/g/{p}/c/otherthread"),
        ] {
            assert!(!canonical(&json!({"url":url}), p, t));
        }
    }
}
