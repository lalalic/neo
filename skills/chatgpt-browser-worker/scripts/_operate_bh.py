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


ensure_real_tab()
target = f"https://chatgpt.com/c/{THREAD_ID}"
if page_info().get("url", "") != target:
    new_tab(target)
    wait_for_load()
time.sleep(1)

body = js("document.body.innerText") or ""
if CFG["project"] not in body:
    raise RuntimeError("requested Project was not observed in the opened thread")

base = {"thread_id": THREAD_ID, "conversation_url": page_info().get("url"), "project": {"name": CFG["project"]}}
operation = CFG["operation"]
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
