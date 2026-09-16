import time, json

CFG = json.load(open("__CFG_PATH__"))

SB = 'document.querySelector("wujie-app").shadowRoot.querySelector("body")'

def shadow_js(expr):
    return js(SB + expr)

def find_rect(sel):
    code = SB + '.querySelector("' + sel + '") ? (function(){ var r = ' + SB + '.querySelector("' + sel + '").getBoundingClientRect(); return JSON.stringify({x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}); })() : "null"'
    r = js(code)
    if r and r != "null":
        return json.loads(r)
    return None

print("[1/6] Opening WeChat Channels post create...")
new_tab("https://channels.weixin.qq.com/platform/post/create")
wait_for_load()
time.sleep(4)

url = page_info()["url"]
if "login" in url.lower():
    print("ERROR: Not logged in. Scan QR at https://channels.weixin.qq.com/")
    capture_screenshot()
    raise SystemExit(1)

for i in range(10):
    sc = js('document.querySelector("wujie-app")?.shadowRoot ? "ok" : "no"')
    if sc == "ok":
        break
    time.sleep(1)
else:
    print("ERROR: Shadow DOM not found after 10s.")
    capture_screenshot()
    raise SystemExit(1)

for i in range(10):
    has_upload = shadow_js('.querySelector(".upload") ? "ok" : "no"')
    if has_upload == "ok":
        break
    time.sleep(1)
else:
    print("ERROR: Upload area not found.")
    capture_screenshot()
    raise SystemExit(1)

print("  -> Logged in, page loaded.")

print("[2/6] Uploading video: " + CFG["video"])
doc = cdp("DOM.getDocument", depth=-1, pierce=True)
sr = cdp("DOM.performSearch", query='input[type="file"][accept*="video"]')
if sr.get("resultCount", 0) > 0:
    nodes = cdp("DOM.getSearchResults", searchId=sr["searchId"], fromIndex=0, toIndex=1)
    nid = nodes["nodeIds"][0]
    cdp("DOM.setFileInputFiles", files=[CFG["video"]], nodeId=nid)
    cdp("DOM.discardSearchResults", searchId=sr["searchId"])
    print("  -> Video file set via DOM.")
else:
    print("ERROR: Cannot find video file input.")
    capture_screenshot()
    raise SystemExit(1)

print("  -> Waiting for upload...")

def upload_state():
    # Ant Upload intentionally clears the native file input after accepting a file.
    # Read the live Vue upload model instead of treating an enabled form button as upload success.
    return js(r'''
(() => {
  const sr = document.querySelector("wujie-app")?.shadowRoot;
  let v = sr?.querySelector(".ant-upload-btn")?.__vue__;
  for (let i = 0; v && i < 8; i++, v = v.$parent) {
    const files = v?.$props?.value;
    if (Array.isArray(files) && files.length && files.some(f => f?.isVideo)) {
      const f = files.find(f => f?.isVideo) || files[0];
      return {status: f?.status || "", percent: Number(f?.percent || 0), name: f?.name || ""};
    }
  }
  return null;
})()
''')

for attempt in range(180):
    time.sleep(2)
    state = upload_state()
    if state and state.get("status") == "done":
        print("  -> Upload done: " + str(state.get("name", "")))
        break
    if state and state.get("status") in {"error", "removed"}:
        print("ERROR: Video upload failed: " + json.dumps(state, ensure_ascii=False))
        capture_screenshot()
        raise SystemExit(1)
    if attempt % 5 == 4:
        if state:
            print("  -> Uploading... " + str(state.get("percent", 0)) + "%")
        else:
            print("  -> Waiting for uploader to accept the file...")
else:
    print("ERROR: Upload timeout without a completed upload state.")
    capture_screenshot()
    raise SystemExit(1)
time.sleep(1)

print("[3/6] Setting description...")
tags = CFG.get("tags", [])
desc = CFG["desc"]
if tags:
    desc = desc + " " + " ".join(f"#{t}" for t in tags)
desc_s = json.dumps(desc)
shadow_js('.querySelector(".input-editor[contenteditable=true]")?.focus()')
time.sleep(0.3)
js(SB + '.querySelector(".input-editor").textContent = ' + desc_s)
js(SB + '.querySelector(".input-editor").dispatchEvent(new Event("input", {bubbles:true}))')
time.sleep(0.5)
actual = shadow_js('.querySelector(".input-editor")?.textContent?.substring(0,50) || ""')
if actual:
    print("  -> Description: " + actual)
else:
    print("  -> WARNING: Description may not have been set, trying click+type...")
    c = find_rect(".input-editor")
    if c:
        click_at_xy(c["x"], c["y"])
        time.sleep(0.5)
        type_text(CFG["desc"])
        time.sleep(0.5)

if CFG["title"]:
    print("[4/6] Setting short title: " + CFG["title"])
    title_s = json.dumps(CFG["title"])
    shadow_js('.querySelector(".weui-desktop-form__input")?.focus()')
    time.sleep(0.2)
    js('Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(' + SB + '.querySelector(".weui-desktop-form__input"), ' + title_s + ')')
    js(SB + '.querySelector(".weui-desktop-form__input").dispatchEvent(new Event("input", {bubbles:true}))')
    time.sleep(0.3)
else:
    print("[4/6] No short title, skipping...")

# Scroll down to make buttons visible
shadow_js('.scrollTo(0, 99999)')
js('document.querySelector("wujie-app").shadowRoot.querySelector("html")?.scrollTo(0, 99999)')
time.sleep(1)

print("[5/6] Pre-action screenshot...")
capture_screenshot()
time.sleep(1)

def find_btn_by_text(text):
    # Find an enabled visible button, scroll it into the viewport, then return its center.
    text_s = json.dumps(text)
    js(r'''
(() => {
  const b = document.querySelector("wujie-app")?.shadowRoot?.querySelector("body");
  const found = [...(b?.querySelectorAll(".weui-desktop-btn") || [])].find(el =>
    el.textContent.trim() === ''' + text_s + r''' &&
    el.getBoundingClientRect().width > 0 &&
    !el.classList.contains("weui-desktop-btn_disabled")
  );
  if (found) found.scrollIntoView({block:"center", inline:"center"});
})()
''')
    time.sleep(0.3)
    r = js(r'''
(() => {
  const b = document.querySelector("wujie-app")?.shadowRoot?.querySelector("body");
  const found = [...(b?.querySelectorAll(".weui-desktop-btn") || [])].find(el =>
    el.textContent.trim() === ''' + text_s + r''' &&
    el.getBoundingClientRect().width > 0 &&
    !el.classList.contains("weui-desktop-btn_disabled")
  );
  if (!found) return "null";
  const rect = found.getBoundingClientRect();
  return JSON.stringify({x:Math.round(rect.x+rect.width/2), y:Math.round(rect.y+rect.height/2)});
})()
''')
    if r and r != "null":
        return json.loads(r)
    return None

if CFG["publish"]:
    print("[6/6] Publishing...")
    c = find_btn_by_text("\u53d1\u8868")  # 发表
    if c:
        click_at_xy(c["x"], c["y"])
        time.sleep(3)
        # Handle confirmation dialog
        shadow_js('.querySelectorAll(".weui-desktop-dialog__wrp").forEach(function(d){ if(d.style.display !== "none"){ var b = d.querySelector(".weui-desktop-btn_primary"); if(b) b.click(); }})')
        # Require a platform-side success signal instead of trusting the click.
        published = False
        for _ in range(10):
            time.sleep(1)
            success_text = shadow_js('.querySelector("[class*=toptip], [class*=toast], [class*=message]")?.textContent || ""')
            body_text = shadow_js('.innerText || ""')
            if "已发表" in str(success_text) or "发表成功" in str(success_text) or "已发表" in str(body_text):
                published = True
                break
        if not published:
            print("ERROR: Publish click completed but no platform success signal was observed.")
            capture_screenshot()
            raise SystemExit(1)
        print("  -> Published! Platform confirmed 已发表.")
    else:
        print("ERROR: Publish button disabled/not found.")
        capture_screenshot()
        raise SystemExit(1)
else:
    print("[6/6] Saving draft...")
    c = find_btn_by_text("\u4fdd\u5b58\u8349\u7a3f")  # 保存草稿
    if c:
        click_at_xy(c["x"], c["y"])
        time.sleep(3)
        print("  -> Draft saved!")
    else:
        print("ERROR: Save draft button disabled/not found.")
        capture_screenshot()
        raise SystemExit(1)

time.sleep(2)
capture_screenshot()
print("Done!")
