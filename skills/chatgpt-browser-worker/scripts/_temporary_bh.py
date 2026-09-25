import atexit
import json
import os
import re
import time
import uuid
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from browser_harness import *


CFG = json.load(open("__CFG_PATH__", encoding="utf-8"))
_OWNED_TABS = []
_KEEP_OWNED_TAB_OPEN = CFG.get("close_policy", "after-start") == "never"


def _collision_safe_url(url):
    parts = urlsplit(url)
    query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key != "neo_owned_tab"
    ] + [("neo_owned_tab", uuid.uuid4().hex)]
    return urlunsplit(parts._replace(query=urlencode(query)))


def _new_owned_tab(url):
    # Respect Browser Harness workspace adapters. A configured workspace may
    # override new_tab()/close_tab() to acquire and release only managed tabs;
    # raw Target.createTarget bypasses that boundary and is correctly refused.
    target_id = new_tab(_collision_safe_url(url))
    _OWNED_TABS.append(target_id)
    return target_id


def _close_owned_tabs():
    if _KEEP_OWNED_TAB_OPEN:
        return
    while _OWNED_TABS:
        try:
            close_tab(_OWNED_TABS.pop())
        except Exception:
            pass


atexit.register(_close_owned_tabs)


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


def _wait_for_composer(timeout=30):
    def read_selector():
        try:
            return _composer()
        except RuntimeError:
            return None

    return wait_until_stable(
        lambda: {"selector": read_selector()},
        lambda state: bool(state["selector"]),
        timeout=timeout,
        phase="composer readiness",
    )["selector"]


def _same_text(observed, expected):
    normalize = lambda value: re.sub(r"\\s+", " ", value or "").strip()
    return normalize(expected) in normalize(observed)


def _normalized_text(value):
    return re.sub(r"\s+", " ", value or "").strip()


def _temporary_chat_candidates():
    return js(r"""(() => [...document.querySelectorAll('button')].map((b, index) => {
      const label=(b.getAttribute('aria-label') || '').trim();
      const text=(b.innerText || '').trim();
      const semantic=/temporary/i.test(label + ' ' + text) && /chat/i.test(label + ' ' + text);
      if (!semantic) return null;
      const r=b.getBoundingClientRect();
      const style=getComputedStyle(b);
      return {
        index,
        label,
        text,
        visible:r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
        disabled:!!b.disabled || b.getAttribute('aria-disabled') === 'true',
        pointerEvents:style.pointerEvents,
      };
    }).filter(Boolean))()""") or []


def _temporary_chat_enabled():
    return temporary_chat_enabled_state(
        page_info().get("url", ""),
        _temporary_chat_candidates(),
    )


def _click_temporary_chat_toggle(timeout=20):
    deadline = time.time() + timeout
    last_candidates = []
    while time.time() < deadline:
        if _temporary_chat_enabled():
            return "already-enabled"
        last_candidates = _temporary_chat_candidates()
        actionable = actionable_temporary_chat_candidates(last_candidates)
        if len(actionable) == 1:
            clicked = js(f"""(() => {{
              const b=[...document.querySelectorAll('button')][{int(actionable[0]["index"])}];
              if (!b) return false;
              const r=b.getBoundingClientRect();
              const style=getComputedStyle(b);
              if (!(r.width > 0 && r.height > 0) || b.disabled ||
                  b.getAttribute('aria-disabled') === 'true' || style.pointerEvents === 'none') return false;
              b.click();
              return true;
            }})()""")
            if clicked:
                return "clicked"
        elif len(actionable) > 1:
            labels = [candidate.get("label") or candidate.get("text") or "<unnamed>" for candidate in actionable]
            raise RuntimeError(f"Temporary Chat toggle is ambiguous: {len(actionable)} actionable controls {labels}")
        time.sleep(.25)
    raise RuntimeError(
        "Temporary Chat toggle was not actionable after "
        f"{timeout}s; semantic candidates={last_candidates}"
    )


def _attachment_names():
    return js(r"""(() => [...document.querySelectorAll('button[aria-label^="Remove file"]')]
      .map(b => (b.getAttribute('aria-label') || '').replace(/^Remove file\s+\d+:\s*/, ''))
      .filter(Boolean))()""") or []


def _attachment_state():
    return js(r"""(() => {
      const names = [...document.querySelectorAll('button[aria-label^="Remove file"]')]
        .map(b => (b.getAttribute('aria-label') || '').replace(/^Remove file\s+\d+:\s*/, ''))
        .filter(Boolean);
      const pending = [...document.querySelectorAll(
        '[role="progressbar"], [aria-busy="true"], [data-state="loading"]'
      )].some(e => {
        const r=e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      return {names, pending};
    })()""") or {"names": [], "pending": True}


def _send_state():
    return js(r"""(() => {
      const b=document.querySelector('button[data-testid="send-button"],button[aria-label="Send prompt"],button[aria-label="Send"]');
      return {present: !!b, enabled: !!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true'};
    })()""") or {"present": False, "enabled": False}


def _wait_for_attachments(expected, timeout=45):
    expected = set(expected)
    wait_until_stable(
        _attachment_state,
        lambda state: expected.issubset(state["names"]) and not state["pending"],
        timeout=timeout,
        phase="attachment upload readiness",
    )


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
    expected = [os.path.basename(path) for path in paths]
    if expected:
        # Presence is a selection signal; upload readiness is checked separately.
        wait_until_stable(
            _attachment_state,
            lambda state: set(expected).issubset(state["names"]),
            timeout=30,
            phase="attachment presence",
        )
        _wait_for_attachments(expected)
    return expected


def _user_turns():
    return js("""(() => [...document.querySelectorAll('[data-message-author-role="user"]')]
      .map(e => ({text:e.innerText.trim(), id:e.getAttribute('data-message-id') || ''}))
      .filter(e => e.text))()""") or []


def _click_send():
    ok = js("""(() => {
      const b=document.querySelector('button[data-testid="send-button"],button[aria-label="Send prompt"],button[aria-label="Send"]');
      if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
      b.click(); return true;
    })()""")
    if not ok:
        raise RuntimeError("Temporary Chat send readiness changed before click")


def _wait_for_send_ready(selector, prompt, attachments):
    expected = set(attachments)

    def read_state():
        return {
            "text": _composer_text(selector),
            "attachments": _attachment_state(),
            "send": _send_state(),
        }

    wait_until_stable(
        read_state,
        lambda state: (
            prompt_text_matches(state["text"], prompt)
            and expected.issubset(state["attachments"]["names"])
            and not state["attachments"]["pending"]
            and state["send"]["enabled"]
        ),
        timeout=45 if expected else 15,
        phase="send readiness",
    )


def _wait_user_turn(before_count, prompt, selector, timeout=20):
    deadline = time.time() + timeout
    cleared_polls = 0
    while time.time() < deadline:
        receipt = submission_receipt(_user_turns(), before_count, prompt, _composer_text(selector))
        if receipt:
            if receipt["verified_by"] == "user-turn":
                return receipt["turn"]
            cleared_polls += 1
            if cleared_polls >= 2:
                return receipt["turn"]
        else:
            cleared_polls = 0
        time.sleep(.25)
    raise RuntimeError("Temporary Chat submission verification did not observe an accepted submission")


def _diagnostic_thread_id():
    match = re.search(r"/c/([^/?#]+)", page_info().get("url", ""))
    return match.group(1) if match else None


_new_owned_tab("https://chatgpt.com/")
wait_for_load()

_click_temporary_chat_toggle()

deadline = time.time() + 20
while time.time() < deadline:
    if _temporary_chat_enabled():
        try:
            break
        except RuntimeError:
            pass
    time.sleep(.25)
else:
    raise RuntimeError("Temporary Chat composer readiness was not observed")

attachments = _upload_files(CFG.get("file", []))
selector = _wait_for_composer()
before_count = len(_user_turns())
prompt = CFG["prompt"]
is_contenteditable = bool(js(f"""(() => {{
  const e=document.querySelector({json.dumps(selector)});
  return !!e && e.getAttribute('contenteditable') === 'true';
}})()"""))
if is_contenteditable:
    cleared = js(f"""(() => {{
      const e=document.querySelector({json.dumps(selector)});
      if (!e) return false;
      e.focus();
      const sel=window.getSelection();
      const range=document.createRange();
      range.selectNodeContents(e);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete', false, null);
      return true;
    }})()""")
    if not cleared:
        raise RuntimeError("Temporary Chat contenteditable composer could not be cleared")
    for offset in range(0, len(prompt), 256):
        chunk = prompt[offset:offset + 256]
        inserted = js(f"""(() => {{
          const e=document.querySelector({json.dumps(selector)});
          if (!e) return false;
          e.focus();
          const ok=document.execCommand('insertText', false, {json.dumps(chunk)});
          e.dispatchEvent(new InputEvent('input', {{bubbles:true,inputType:'insertText',data:{json.dumps(chunk)}}}));
          return ok;
        }})()""")
        if not inserted:
            raise RuntimeError(f"Temporary Chat composer rejected prompt chunk at offset {offset}")
else:
    fill_input(selector, prompt, clear_first=True)

wait_until_stable(
    lambda: {"text": _composer_text(selector)},
    lambda state: prompt_text_matches(state["text"], CFG["prompt"]),
    timeout=30,
    phase="composer readiness",
)

_wait_for_send_ready(selector, CFG["prompt"], attachments)
_click_send()
user_turn = _wait_user_turn(before_count, CFG["prompt"], selector)

print(json.dumps({
    "operation": "submit",
    "status": "submitted",
    "temporary": True,
    "attachments": attachments,
    "diagnostic_thread_id": _diagnostic_thread_id(),
    "user_message_id": user_turn.get("id") or None,
    "verified": True,
}, ensure_ascii=False), flush=True)

# Keep the owned Temporary Chat tab alive until Relay observes the worker's
# post-launch task.started acknowledgement.  The parent releases this file;
# atexit then closes only this worker-owned tab.
release_file = CFG.get("release_file")
if not release_file:
    raise RuntimeError("worker release file was not configured")
if CFG.get("close_policy", "after-start") == "never":
    raise SystemExit(0)
while not os.path.exists(release_file):
    time.sleep(.1)
