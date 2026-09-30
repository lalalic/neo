import json
import os
import secrets
import subprocess
import tempfile
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
TEMPORARY = ROOT / "scripts" / "temporary_bh.py"
THREAD = ROOT / "scripts" / "thread_bh.py"


def _browser_harness(code, timeout=240):
    completed = subprocess.run(
        ["browser-harness"], input=code, text=True, capture_output=True, timeout=timeout
    )
    if completed.returncode:
        raise AssertionError(completed.stderr or completed.stdout)
    return completed.stdout


def _workspace_snapshot():
    output = _browser_harness(
        "import json\n"
        "print(json.dumps({'status': workspace_status(), 'tabs': list_tabs(include_chrome=False)}))\n"
    )
    return json.loads(output.strip().splitlines()[-1])




def _thread_submit(thread_url, prompt, attachments=()):
    with tempfile.TemporaryDirectory(prefix="chatgpt-browser-thread-e2e-") as run_dir:
        command = [
            "python3",
            str(THREAD),
            "--thread-url",
            thread_url,
            "--prompt",
            prompt,
            "--release-file",
            str(Path(run_dir) / "release"),
            "--close-policy",
            "never",
        ]
        for attachment in attachments:
            command.extend(["--file", str(attachment)])
        completed = subprocess.run(command, text=True, capture_output=True, timeout=240)
    if completed.returncode:
        raise AssertionError(completed.stderr or completed.stdout)
    for line in reversed(completed.stdout.splitlines()):
        try:
            result = json.loads(line)
        except json.JSONDecodeError:
            continue
        if result.get("operation") == "submit":
            return result
    raise AssertionError(f"thread_bh.py emitted no submission result: {completed.stdout}")


def _create_persistent_thread():
    marker = f"THREAD_CREATE_{secrets.token_hex(6)}"
    code = r"""
import json, time
from urllib.parse import quote
owned = None
try:
    marker = __MARKER__
    owned = new_tab("https://chatgpt.com/?prompt=" + quote(marker))
    deadline = time.time() + 30
    while time.time() < deadline:
        state = js("""(() => {
          const e=document.querySelector('#prompt-textarea')
            || [...document.querySelectorAll('textarea,[contenteditable="true"]')]
              .find(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled});
          const b=document.querySelector(
            'button[data-testid="send-button"],button[aria-label="Send prompt"],button[aria-label="Send"]'
          );
          return {text:e?(e.innerText||e.value||''):'', send:!!b&&!b.disabled&&b.getAttribute('aria-disabled')!=='true'};
        })()""") or {}
        if marker in (state.get("text") or "") and state.get("send"):
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
        assistant_count = int(js(
            "document.querySelectorAll('[data-message-author-role=\"assistant\"]').length"
        ) or 0)
        stop_present = bool(js(
            "!!document.querySelector('button[data-testid=\"stop-button\"],button[aria-label*=\"Stop\" i]')"
        ))
        done = assistant_count > 0 and not stop_present
        stable = stable + 1 if done else 0
        if stable >= 2:
            break
        time.sleep(.5)
    else:
        raise RuntimeError("persistent thread first turn did not finish")

    print(json.dumps({"thread_url": thread_url}))
finally:
    if owned:
        try:
            close_tab(owned)
        except Exception:
            pass
""".replace("__MARKER__", json.dumps(marker))
    output = _browser_harness(code)
    return json.loads(output.strip().splitlines()[-1])["thread_url"]

def _submit(prompt, attachments=()):
    with tempfile.TemporaryDirectory(prefix="chatgpt-browser-e2e-") as run_dir:
        command = [
            "python3",
            str(TEMPORARY),
            "--prompt",
            prompt,
            "--release-file",
            str(Path(run_dir) / "release"),
            "--close-policy",
            "never",
        ]
        for attachment in attachments:
            command.extend(["--file", str(attachment)])
        completed = subprocess.run(command, text=True, capture_output=True, timeout=240)
    if completed.returncode:
        raise AssertionError(completed.stderr or completed.stdout)
    for line in reversed(completed.stdout.splitlines()):
        try:
            result = json.loads(line)
        except json.JSONDecodeError:
            continue
        if result.get("operation") == "submit":
            return result
    raise AssertionError(f"temporary_bh.py emitted no submission result: {completed.stdout}")


def _owned_tab(result):
    tab_id = result.get("owned_tab_id")
    target_id = result.get("owned_target_id")
    assert tab_id is not None, result
    assert target_id, result
    snapshot = _workspace_snapshot()
    assert tab_id in set(snapshot["status"].get("leasedTabIds", [])), snapshot["status"]
    tabs = [
        tab for tab in snapshot["tabs"]
        if tab.get("tabId") == tab_id and tab.get("targetId") == target_id
    ]
    if len(tabs) != 1:
        raise AssertionError(
            f"owned tab {tab_id!r}/{target_id!r} was not mapped to one leased tab"
        )
    return tabs[0]


def _wait_for_assistant(tab, expected, timeout=180):
    code = (
        "import json, time\n"
        f"switch_tab({json.dumps(tab['targetId'])})\n"
        f"expected = {json.dumps(expected)}\n"
        f"deadline = time.time() + {timeout}\n"
        "stable = 0\n"
        "while time.time() < deadline:\n"
        "    nodes = cdp('Accessibility.getFullAXTree').get('nodes', [])\n"
        "    matches = []\n"
        "    for node in nodes:\n"
        "        role = ((node.get('role') or {}).get('value') or '')\n"
        "        name = ((node.get('name') or {}).get('value') or '')\n"
        "        observed = ''.join(ch for ch in name if ch.isdigit()) if expected.isdigit() else name\n"
        "        if role in ('StaticText', 'InlineTextBox', 'paragraph') and expected in observed:\n"
        "            matches.append(name)\n"
        "    if matches:\n"
        "        stable += 1\n"
        "        if stable >= 2:\n"
        "            print(json.dumps({'assistant_match': matches[-1]}))\n"
        "            raise SystemExit(0)\n"
        "    else:\n"
        "        stable = 0\n"
        "    time.sleep(1)\n"
        "raise RuntimeError('assistant response containing expected text was not observed')\n"
    )
    output = _browser_harness(code, timeout=timeout + 30)
    return json.loads(output.strip().splitlines()[-1])


def _release(tab):
    output = _browser_harness(
        "switch_tab(" + json.dumps(tab["targetId"]) + ")\n"
        "close_tab(" + json.dumps(tab["targetId"]) + ")\n"
        "print(json.dumps(workspace_status()))\n"
    )
    return json.loads(output.strip().splitlines()[-1])


def _assert_baseline(baseline):
    current = set(_workspace_snapshot()["status"].get("leasedTabIds", []))
    baseline_ids = set(baseline["status"].get("leasedTabIds", []))
    leaked = current - baseline_ids
    assert not leaked, {
        "leaked": sorted(leaked),
        "current": sorted(current),
        "baseline": sorted(baseline_ids),
    }


@pytest.mark.skipif(
    os.environ.get("CHATGPT_BROWSER_E2E") != "1",
    reason="set CHATGPT_BROWSER_E2E=1 to run the authenticated real-browser test",
)
def test_real_browser_temporary_chat_plain_text_and_attachment(tmp_path):
    baseline = _workspace_snapshot()

    left = secrets.randbelow(40_000) + 10_000
    right = secrets.randbelow(40_000) + 10_000
    plain_expected = str(left + right)
    plain_result = _submit(f"What is {left} + {right}? Reply with the number.")
    assert plain_result["verified"] is True
    plain_tab = _owned_tab(plain_result)
    try:
        _wait_for_assistant(plain_tab, plain_expected)
    finally:
        _release(plain_tab)
    _assert_baseline(baseline)

    fact_number = str(secrets.randbelow(900_000_000) + 100_000_000)
    attachment = tmp_path / "fact.txt"
    attachment.write_text(f"The fact number is {fact_number}.\n", encoding="utf-8")
    attachment_result = _submit(
        "Read the attached file and tell me the fact number it contains.", [attachment]
    )
    assert attachment_result["verified"] is True
    attachment_tab = _owned_tab(attachment_result)
    try:
        _wait_for_assistant(attachment_tab, fact_number)
    finally:
        _release(attachment_tab)
    _assert_baseline(baseline)

    print(json.dumps({
        "e2e": "passed",
        "plain_text": "passed",
        "attachment_fact_number": fact_number,
        "leases_restored": True,
    }))


@pytest.mark.skipif(
    os.environ.get("CHATGPT_BROWSER_E2E") != "1",
    reason="set CHATGPT_BROWSER_E2E=1 to run the authenticated real-browser test",
)
def test_real_browser_existing_thread_submit():
    baseline = _workspace_snapshot()
    thread_url = _create_persistent_thread()
    _assert_baseline(baseline)

    left = secrets.randbelow(40_000) + 10_000
    right = secrets.randbelow(40_000) + 10_000
    expected = str(left + right)
    result = _thread_submit(
        thread_url,
        f"What is {left} + {right}? Reply with the number only.",
    )

    assert result["verified"] is True
    assert result["temporary"] is False
    assert result["thread_url"].split("?", 1)[0] == thread_url.split("?", 1)[0]

    tab = _owned_tab(result)
    try:
        assert tab["url"].split("?", 1)[0] == thread_url.split("?", 1)[0]
        _wait_for_assistant(tab, expected)
    finally:
        _release(tab)
    _assert_baseline(baseline)

    print(json.dumps({
        "e2e": "passed",
        "mode": "existing-thread",
        "thread_url": thread_url,
        "expected": expected,
        "leases_restored": True,
    }))
