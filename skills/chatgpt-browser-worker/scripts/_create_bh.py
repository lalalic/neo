import atexit
import json
import re
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
    target_id = new_tab(url)
    _OWNED_TABS.append(target_id)
    return target_id


def _close_owned_tabs():
    while _OWNED_TABS:
        target_id = _OWNED_TABS.pop()
        try:
            close_tab(target_id)
        except Exception:
            pass


atexit.register(_close_owned_tabs)


CFG = json.load(open("__CFG_PATH__", encoding="utf-8"))


def _ax_nodes():
    return cdp("Accessibility.getFullAXTree").get("nodes", [])


def _click_exact(name, roles=()):
    matches = [node for node in _ax_nodes() if node.get("name", {}).get("value") == name and (not roles or node.get("role", {}).get("value") in roles)]
    if len(matches) != 1:
        raise RuntimeError(f"expected one accessible {name!r}, found {len(matches)}")
    backend_id = matches[0].get("backendDOMNodeId")
    box = cdp("DOM.getBoxModel", backendNodeId=backend_id).get("model", {}).get("content")
    if not box:
        raise RuntimeError(f"accessible {name!r} has no visible box")
    click_at_xy(sum(box[0::2]) / 4, sum(box[1::2]) / 4)
    return {"name": name, "role": matches[0].get("role", {}).get("value")}


def _click_if_present(name, roles=()):
    matches = [node for node in _ax_nodes() if node.get("name", {}).get("value") == name and (not roles or node.get("role", {}).get("value") in roles)]
    if len(matches) > 1:
        raise RuntimeError(f"ambiguous accessible {name!r}: found {len(matches)}")
    if matches:
        return _click_exact(name, roles)
    return None


def _find_composer():
    selector = js("""(() => {
      const candidates = [...document.querySelectorAll('textarea,[contenteditable="true"]')];
      const node = candidates.find(e => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !e.disabled;
      });
      if (!node) return null;
      if (node.tagName === 'TEXTAREA') return 'textarea';
      return '[contenteditable="true"]';
    })()""")
    if not selector:
        raise RuntimeError("ChatGPT composer was not observed")
    return selector


def _thread_id():
    match = re.search(r"/c/([^/?#]+)", page_info().get("url", ""))
    if not match:
        raise RuntimeError("ChatGPT URL did not expose a durable thread id")
    return match.group(1)


# Creation must never reuse or mutate a user's existing ChatGPT tab.
_new_owned_tab("https://chatgpt.com/")
wait_for_load()

project = CFG["project"]
selected = _click_exact(project["name"], roles=("button", "link", "menuitem"))
time.sleep(1)
visible = js("document.body.innerText") or ""
if project["name"] not in visible:
    raise RuntimeError("selected Project was not observed in the page")

thinking = {"requested": CFG["thinking_level"], "changed": False}
if CFG["thinking_level"] != "default":
    label = {"low": "Low", "medium": "Medium", "high": "High"}[CFG["thinking_level"]]
    _click_exact(label, roles=("button", "menuitem", "option"))
    thinking = {"requested": CFG["thinking_level"], "effective_thinking_level": CFG["thinking_level"], "changed": True}

composer = _find_composer()
fill_input(composer, CFG["prompt"], clear_first=True)
press_key("Enter")
time.sleep(1)
thread_id = _thread_id()
print(json.dumps({
    "thread_id": thread_id,
    "conversation_url": page_info().get("url"),
    "selected_project": selected,
    "thinking": thinking,
    "prompt_sent": True,
}, ensure_ascii=False))
