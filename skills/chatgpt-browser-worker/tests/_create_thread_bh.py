import json
import time
from urllib.parse import quote

marker = __MARKER__
prompt = "Reply exactly with this token and nothing else: " + marker
owned = None
try:
    owned = new_tab("https://chatgpt.com/?prompt=" + quote(prompt))

    deadline = time.time() + 30
    while time.time() < deadline:
        state = js("""(() => {
          const e=document.querySelector('#prompt-textarea')
            || [...document.querySelectorAll('textarea,[contenteditable="true"]')]
              .find(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled});
          const b=document.querySelector(
            'button[data-testid="send-button"],button[aria-label="Send prompt"],button[aria-label="Send"]'
          );
          return {
            text:e?(e.innerText||e.value||''):'',
            send:!!b&&!b.disabled&&b.getAttribute('aria-disabled')!=='true'
          };
        })()""") or {}
        if prompt in (state.get("text") or "") and state.get("send"):
            break
        time.sleep(.25)
    else:
        raise RuntimeError("persistent thread composer was not ready")

    clicked = js("""(() => {
      const b=document.querySelector(
        'button[data-testid="send-button"],button[aria-label="Send prompt"],button[aria-label="Send"]'
      );
      if(!b||b.disabled)return false;
      b.click();
      return true;
    })()""")
    if not clicked:
        raise RuntimeError("persistent thread send failed")

    deadline = time.time() + 30
    thread_url = None
    while time.time() < deadline:
        url = js("location.href") or ""
        if "/c/" in url and "local-chatgpt%3A" not in url:
            thread_url = url.split("?", 1)[0]
            break
        time.sleep(.25)
    if not thread_url:
        raise RuntimeError("persistent thread URL was not created")

    deadline = time.time() + 90
    stable = 0
    while time.time() < deadline:
        nodes = cdp("Accessibility.getFullAXTree").get("nodes", [])
        matches = []
        for node in nodes:
            role = ((node.get("role") or {}).get("value") or "")
            name = ((node.get("name") or {}).get("value") or "")
            if role in ("StaticText", "InlineTextBox", "paragraph") and marker in name:
                matches.append(name)
        stable = stable + 1 if matches else 0
        if stable >= 2:
            break
        time.sleep(.5)
    else:
        raise RuntimeError("persistent thread first assistant reply was not observed")

    print(json.dumps({"thread_url": thread_url}))
finally:
    if owned:
        try:
            close_tab(owned)
        except Exception:
            pass
