thread_url = CFG["thread_url"]
prompt = CFG["prompt"]
entry_url = thread_entry_url(thread_url, prompt)
_new_owned_tab(entry_url)
wait_for_load()

# Existing-thread mode must stay on the requested conversation. Query/hash
# differences are allowed; redirecting to another conversation is not.
def _thread_path(url):
    from urllib.parse import urlsplit
    return urlsplit(url).path.rstrip("/")

expected_path = _thread_path(thread_url)
deadline = time.time() + 20
while time.time() < deadline:
    current_url = js("location.href") or ""
    if _thread_path(current_url) == expected_path:
        break
    time.sleep(.25)
else:
    raise RuntimeError(
        f"Existing ChatGPT thread redirect mismatch: expected {expected_path!r}, "
        f"observed {_thread_path(js('location.href') or '')!r}"
    )

selector = _wait_for_composer()

# URL prefill is primary for existing threads too. Keep the same bounded DOM
# insertion fallback as Temporary Chat for product compatibility.
if not prompt_text_matches(_composer_text(selector), prompt):
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
            raise RuntimeError("Existing thread contenteditable composer could not be cleared")
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
                raise RuntimeError(f"Existing thread composer rejected prompt chunk at offset {offset}")
    else:
        fill_input(selector, prompt, clear_first=True)

wait_until_stable(
    lambda: {"text": _composer_text(selector)},
    lambda state: prompt_text_matches(state["text"], prompt),
    timeout=30,
    phase="existing thread composer readiness",
)

attachments = _upload_files(CFG.get("file", []))
before_count = len(_user_turns())
_wait_for_send_ready(selector, prompt, attachments)
_click_send()
receipt = _wait_user_turn(before_count, prompt, selector)
_SUBMISSION_SUCCEEDED = True

print(json.dumps({
    "operation": "submit",
    "status": "submitted",
    "temporary": False,
    "thread_url": (js("location.href") or "").split("?", 1)[0],
    "attachments": attachments,
    "diagnostic_thread_id": _diagnostic_thread_id(),
    "user_message_id": receipt["turn"].get("id") or None,
    "owned_tab_id": (_OWNED_TABS[-1].get("tabId") if _OWNED_TABS else None),
    "owned_target_id": (_OWNED_TABS[-1].get("targetId") if _OWNED_TABS else None),
    "verified_by": receipt["verified_by"],
    "verified": True,
}, ensure_ascii=False), flush=True)

release_file = CFG.get("release_file")
if not release_file:
    raise RuntimeError("worker release file was not configured")
if CFG.get("close_policy", "after-start") == "never":
    raise SystemExit(0)
while not os.path.exists(release_file):
    time.sleep(.1)
