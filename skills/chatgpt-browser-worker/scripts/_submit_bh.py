import atexit
import json
import os
import re
import time

from browser_harness import *


CFG = json.load(open("__CFG_PATH__", encoding="utf-8"))
_OWNED_TABS = []
_KEEP_OWNED_TAB_OPEN = CFG.get("close_policy", "after-start") == "never"
_SUBMISSION_SUCCEEDED = False



def _new_owned_tab(url):
    # Respect Browser Harness workspace adapters. Record both target + workspace
    # tab id so cleanup remains scoped to exactly this worker's own lease even
    # if ChatGPT navigation invalidates the original target mapping.
    target_id = new_tab(url)
    tabs = [tab for tab in list_tabs(include_chrome=False) if tab.get("targetId") == target_id]
    if len(tabs) != 1:
        raise RuntimeError(f"Owned Browser Workspace target {target_id!r} was not mapped to one tab")
    _OWNED_TABS.append({
        "targetId": target_id,
        "tabId": tabs[0].get("tabId"),
    })
    return target_id


def _close_owned_tabs():
    # close-policy=never preserves an owned tab only after a verified submit.
    # Any failure before that point must release this worker's own lease.
    if _KEEP_OWNED_TAB_OPEN and _SUBMISSION_SUCCEEDED:
        return
    while _OWNED_TABS:
        owned = _OWNED_TABS.pop()
        try:
            close_tab(owned["targetId"])
            continue
        except Exception:
            pass
        try:
            current = current_tab()
            if owned.get("tabId") is not None and current.get("tabId") == owned["tabId"]:
                close_tab()
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
        .find(e => {
          if (e.id === 'pending-home-input') return false;
          const r=e.getBoundingClientRect();
          return r.width>0 && r.height>0 && !e.disabled;
        });
      if (!fallback) return null;
      return fallback.tagName === 'TEXTAREA' ? 'textarea' : '[contenteditable="true"]';
    })()""")
    if not selector:
        raise RuntimeError("Temporary Chat composer was not observed")
    return selector


def _composer_text(selector):
    return js(f"""(() => {{
      const e=document.querySelector({json.dumps(selector)});
      if (!e) return '';
      return e.getAttribute('contenteditable') === 'true'
        ? (e.innerText || '')
        : (e.value || '');
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
      const names = [...document.querySelectorAll('button[aria-label^="Remove "]')]
        .map(b => (b.getAttribute('aria-label') || '')
          .replace(/^Remove file\s+\d+:\s*/, '')
          .replace(/^Remove\s+/, ''))
        .filter(Boolean);
      return {names, pending: false};
    })()""") or {"names": [], "pending": False}


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

    def file_input_selector():
        return js("""(() => {
          const selectors = [
            '#upload-files',
            '#upload-media',
            'input[name="upload-media"]',
            'input[type="file"]:not([accept])',
            'input[type="file"]'
          ];
          for (const s of selectors) if (document.querySelector(s)) return s;
          return null;
        })()""")

    selector = file_input_selector()
    if not selector:
        opened = js("""(() => {
          const b=[...document.querySelectorAll('button')].find(b =>
            (b.getAttribute('aria-label') || '').trim() === 'Add files and more');
          if (!b) return false;
          b.click();
          return true;
        })()""")
        if opened:
            deadline = time.time() + 5
            while time.time() < deadline and not selector:
                selector = file_input_selector()
                if not selector:
                    time.sleep(.1)
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
            and state["send"]["enabled"]
        ),
        timeout=45 if expected else 15,
        phase="send readiness",
    )


def _wait_user_turn(before_count, prompt, selector, timeout=20):
    deadline = time.time() + timeout
    cleared_polls = 0
    last_error = None
    while time.time() < deadline:
        try:
            receipt = submission_receipt(
                _user_turns(),
                before_count,
                prompt,
                _composer_text(selector),
            )
            last_error = None
        except RuntimeError as exc:
            # The Browser Harness/CDP daemon can transiently time out while
            # ChatGPT is committing a navigation/message update. Receipt
            # observation is read-only, so retry within the existing bound.
            last_error = exc
            time.sleep(.25)
            continue
        if receipt:
            if receipt["verified_by"] == "user-turn":
                return receipt
            cleared_polls += 1
            if cleared_polls >= 2:
                return receipt
        else:
            cleared_polls = 0
        time.sleep(.25)
    suffix = f"; last observation error: {last_error}" if last_error else ""
    raise RuntimeError(
        "ChatGPT submission verification did not observe an accepted submission" + suffix
    )


def _diagnostic_thread_id():
    match = re.search(r"/c/([^/?#]+)", page_info().get("url", ""))
    return match.group(1) if match else None


