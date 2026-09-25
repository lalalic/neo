"""Chrome Web Store mechanics for browser-harness.

This file is executed inside ``browser-harness``. It deliberately contains no
credentials and defaults to read-only/dry-run behavior.
"""

import json
import re
import time
import zipfile


CFG = json.load(open("__CFG_PATH__", encoding="utf-8"))
ACTION = CFG["action"]
ITEM_ID = CFG.get("item_id", "").strip()
EXPECTED_VERSION = CFG.get("expected_version", "").strip()
PUBLIC_LISTING_URL = CFG.get("public_listing_url", "").strip()
LISTING_URL = CFG.get("listing_url", "").strip()
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


def package_version(path):
    try:
        with zipfile.ZipFile(path) as package:
            manifest = json.loads(package.read("manifest.json"))
    except (OSError, KeyError, ValueError, zipfile.BadZipFile) as exc:
        fail(f"invalid extension package: {exc}")
    version = str(manifest.get("version", "")).strip()
    if not version:
        fail("package manifest is missing version")
    return version


def validate_package():
    package = CFG.get("package_path", "").strip()
    if not package:
        fail("package_path is required")
    if not EXPECTED_VERSION:
        fail("expected_version is required")
    observed = package_version(package)
    if observed != EXPECTED_VERSION:
        fail(f"package version {observed} does not match expected_version {EXPECTED_VERSION}")
    return observed


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


def visible_version():
    value = js("""(() => document.body?.innerText || '')()""") or ""
    versions = re.findall(r"\b\d+\.\d+(?:\.\d+){1,2}\b", value)
    return EXPECTED_VERSION if EXPECTED_VERSION in versions else (versions[0] if versions else None)


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
        url = LISTING_URL or (CONSOLE_URL + f"/store-item/{ITEM_ID}")
    new_tab(url)
    wait_for_load()
    require_session()
    if ITEM_ID and ITEM_ID not in page_info().get("url", ""):
        fail("observed URL does not contain the requested item id")
    return evidence("unknown", observed_item_id=ITEM_ID or None)


def upload_package():
    package = CFG["package_path"].strip()
    observed_version = validate_package()
    if not COMMIT:
        return evidence("draft", dry_run=True, would_upload=package, package_version=observed_version)
    if not click_text("Package") and not click_text("Upload new package"):
        fail("package upload control not observed")
    upload_file("input[type=file]", package)
    time.sleep(2)
    browser_version = visible_version()
    if browser_version != observed_version:
        fail(f"uploaded package version {browser_version or 'unknown'} does not match expected_version {observed_version}")
    return evidence("draft", uploaded_package=package, package_version=observed_version,
                    browser_version=browser_version)


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
    mapped = {key: market[key] for key in market if market[key] not in (None, "", [], {})}
    selectors = {
        "short_description": ["short description", "summary"],
        "long_description": ["long description", "description"],
        "release_notes": ["release notes", "what's new"],
        "reviewer_test_instructions": ["reviewer", "test instructions"],
        "support_url": ["support url", "support website"],
        "privacy_policy_url": ["privacy policy", "privacy url"],
        "privacy_practices": ["privacy practices", "privacy"],
        "data_use": ["data use", "data usage"],
        "distribution": ["distribution", "visibility"],
        "payment": ["payment", "paid"],
        "permissions": ["permissions", "permission justification"],
        "host_permissions": ["host permissions", "host permission"],
        "host_permission_justifications": ["host permission justification", "host permissions"],
        "title": ["title", "name"],
    }
    for label, value in mapped.items():
        if label in {"screenshots", "posters", "feature_graphic", "promotional_graphic", "demo_video"}:
            continue
        keys = selectors.get(label, [label.replace("_", " ")])
        changed = js(
            """(() => {
              const keys = %s;
              const nodes = [...document.querySelectorAll('input,textarea,select,[role=combobox],[contenteditable=true]')];
              const node = nodes.find(el => keys.some(key => ((el.getAttribute('aria-label') || el.name || el.id || '').toLowerCase().includes(key))));
              if (!node) return false;
              node.focus();
              if (node.type === 'checkbox' || node.type === 'radio') node.checked = Boolean(%s);
              else if (node.tagName === 'SELECT') {
                const wanted = String(%s).toLowerCase();
                const option = [...node.options].find(item => (item.text || item.value).toLowerCase() === wanted);
                if (!option) return false;
                node.value = option.value;
              } else if ('value' in node) node.value = %s;
              else node.textContent = %s;
              node.dispatchEvent(new Event('input', {bubbles: true}));
              node.dispatchEvent(new Event('change', {bubbles: true}));
              return true;
            })()""" % (json.dumps(keys), json.dumps(bool(value)), json.dumps(str(value)),
                         json.dumps(str(value)), json.dumps(str(value)))
        )
        if changed is not True:
            fail(f"listing field not observed: {label}")
    for field in ("screenshots", "posters", "feature_graphic", "promotional_graphic", "demo_video"):
        for media in (mapped.get(field) if isinstance(mapped.get(field), list) else [mapped.get(field)]):
            if media:
                try:
                    upload_file("input[type=file]", str(media))
                except (OSError, RuntimeError) as exc:
                    fail(f"listing media upload failed: {field}")
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
        return evidence("rejected", observed_version=visible_version())
    if text_exists(["published", "public"]):
        return evidence("published", observed_version=visible_version())
    if text_exists(["submitted", "under review", "pending"]):
        return evidence("pending", observed_version=visible_version())
    return evidence("unknown", observed_version=visible_version())


def verify_published():
    url = page_info().get("url", "")
    if not url.startswith("https://chromewebstore.google.com/detail/"):
        return evidence("unknown", reason="public listing URL not observed")
    if ITEM_ID and ITEM_ID not in url:
        return evidence("unknown", reason="public URL does not match item id")
    observed = visible_version()
    if EXPECTED_VERSION and observed != EXPECTED_VERSION:
        return evidence("unknown", reason="expected version not observed")
    return evidence("published", expected_version=EXPECTED_VERSION or None, observed_version=observed)


if ACTION not in ALLOWED_ACTIONS:
    fail("unsupported action: " + ACTION)
if ACTION != "open-item" and not ITEM_ID:
    fail("item_id is required for this action")
if ACTION == "open-item" and not (ITEM_ID or LISTING_URL):
    fail("item_id or listing_url is required for open-item")
if ACTION == "upload-package":
    validate_package()

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
