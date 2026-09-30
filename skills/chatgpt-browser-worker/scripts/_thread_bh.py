from urllib.parse import urlsplit

thread_url = CFG["thread_url"]
prompt = CFG["prompt"]
expected_path = urlsplit(thread_url).path.rstrip("/")

_new_owned_tab(thread_url)
wait_for_load()

deadline = time.time() + 20
while time.time() < deadline:
    current_url = page_info().get("url", "")
    if urlsplit(current_url).path.rstrip("/") == expected_path:
        break
    time.sleep(.25)
else:
    raise RuntimeError(
        f"Existing ChatGPT thread redirect mismatch: expected {expected_path!r}, "
        f"observed {urlsplit(page_info().get('url', '')).path.rstrip('/')!r}"
    )

# Existing threads restore their saved composer draft during hydration. Do not
# use ?prompt= here: that prefill can be overwritten by the saved draft. Wait
# until the live composer itself is stable, then let the shared submitter
# explicitly replace that draft with this turn's prompt.
wait_until_stable(
    lambda: {"selector": _composer()},
    lambda state: bool(state["selector"]),
    timeout=30,
    phase="existing thread hydration",
)

result = _submit_current_page(prompt, temporary=False, mode_label="Existing thread")
result["thread_url"] = page_info().get("url", "").split("?", 1)[0]
print(json.dumps(result, ensure_ascii=False), flush=True)
_wait_for_release()
