"""Chrome Web Store mechanics for browser-harness.

This file is executed inside ``browser-harness``. It deliberately contains no
credentials and defaults to read-only/dry-run behavior.
"""

import json
import re
import time


CFG = json.load(open("__CFG_PATH__", encoding="utf-8"))
ACTION = CFG["action"]
ITEM_ID = CFG.get("item_id", "").strip()
EXPECTED_VERSION = CFG.get("expected_version", "").strip()
PUBLIC_LISTING_URL = CFG.get("public_listing_url", "").strip()
COMMIT = bool(CFG.get("commit", False))
ALLOW_EXTERNAL_SUBMIT = bool(CFG.get("allow_external_submit", False))

CONSOLE_URL = "https://chromewebstore.google.com/devconsole"
ALLOWED_ACTIONS = {
    "open-item",
    "upload-package",
    "update-listing",
    "submit-review",
    "check-status",
    "verify-published",
}
STATES = {"draft", "submitted", "pending", "rejected", "published", "unknown"}


def fail(message):
    print(json.dumps({"action": ACTION, "status": "unknown", "error": message}))
    raise SystemExit(2)


def evidence(status, **extra):
    if status not in STATES:
        fail(f"invalid evidence status: {status}")
    record = {
        "action": ACTION,
        "status": status,
        "item_id": ITEM_ID or None,
        "url": page_info().get("url"),
        **extra,
    }
    print(json.dumps(record, ensure_ascii=False))
    return record


def text_exists(needles):
    values = json.dumps([n.lower() for n in needles])
    return js(
        """(() => {
          const text = (document.body?.innerText || '').toLowerCase();
          return %s.some(value => text.includes(value));
        })()""" % values
    ) is True


def click_text(label):
    wanted = label.lower()
    return js(
        """(() => {
          const nodes = [...document.querySelectorAll('button,[role=button],a')];
          const node = nodes.find(el => (el.innerText || el.getAttribute('aria-label') || '').trim().toLowerCase() === %r);
          if (!node) return false;
          node.click();
          return true;
        })()""" % wanted
    ) is True


def require_session():
    url = page_info().get("url", "")
    if "accounts.google.com" in url or text_exists(["sign in", "log in"]):
        fail("authenticated Chrome Web Store publisher session required")


def open_item():
    if ACTION == "verify-published":
        url = PUBLIC_LISTING_URL or ("https://chromewebstore.google.com/detail/" + ITEM_ID)
    else:
        url = CONSOLE_URL + (f"/store-item/{ITEM_ID}" if ITEM_ID else "")
    new_tab(url)
    wait_for_load()
    require_session()
    if ITEM_ID and ITEM_ID not in page_info().get("url", ""):
        fail("observed URL does not contain the requested item id")
    return evidence("unknown", observed_item_id=ITEM_ID or None)


def upload_package():
    package = CFG.get("package_path", "").strip()
    if not package:
        fail("package_path is required")
    if not COMMIT:
        return evidence("draft", dry_run=True, would_upload=package)
    if not click_text("Package") and not click_text("Upload new package"):
        fail("package upload control not observed")
    upload_file("input[type=file]", package)
    time.sleep(2)
    return evidence("draft", uploaded_package=package)


def update_listing():
    market = CFG.get("market_package") or {}
    required = ["title", "short_description", "long_description", "support_url"]
    missing = [key for key in required if not str(market.get(key, "")).strip()]
    if missing:
        fail("market_package missing: " + ", ".join(missing))
    if not COMMIT:
        return evidence("draft", dry_run=True, fields=sorted(market))
    # Chrome's editor is a dynamic form. Use labels/aria names rather than
    # brittle generated class names; the caller still receives observed evidence.
    mapped = {"title": market["title"], "short_description": market["short_description"],
              "long_description": market["long_description"], "support_url": market["support_url"]}
    for label, value in mapped.items():
        changed = js(
            """(() => {
              const key = %r.toLowerCase();
              const nodes = [...document.querySelectorAll('input,textarea,[contenteditable=true]')];
              const node = nodes.find(el => ((el.getAttribute('aria-label') || el.name || el.id || '').toLowerCase().includes(key)));
              if (!node) return false;
              node.focus();
              if ('value' in node) node.value = %r;
              else node.textContent = %r;
              node.dispatchEvent(new Event('input', {bubbles: true}));
              return true;
            })()""" % (label, value, value)
        )
        if changed is not True:
            fail(f"listing field not observed: {label}")
    if not click_text("Save"):
        fail("save control not observed")
    return evidence("draft", fields=sorted(mapped))


def submit_review():
    if not COMMIT or not ALLOW_EXTERNAL_SUBMIT:
        return evidence("draft", blocked="explicit submit authorization required")
    if not click_text("Submit for review"):
        fail("submit-for-review control not observed")
    time.sleep(2)
    return evidence("submitted")


def check_status():
    if text_exists(["rejected", "needs changes"]):
        return evidence("rejected")
    if text_exists(["published", "public"]):
        return evidence("published")
    if text_exists(["submitted", "under review", "pending"]):
        return evidence("pending")
    return evidence("unknown")


def verify_published():
    url = page_info().get("url", "")
    if not url.startswith("https://chromewebstore.google.com/detail/"):
        return evidence("unknown", reason="public listing URL not observed")
    if ITEM_ID and ITEM_ID not in url:
        return evidence("unknown", reason="public URL does not match item id")
    if EXPECTED_VERSION and not text_exists([EXPECTED_VERSION]):
        return evidence("unknown", reason="expected version not observed")
    return evidence("published", expected_version=EXPECTED_VERSION or None)


if ACTION not in ALLOWED_ACTIONS:
    fail("unsupported action: " + ACTION)
if ACTION != "open-item" and not ITEM_ID:
    fail("item_id is required for this action")

open_item()
if ACTION == "upload-package":
    upload_package()
elif ACTION == "update-listing":
    update_listing()
elif ACTION == "submit-review":
    submit_review()
elif ACTION == "check-status":
    check_status()
elif ACTION == "verify-published":
    verify_published()
