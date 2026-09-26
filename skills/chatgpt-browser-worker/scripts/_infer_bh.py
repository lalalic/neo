import atexit
import json
import os
import re
import time

from browser_harness import *

CFG = json.load(open("__CFG_PATH__", encoding="utf-8"))
_OWNED_TABS = []



def _new_owned_tab(url):
    # Respect Browser Harness workspace adapters. A configured workspace may
    # override new_tab()/close_tab() to acquire and release only managed tabs;
    # raw Target.createTarget bypasses that boundary and is correctly refused.
    target_id = new_tab(url)
    _OWNED_TABS.append(target_id)
    return target_id


def _close_owned_tabs():
    while _OWNED_TABS:
        try:
            close_tab(_OWNED_TABS.pop())
        except Exception:
            pass


atexit.register(_close_owned_tabs)


def _composer():
    return js("""(() => {
      const preferred=document.querySelector('#prompt-textarea');
      if (preferred) {
        const r=preferred.getBoundingClientRect();
        if (r.width>0 && r.height>0) return '#prompt-textarea';
      }
      const fallback=[...document.querySelectorAll('textarea,[contenteditable="true"]')]
        .find(e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && !e.disabled; });
      if (!fallback) return null;
      if (fallback.id) return '#' + CSS.escape(fallback.id);
      return fallback.tagName === 'TEXTAREA' ? 'textarea' : '[contenteditable="true"]';
    })()""")


def _composer_text(selector):
    return js(f"""(() => {{
      const e=document.querySelector({json.dumps(selector)});
      return e ? ((e.innerText ?? e.value) || '') : '';
    }})()""") or ""


def _normalized(value):
    return re.sub(r"\s+", " ", value or "").strip()


def _attachments():
    return js(r"""(() => {
      const buttons=[...document.querySelectorAll('button[aria-label^="Remove file"]')];
      const names=buttons.map(b => (b.getAttribute('aria-label') || '').replace(/^Remove file\s+\d+:\s*/, '')).filter(Boolean);
      const visible=e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0; };
      const pendingSelector='[role="progressbar"], [aria-busy="true"], [data-state="loading"]';
      const pending=buttons.some(button => {
        let node=button.parentElement;
        for (let depth=0; node && depth<5; depth+=1, node=node.parentElement) {
          if ([...node.querySelectorAll(pendingSelector)].some(visible)) return true;
        }
        return false;
      });
      return {names, pending};
    })()""") or {"names": [], "pending": True}


def _send_state():
    return js("""(() => {
      const b=document.querySelector('button[data-testid="send-button"],button[aria-label="Send prompt"]');
      return {present:!!b, enabled:!!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true'};
    })()""") or {"present": False, "enabled": False}


def _assistant_messages():
    return js("""(() => [...document.querySelectorAll('[data-message-author-role="assistant"]')]
      .map(e => ({text:(e.innerText || '').trim(), id:e.getAttribute('data-message-id') || ''}))
      .filter(x => x.text))()""") or []


def _user_turns():
    return js("""(() => [...document.querySelectorAll('[data-message-author-role="user"]')]
      .map(e => ({text:(e.innerText || '').trim(), id:e.getAttribute('data-message-id') || ''}))
      .filter(x => x.text))()""") or []


def _is_generating():
    return bool(js("""(() => !![...document.querySelectorAll('button')].find(b => {
      const a=(b.getAttribute('aria-label')||'').toLowerCase();
      const t=(b.textContent||'').trim().toLowerCase();
      const id=(b.getAttribute('data-testid')||'').toLowerCase();
      return a.includes('stop answering') || a.includes('stop generating') || t === 'stop' || id.includes('stop');
    }))()"""))


def _parse_json_response(text):
    candidate=(text or "").strip()
    fenced=re.fullmatch(r"```(?:json)?\s*\n?(.*?)\n?```", candidate, flags=re.IGNORECASE | re.DOTALL)
    if fenced:
        candidate=fenced.group(1).strip()
    return json.loads(candidate)


def _page_failure():
    body=(js("document.body.innerText") or "").casefold()
    if "too many requests" in body:
        return "ChatGPT browser inference is temporarily rate limited"
    return None


def _enable_temporary_chat():
    clicked = js("""(() => {
      const matches=[...document.querySelectorAll('button')].filter(
        b => (b.getAttribute('aria-label') || '').trim() === 'Temporary chat'
      );
      if (matches.length !== 1) return false;
      matches[0].click();
      return true;
    })()""")
    if not clicked:
        raise RuntimeError("Temporary Chat toggle was not uniquely observed")
    deadline=time.time()+20
    while time.time() < deadline:
        if "temporary-chat=true" in page_info().get("url", "") and _composer():
            return
        time.sleep(.25)
    raise RuntimeError("Temporary Chat did not become ready")


def _upload_files(paths):
    if not paths:
        return []
    selector=js("""(() => {
      for (const s of ['#upload-files','#upload-media','input[name="upload-media"]','input[type="file"]'])
        if (document.querySelector(s)) return s;
      return null;
    })()""")
    if not selector:
        raise RuntimeError("ChatGPT file input was not observed")
    expected=[os.path.basename(p) for p in paths]
    for path in paths:
        if not os.path.isfile(path):
            raise RuntimeError(f"attachment does not exist: {path}")
        upload_file(selector, path)
    deadline=time.time()+120
    stable=0
    while time.time() < deadline:
        state=_attachments()
        if set(expected).issubset(state["names"]) and not state["pending"]:
            stable += 1
            if stable >= 2:
                return expected
        else:
            stable=0
        time.sleep(.25)
    raise RuntimeError(f"attachments did not become ready: {expected}")


def _fill_prompt(selector, prompt):
    fill_input(selector, prompt, clear_first=True)
    if _normalized(prompt) in _normalized(_composer_text(selector)):
        return
    info=js(f"""(() => {{
      const e=document.querySelector({json.dumps(selector)});
      if (!e) return null;
      const r=e.getBoundingClientRect();
      return {{x:r.x+r.width/2,y:r.y+r.height/2}};
    }})()""")
    if not info:
        raise RuntimeError("ChatGPT composer disappeared")
    click_at_xy(info["x"], info["y"])
    press_key("CTRL+A")
    type_text(prompt)
    if _normalized(prompt) not in _normalized(_composer_text(selector)):
        raise RuntimeError("prompt was not observed in composer")


def _submit(prompt, files):
    selector=_composer()
    if not selector:
        raise RuntimeError("ChatGPT composer was not observed")
    before=len(_user_turns())
    expected=_upload_files(files)
    _fill_prompt(selector, prompt)
    deadline=time.time()+120
    stable=0
    while time.time() < deadline:
        att=_attachments()
        send=_send_state()
        ready=(
            _normalized(prompt) in _normalized(_composer_text(selector))
            and set(expected).issubset(att["names"])
            and not att["pending"]
            and send["enabled"]
        )
        stable = stable + 1 if ready else 0
        if stable >= 2:
            break
        time.sleep(.25)
    else:
        raise RuntimeError("ChatGPT send readiness was not observed")
    clicked=js("""(() => {
      const b=document.querySelector('button[data-testid="send-button"],button[aria-label="Send prompt"]');
      if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
      b.click();
      return true;
    })()""")
    if not clicked:
        raise RuntimeError("ChatGPT send button changed before click")
    deadline=time.time()+30
    while time.time() < deadline:
        turns=_user_turns()
        if len(turns) > before and _normalized(prompt) in _normalized(turns[-1]["text"]):
            return
        time.sleep(.25)
    raise RuntimeError("submitted prompt did not become a durable user turn")


def _result(timeout):
    deadline=time.time()+timeout
    signature=None
    stable_since=None
    quiet_seconds=30 if CFG.get("expect_json") else 10
    while time.time() < deadline:
        failure=_page_failure()
        if failure:
            raise RuntimeError(failure)
        if _is_generating():
            signature=None
            stable_since=None
            time.sleep(.5)
            continue
        messages=_assistant_messages()
        if not messages:
            time.sleep(.5)
            continue
        latest=messages[-1]
        sig=(latest.get("id"), latest.get("text"))
        if sig != signature:
            signature=sig
            stable_since=time.time()
            time.sleep(.5)
            continue
        if not latest.get("text") or stable_since is None or time.time() - stable_since < quiet_seconds:
            time.sleep(.5)
            continue
        text=latest["text"].strip()
        if CFG.get("expect_json"):
            try:
                parsed=_parse_json_response(text)
            except json.JSONDecodeError:
                # A reasoning response can pause for a long time without exposing
                # a reliable streaming indicator. Never promote a stable JSON
                # prefix or prose-wrapped JSON to completion; keep observing until
                # the attempt timeout. A single whole-response JSON fence is the
                # only presentation wrapper accepted.
                time.sleep(.5)
                continue
            text=json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))
        return {"text": text, "message_id": latest.get("id") or None}
    raise RuntimeError("ChatGPT assistant result did not become complete before timeout")


_new_owned_tab("https://chatgpt.com/")
wait_for_load()
_enable_temporary_chat()
_submit(CFG["prompt"], CFG.get("file", []))
result=_result(CFG.get("result_timeout", 240))
print(json.dumps(result, ensure_ascii=False), flush=True)
