import json
import time

from browser_harness import *


CFG = json.load(open("__CFG_PATH__", encoding="utf-8"))
THREAD_ID = CFG["thread_id"]


def _ax_nodes():
    return cdp("Accessibility.getFullAXTree").get("nodes", [])


def _composer():
    selector = js("""(() => {
      const nodes = [...document.querySelectorAll('textarea,[contenteditable="true"]')];
      const node = nodes.find(e => { const r = e.getBoundingClientRect(); return r.width && r.height && !e.disabled; });
      return node ? (node.tagName === 'TEXTAREA' ? 'textarea' : '[contenteditable="true"]') : null;
    })()""")
    if not selector:
        raise RuntimeError("ChatGPT composer was not observed")
    return selector


def _assistant_messages():
    return js("""(() => [...document.querySelectorAll('[data-message-author-role="assistant"]')]
      .map(e => ({text: e.innerText.trim(), id: e.getAttribute('data-message-id') || ''}))
      .filter(e => e.text))()""") or []


def _click_accessible(name):
    matches = [node for node in _ax_nodes() if node.get("name", {}).get("value") == name]
    if len(matches) != 1:
        raise RuntimeError(f"expected one accessible {name!r}, found {len(matches)}")
    backend_id = matches[0].get("backendDOMNodeId")
    box = cdp("DOM.getBoxModel", backendNodeId=backend_id).get("model", {}).get("content")
    if not box:
        raise RuntimeError(f"accessible {name!r} has no visible box")
    click_at_xy(sum(box[0::2]) / 4, sum(box[1::2]) / 4)


def _cleanup():
    """Delete exactly the thread addressed by the durable URL and verify it."""
    url = page_info().get("url", "")
    if f"/c/{THREAD_ID}" not in url:
        raise RuntimeError("browser is not on the requested durable thread")
    body = js("document.body.innerText") or ""
    if CFG["project"] not in body:
        lower_body = body.lower()
        missing_markers = ("conversation not found", "conversation doesn't exist",
                           "conversation does not exist", "page not found")
        if any(marker in lower_body for marker in missing_markers):
            return {"thread_id": THREAD_ID, "outcome": "not_found", "verified": True,
                    "url_after": url, "reason": "thread was not observable"}
        raise RuntimeError("requested thread could not be verified; refusing cleanup")
    menus = [label for label in ("More", "More options")
             if any(node.get("name", {}).get("value") == label for node in _ax_nodes())]
    if len(menus) != 1:
        raise RuntimeError("thread actions menu was not uniquely observed")
    _click_accessible(menus[0])
    time.sleep(.25)
    actions = [label for label in ("Delete", "Delete chat")
               if any(node.get("name", {}).get("value") == label for node in _ax_nodes())]
    if len(actions) != 1:
        raise RuntimeError("ChatGPT delete action was not uniquely observed")
    _click_accessible(actions[0])
    time.sleep(.25)
    confirms = [label for label in ("Delete", "Delete chat")
                if any(node.get("name", {}).get("value") == label for node in _ax_nodes())]
    if len(confirms) != 1:
        raise RuntimeError("ChatGPT delete confirmation was not uniquely observed")
    _click_accessible(confirms[0])
    time.sleep(.5)
    after_url = page_info().get("url", "")
    after_body = js("document.body.innerText") or ""
    if f"/c/{THREAD_ID}" in after_url and CFG["project"] in after_body:
        raise RuntimeError("requested thread is still observable after delete")
    return {"thread_id": THREAD_ID, "outcome": "deleted", "verified": True,
            "url_after": after_url, "undo_visible": "Undo" in after_body,
            "archive_visible": "Archive" in after_body}


ensure_real_tab()
target = f"https://chatgpt.com/c/{THREAD_ID}"
if page_info().get("url", "") != target:
    new_tab(target)
    wait_for_load()
time.sleep(1)

body = js("document.body.innerText") or ""
operation = CFG["operation"]
if operation == "delete":
    print(json.dumps(_cleanup(), ensure_ascii=False))
    raise SystemExit
if CFG["project"] not in body:
    raise RuntimeError("requested Project was not observed in the opened thread")

base = {"thread_id": THREAD_ID, "conversation_url": page_info().get("url"), "project": {"name": CFG["project"]}}
if operation == "continue":
    fill_input(_composer(), CFG["prompt"], clear_first=True)
    press_key("Enter")
    print(json.dumps({**base, "prompt_sent": True}, ensure_ascii=False))
elif operation == "status":
    messages = _assistant_messages()
    generating = bool(js('!!document.querySelector(\'button[aria-label*="Stop" i],button[data-testid*="stop" i]\')'))
    status = "running" if generating else ("awaiting_result" if not messages else "completed")
    print(json.dumps({**base, "status": status, "assistant_message_count": len(messages)}, ensure_ascii=False))
elif operation == "result":
    messages = _assistant_messages()
    if not messages:
        raise RuntimeError("no observed assistant result")
    message = messages[-1]
    print(json.dumps({**base, "status": "completed", "text": message["text"], "message_id": message["id"] or "observed-assistant"}, ensure_ascii=False))
else:
    print(json.dumps({**base, "status": "completed" if _assistant_messages() else "awaiting_result"}, ensure_ascii=False))
