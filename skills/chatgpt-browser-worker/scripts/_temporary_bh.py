import atexit
import json
import os
import re
import time

from browser_harness import *


CFG = json.load(open("__CFG_PATH__", encoding="utf-8"))
_OWNED_TABS = []


def _new_owned_tab(url):
    target_id = cdp("Target.createTarget", url="about:blank", background=True)["targetId"]
    switch_tab(target_id)
    _OWNED_TABS.append(target_id)
    if url != "about:blank":
        goto_url(url)
    return target_id


def _close_owned_tabs():
    while _OWNED_TABS:
        try:
            close_tab(_OWNED_TABS.pop())
        except Exception:
            pass


atexit.register(_close_owned_tabs)


def _click_exact(name, roles=()):
    nodes = cdp("Accessibility.getFullAXTree").get("nodes", [])
    matches = [
        node for node in nodes
        if node.get("name", {}).get("value") == name
        and (not roles or node.get("role", {}).get("value") in roles)
    ]
    if len(matches) != 1:
        raise RuntimeError(f"expected one accessible {name!r}, found {len(matches)}")
    backend_id = matches[0].get("backendDOMNodeId")
    box = cdp("DOM.getBoxModel", backendNodeId=backend_id).get("model", {}).get("content")
    if not box:
        raise RuntimeError(f"accessible {name!r} has no visible box")
    click_at_xy(sum(box[0::2]) / 4, sum(box[1::2]) / 4)


def _composer():
    selector = js("""(() => {
      const preferred = document.querySelector('#prompt-textarea');
      if (preferred) {
        const r=preferred.getBoundingClientRect();
        if (r.width>0 && r.height>0) return '#prompt-textarea';
      }
      const fallback = [...document.querySelectorAll('textarea,[contenteditable="true"]')]
        .find(e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && !e.disabled; });
      if (!fallback) return null;
      return fallback.tagName === 'TEXTAREA' ? 'textarea' : '[contenteditable="true"]';
    })()""")
    if not selector:
        raise RuntimeError("Temporary Chat composer was not observed")
    return selector


def _composer_text(selector):
    return js(f"""(() => {{
      const e=document.querySelector({json.dumps(selector)});
      return e ? ((e.innerText ?? e.value) || '') : '';
    }})()""") or ""


def _attachment_names():
    return js("""(() => [...document.querySelectorAll('button[aria-label^="Remove file"]')]
      .map(b => (b.getAttribute('aria-label') || '').replace(/^Remove file\s+\d+:\s*/, ''))
      .filter(Boolean))()""") or []


def _upload_files(paths):
    if not paths:
        return []
    selector = js("""(() => {
      for (const s of ['#upload-files','#upload-media','input[name="upload-media"]','input[type="file"]'])
        if (document.querySelector(s)) return s;
      return null;
    })()""")
    if not selector:
        raise RuntimeError("ChatGPT file input was not observed")
    for path in paths:
        if not os.path.isfile(path):
            raise RuntimeError(f"attachment does not exist: {path}")
        upload_file(selector, path)
        expected = os.path.basename(path)
        deadline = time.time() + 20
        while time.time() < deadline and expected not in _attachment_names():
            time.sleep(.25)
        if expected not in _attachment_names():
            raise RuntimeError(f"attachment was not observed ready: {expected}")
    return [os.path.basename(path) for path in paths]


def _assistant_messages():
    return js("""(() => [...document.querySelectorAll('[data-message-author-role="assistant"]')]
      .map(e => ({text:e.innerText.trim(), id:e.getAttribute('data-message-id') || ''}))
      .filter(e => e.text))()""") or []


def _user_turns():
    return js("""(() => [...document.querySelectorAll('[data-message-author-role="user"]')]
      .map(e => ({text:e.innerText.trim(), id:e.getAttribute('data-message-id') || ''}))
      .filter(e => e.text))()""") or []


def _is_generating():
    return bool(js("""(() => !![...document.querySelectorAll('button')].find(b => {
      const a=(b.getAttribute('aria-label')||'').toLowerCase();
      const t=(b.textContent||'').trim().toLowerCase();
      const id=(b.getAttribute('data-testid')||'').toLowerCase();
      return a.includes('stop answering') || a.includes('stop generating') || t === 'stop' || id.includes('stop');
    }))()"""))


def _click_send():
    ok = js("""(() => {
      const b=document.querySelector('button[data-testid="send-button"],button[aria-label="Send prompt"]');
      if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
      b.click(); return true;
    })()""")
    if not ok:
        raise RuntimeError("Temporary Chat Send prompt button was not observed ready")


def _thread_id():
    match = re.search(r"/c/([^/?#]+)", page_info().get("url", ""))
    if not match:
        raise RuntimeError("Temporary Chat did not expose a conversation thread id")
    return match.group(1)


def _wait_user_turn(before_count, prompt, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        turns = _user_turns()
        if len(turns) > before_count and prompt.strip() in turns[-1]["text"]:
            return turns[-1]
        time.sleep(.25)
    raise RuntimeError("Temporary Chat prompt did not become an observed user turn")


def _wait_result(timeout=240):
    deadline = time.time() + timeout
    candidate = None
    stable_since = None
    while time.time() < deadline:
        if _is_generating():
            candidate = None
            stable_since = None
            time.sleep(.25)
            continue
        messages = _assistant_messages()
        if not messages:
            time.sleep(.25)
            continue
        latest = messages[-1]
        sig = (latest.get("id"), latest.get("text"))
        if not latest.get("id") or not latest.get("text"):
            time.sleep(.25)
            continue
        if sig != candidate:
            candidate = sig
            stable_since = time.time()
            time.sleep(.25)
            continue
        if stable_since and time.time() - stable_since >= 1.5:
            return latest
        time.sleep(.25)
    raise RuntimeError("Temporary Chat assistant result was not observed stable and final before timeout")


_new_owned_tab("https://chatgpt.com/")
wait_for_load()
enabled = js("""(() => {
  const matches=[...document.querySelectorAll('button')].filter(
    b => (b.getAttribute('aria-label') || '').trim() === 'Temporary chat'
  );
  if (matches.length !== 1) return false;
  matches[0].click();
  return true;
})()""")
if not enabled:
    raise RuntimeError("Temporary Chat toggle was not uniquely observed")

deadline = time.time() + 20
while time.time() < deadline:
    if "temporary-chat=true" in page_info().get("url", ""):
        try:
            _composer()
            break
        except RuntimeError:
            pass
    time.sleep(.25)
else:
    raise RuntimeError("Temporary Chat mode did not become ready")

if CFG["thinking_level"] != "default":
    label = {"low": "Low", "medium": "Medium", "high": "High"}[CFG["thinking_level"]]
    _click_exact(label, roles=("button", "menuitem", "option"))

attachments = _upload_files(CFG.get("file", []))
selector = _composer()
before_count = len(_user_turns())
fill_input(selector, CFG["prompt"], clear_first=True)
if CFG["prompt"].strip() not in _composer_text(selector):
    info = js(f"""(() => {{
      const e=document.querySelector({json.dumps(selector)});
      const r=e.getBoundingClientRect();
      return {{x:r.x+r.width/2,y:r.y+r.height/2}};
    }})()""")
    click_at_xy(info["x"], info["y"])
    press_key("CTRL+A")
    type_text(CFG["prompt"])
if CFG["prompt"].strip() not in _composer_text(selector):
    raise RuntimeError("Temporary Chat prompt was not observed in the composer")
_click_send()
_wait_user_turn(before_count, CFG["prompt"])

deadline = time.time() + 20
while time.time() < deadline and "/c/" not in page_info().get("url", ""):
    time.sleep(.25)
thread_id = _thread_id()
message = _wait_result()

if CFG.get("expect_json"):
    try:
        json.loads(message["text"])
    except json.JSONDecodeError as exc:
        raise RuntimeError("Temporary Chat assistant result is not valid JSON") from exc

print(json.dumps({
    "operation": "temporary",
    "status": "completed",
    "thread_id": thread_id,
    "temporary": True,
    "attachments": attachments,
    "result": {
        "message_id": message["id"],
        "text": message["text"],
        "verified": True,
    },
}, ensure_ascii=False))
