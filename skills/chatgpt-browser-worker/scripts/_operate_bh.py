import atexit
import json
import os
import time

from browser_harness import *


_OWNED_TABS = []


def _owned_target_id(target):
    if isinstance(target, str):
        return target
    if isinstance(target, dict):
        return target.get("targetId") or target.get("target_id")
    return None


def _new_owned_tab(url):
    target_id = cdp("Target.createTarget", url="about:blank", background=True)["targetId"]
    switch_tab(target_id)
    _OWNED_TABS.append(target_id)
    if url != "about:blank":
        goto_url(url)
    return target_id


def _close_owned_tabs():
    while _OWNED_TABS:
        target_id = _OWNED_TABS.pop()
        try:
            close_tab(target_id)
        except Exception:
            pass


def _canonical_thread_url():
    suffix = f"/c/{THREAD_ID}"
    candidates = []
    try:
        tabs = list_tabs()
        if isinstance(tabs, list):
            for tab in tabs:
                if not isinstance(tab, dict):
                    continue
                url = tab.get("url") or ""
                if suffix in url:
                    candidates.append(url.split("#", 1)[0])
    except Exception:
        pass

    try:
        hrefs = js(f"""(() => [...document.querySelectorAll('a[href]')]
          .map(a => a.href)
          .filter(h => h.includes({json.dumps(suffix)})))()""") or []
        for href in hrefs:
            if isinstance(href, str):
                candidates.append(href.split("#", 1)[0])
    except Exception:
        pass

    unique = []
    for url in candidates:
        if url not in unique:
            unique.append(url)
    project_urls = [url for url in unique if "/g/g-p-" in url]
    if project_urls:
        return project_urls[0]
    if unique:
        return unique[0]
    return f"https://chatgpt.com/c/{THREAD_ID}"



atexit.register(_close_owned_tabs)

CFG = json.load(open("__CFG_PATH__", encoding="utf-8"))
THREAD_ID = CFG["thread_id"]


def _visible(selector):
    return js(f"""(() => [...document.querySelectorAll({json.dumps(selector)})]
      .filter(e => {{ const r=e.getBoundingClientRect(); return r.width>0 && r.height>0; }}).length)()""") or 0


def _composer():
    selector = js("""(() => {
      const preferred = [...document.querySelectorAll('[contenteditable="true"]')]
        .filter(e => e.id === 'prompt-textarea' || /chat/i.test(e.getAttribute('aria-label') || ''))
        .find(e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0; });
      if (preferred) return preferred.id ? '#' + CSS.escape(preferred.id) : '[contenteditable="true"]';
      const fallback = [...document.querySelectorAll('textarea')]
        .find(e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && !e.disabled; });
      if (!fallback) return null;
      if (fallback.id) return '#' + CSS.escape(fallback.id);
      if (fallback.name) return `textarea[name=${JSON.stringify(fallback.name)}]`;
      return 'textarea';
    })()""")
    if not selector:
        raise RuntimeError("ChatGPT composer was not observed")
    return selector


def _composer_text(selector):
    return js(f"""(() => {{ const e=document.querySelector({json.dumps(selector)}); return e ? ((e.innerText ?? e.value) || '') : ''; }})()""") or ""


def _assistant_messages():
    return js("""(() => [...document.querySelectorAll('[data-message-author-role="assistant"]')]
      .map(e => ({text: e.innerText.trim(), id: e.getAttribute('data-message-id') || ''}))
      .filter(e => e.text))()""") or []


def _user_turns():
    return js("""(() => [...document.querySelectorAll('[data-message-author-role="user"]')]
      .map(e => ({text: e.innerText.trim(), html: e.innerHTML, id: e.getAttribute('data-message-id') || ''})))()""") or []


def _is_generating():
    return bool(js("""(() => !![...document.querySelectorAll('button')].find(b => {
      const a=(b.getAttribute('aria-label')||'').toLowerCase();
      const t=(b.textContent||'').trim().toLowerCase();
      const id=(b.getAttribute('data-testid')||'').toLowerCase();
      return a.includes('stop answering') || a.includes('stop generating') || t === 'stop' || id.includes('stop');
    }))()"""))


def _send_ready():
    return bool(js("""(() => {
      const b=document.querySelector('button[data-testid="send-button"],button[aria-label="Send prompt"]');
      return !!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
    })()"""))


def _click_send():
    ok = js("""(() => {
      const b=document.querySelector('button[data-testid="send-button"],button[aria-label="Send prompt"]');
      if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
      b.click(); return true;
    })()""")
    if not ok:
        raise RuntimeError("ChatGPT Send prompt button was not observed ready")


def _attachment_names():
    return js("""(() => [...document.querySelectorAll('button[aria-label^="Remove file"]')]
      .map(b => (b.getAttribute('aria-label') || '').replace(/^Remove file\\s+\\d+:\\s*/, ''))
      .filter(Boolean))()""") or []


def _upload_files(paths):
    if not paths:
        return []
    selector = js("""(() => {
      const candidates=['#upload-files','#upload-media','input[name="upload-media"]','input[type="file"]'];
      for (const s of candidates) if (document.querySelector(s)) return s;
      return null;
    })()""")
    if not selector:
        raise RuntimeError("ChatGPT file input was not observed")
    before = list(_attachment_names())
    for path in paths:
        if not os.path.isfile(path):
            raise RuntimeError(f"attachment does not exist: {path}")
        upload_file(selector, path)
        deadline = time.time() + 20
        expected = os.path.basename(path)
        while time.time() < deadline:
            names = _attachment_names()
            if expected in names:
                break
            time.sleep(.25)
        else:
            raise RuntimeError(f"attachment was not observed ready: {expected}")
    names = _attachment_names()
    requested = [os.path.basename(path) for path in paths]
    for name in requested:
        if name not in names:
            raise RuntimeError(f"requested attachment was not observed: {name}")
    return requested


def _wait_for_new_user_turn(before_count, prompt, attachments, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        turns = _user_turns()
        if len(turns) > before_count:
            latest = turns[-1]
            prompt_ok = prompt.strip() in latest.get("text", "")
            html = latest.get("html", "")
            attachment_ok = all(name in html or name in latest.get("text", "") for name in attachments)
            # ChatGPT may not render filenames into turn HTML; composer attachment disappearance
            # plus a new durable turn is accepted as attachment submission evidence.
            if prompt_ok and (not attachments or attachment_ok or not _attachment_names()):
                return latest
        time.sleep(.25)
    raise RuntimeError("submitted prompt did not become a durable user turn")


def _send_turn(prompt, files):
    selector = _composer()
    before_count = len(_user_turns())
    attachment_names = _upload_files(files)
    fill_input(selector, prompt, clear_first=True)
    if prompt.strip() not in _composer_text(selector):
        # contenteditable surfaces can coexist with hidden textareas; use physical input fallback.
        info = js(f"""(() => {{ const e=document.querySelector({json.dumps(selector)}); const r=e.getBoundingClientRect(); return {{x:r.x+r.width/2,y:r.y+r.height/2}}; }})()""")
        click_at_xy(info["x"], info["y"])
        press_key("CTRL+A")
        type_text(prompt)
    deadline = time.time() + 20
    while time.time() < deadline and not _send_ready():
        time.sleep(.25)
    _click_send()
    turn = _wait_for_new_user_turn(before_count, prompt, attachment_names)
    return {
        "verified": True,
        "user_turn_observed": True,
        "user_message_id": turn.get("id") or None,
        "attachment_names": attachment_names,
        "prompt_observed": True,
    }


def _stable_assistant_result(timeout=30):
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
        if stable_since and time.time() - stable_since >= 1.5 and _composer():
            return latest
        time.sleep(.25)
    raise RuntimeError("ChatGPT assistant result was not observed stable and final before timeout")


def _cleanup():
    url = page_info().get("url", "")
    if f"/c/{THREAD_ID}" not in url:
        raise RuntimeError("browser is not on the requested durable thread")
    opened = js("""(() => { const bs=[...document.querySelectorAll('button[aria-label="More"],button[aria-label="More options"]')]
      .filter(b=>{const r=b.getBoundingClientRect();return r.width&&r.height}); if(bs.length!==1)return false; bs[0].click(); return true; })()""")
    if not opened: raise RuntimeError("thread actions menu was not uniquely observed")
    time.sleep(.2)
    selected = js("""(() => { const xs=[...document.querySelectorAll('[role="menuitem"]')].filter(x=>/^Delete( chat)?$/.test((x.textContent||'').trim())); if(xs.length!==1)return false; xs[0].click(); return true; })()""")
    if not selected: raise RuntimeError("ChatGPT delete action was not uniquely observed")
    time.sleep(.2)
    confirmed = js("""(() => { const ds=[...document.querySelectorAll('[role="dialog"]')]; for(const d of ds){const bs=[...d.querySelectorAll('button')].filter(b=>/^Delete( chat)?$/.test((b.textContent||'').trim())); if(bs.length===1){bs[0].click();return true}} return false; })()""")
    if not confirmed: raise RuntimeError("ChatGPT delete confirmation was not observed")
    time.sleep(.5)
    return {"thread_id": THREAD_ID, "outcome": "deleted", "verified": True, "url_after": page_info().get("url", "")}


def _wait_thread_ready(*, require_composer=False, timeout=60):
    deadline = time.time() + timeout
    project = CFG["project"].casefold()
    last = {}
    while time.time() < deadline:
        info = page_info()
        url = info.get("url", "")
        body = js("document.body.innerText") or ""
        ready_state = js("document.readyState") or ""
        exact_thread = f"/c/{THREAD_ID}" in url
        project_ok = project in body.casefold() or project in info.get("title", "").casefold()
        composer_count = _visible('textarea,[contenteditable="true"]')
        user_count = int(js("document.querySelectorAll('[data-message-author-role=\"user\"]').length") or 0)
        assistant_count = int(js("document.querySelectorAll('[data-message-author-role=\"assistant\"]').length") or 0)
        conversation_ready = composer_count > 0 or user_count > 0 or assistant_count > 0
        composer_ready = composer_count > 0
        last = {
            "url": url,
            "ready_state": ready_state,
            "exact_thread": exact_thread,
            "project_ok": project_ok,
            "composer_count": composer_count,
            "user_count": user_count,
            "assistant_count": assistant_count,
        }
        if (
            ready_state == "complete"
            and exact_thread
            and project_ok
            and conversation_ready
            and (not require_composer or composer_ready)
        ):
            return last
        time.sleep(.5)
    raise RuntimeError(f"ChatGPT thread did not become fully ready before timeout: {last}")


ensure_real_tab()
operation = CFG["operation"]

# Sending is intentionally isolated: every send/follow-up gets a fresh owned tab,
# never reuses a user's existing ChatGPT tab, and that owned tab is closed at exit.
if operation in {"send", "continue"}:
    _new_owned_tab(_canonical_thread_url())
    wait_for_load()
    _wait_thread_ready(require_composer=True)
else:
    if f"/c/{THREAD_ID}" not in page_info().get("url", ""):
        _new_owned_tab(_canonical_thread_url())
        wait_for_load()
    _wait_thread_ready(require_composer=operation in {"resume"})

base = {"thread_id": THREAD_ID, "conversation_url": page_info().get("url"), "project": {"name": CFG["project"]}}
if operation == "delete":
    print(json.dumps(_cleanup(), ensure_ascii=False))
elif operation == "continue":
    print(json.dumps({**base, **_send_turn(CFG["prompt"], [])}, ensure_ascii=False))
elif operation == "send":
    print(json.dumps({**base, **_send_turn(CFG["prompt"], CFG.get("file", []))}, ensure_ascii=False))
elif operation == "status":
    messages = _assistant_messages()
    status = "running" if _is_generating() else ("awaiting_result" if not messages else "completed")
    print(json.dumps({**base, "status": status, "assistant_message_count": len(messages)}, ensure_ascii=False))
elif operation == "result":
    message = _stable_assistant_result()
    if CFG.get("expect_json"):
        try:
            json.loads(message["text"])
        except json.JSONDecodeError as exc:
            raise RuntimeError("assistant result is not valid JSON") from exc
    print(json.dumps({**base, "status": "completed", "text": message["text"], "message_id": message["id"]}, ensure_ascii=False))
else:
    print(json.dumps({**base, "status": "completed" if _assistant_messages() else "awaiting_result"}, ensure_ascii=False))
