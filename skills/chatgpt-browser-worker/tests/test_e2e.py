import json
import os
import secrets
import subprocess
import tempfile
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
TEMPORARY = ROOT / "scripts" / "temporary_bh.py"


def _browser_harness(code):
    completed = subprocess.run(
        ["browser-harness"], input=code, text=True, capture_output=True, timeout=60
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


def _new_leased_tab(baseline):
    snapshot = _workspace_snapshot()
    before = set(baseline["status"].get("leasedTabIds", []))
    leased = set(snapshot["status"].get("leasedTabIds", []))
    new_ids = leased - before
    if len(new_ids) != 1:
        raise AssertionError(f"expected one new lease, got {sorted(new_ids)}")
    tab_id = next(iter(new_ids))
    tabs = [tab for tab in snapshot["tabs"] if tab.get("tabId") == tab_id]
    if len(tabs) != 1:
        raise AssertionError(f"new lease {tab_id!r} was not mapped to one tab")
    return tabs[0]


def _wait_for_assistant(tab, expected, timeout=180):
    code = (
        "import json, time\n"
        f"switch_tab({json.dumps(tab['targetId'])})\n"
        f"expected = {json.dumps(expected)}\n"
        f"deadline = time.time() + {timeout}\n"
        "last = ''\n"
        "while time.time() < deadline:\n"
        "    state = js('''(() => {\n"
        "      const nodes = [...document.querySelectorAll('[data-message-author-role=\\\"assistant\\\"]')];\n"
        "      const text = nodes.map(e => (e.innerText || '').trim()).filter(Boolean).join('\\n');\n"
        "      const busy = [...document.querySelectorAll('[aria-busy=\\\"true\\\"], [data-is-streaming=\\\"true\\\"]')].some(e => { const r=e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });\n"
        "      return {text, busy};\n"
        "    })()''') or {'text': '', 'busy': True}\n"
        "    if expected in state['text'] and not state['busy'] and state['text'] == last:\n"
        "        print(json.dumps({'assistant': state['text']}))\n"
        "        raise SystemExit(0)\n"
        "    last = state['text']\n"
        "    time.sleep(1)\n"
        "raise RuntimeError('assistant response containing expected text was not observed')\n"
    )
    output = _browser_harness(code)
    return json.loads(output.strip().splitlines()[-1])


def _release(tab):
    output = _browser_harness(
        "switch_tab(" + json.dumps(tab["targetId"]) + ")\n"
        "close_tab(" + json.dumps(tab["targetId"]) + ")\n"
        "print(json.dumps(workspace_status()))\n"
    )
    return json.loads(output.strip().splitlines()[-1])


def _assert_baseline(baseline):
    current = _workspace_snapshot()["status"].get("leasedTabIds", [])
    expected = baseline["status"].get("leasedTabIds", [])
    assert set(current) == set(expected), (current, expected)


@pytest.mark.skipif(
    os.environ.get("CHATGPT_BROWSER_E2E") != "1",
    reason="set CHATGPT_BROWSER_E2E=1 to run the authenticated real-browser test",
)
def test_real_browser_temporary_chat_plain_text_and_attachment(tmp_path):
    baseline = _workspace_snapshot()

    plain_marker = f"plain-{secrets.randbelow(900_000_000) + 100_000_000}"
    plain_result = _submit(f"Reply with this exact marker: {plain_marker}")
    assert plain_result["verified"] is True
    plain_tab = _new_leased_tab(baseline)
    try:
        _wait_for_assistant(plain_tab, plain_marker)
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
    attachment_tab = _new_leased_tab(baseline)
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
