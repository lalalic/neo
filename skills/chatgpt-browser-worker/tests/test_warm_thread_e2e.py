import json
import os
import secrets
import subprocess
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
CREATE_THREAD_BH = Path(__file__).with_name("_create_thread_bh.py")
READINESS = ROOT / "scripts" / "_submit_readiness.py"
COMMON = ROOT / "scripts" / "_submit_bh.py"


def _browser_harness(code, timeout=240):
    completed = subprocess.run(
        ["browser-harness"], input=code, text=True, capture_output=True, timeout=timeout
    )
    if completed.returncode:
        raise AssertionError(completed.stderr or completed.stdout)
    return completed.stdout


def _workspace_snapshot():
    out = _browser_harness(
        "import json\n"
        "print(json.dumps({'status': workspace_status(), 'tabs': list_tabs(include_chrome=False)}))\n"
    )
    return json.loads(out.strip().splitlines()[-1])


def _assert_no_new_leases(baseline):
    current = set(_workspace_snapshot()["status"].get("leasedTabIds", []))
    baseline_ids = set(baseline["status"].get("leasedTabIds", []))
    leaked = current - baseline_ids
    assert not leaked, {
        "leaked": sorted(leaked),
        "current": sorted(current),
        "baseline": sorted(baseline_ids),
    }


def _create_persistent_thread():
    last_error = None
    for _ in range(2):
        marker = f"WARM_THREAD_CREATE_{secrets.token_hex(6)}"
        code = CREATE_THREAD_BH.read_text(encoding="utf-8").replace(
            "__MARKER__", json.dumps(marker)
        )
        try:
            out = _browser_harness(code, timeout=300)
            return json.loads(out.strip().splitlines()[-1])["thread_url"]
        except AssertionError as exc:
            last_error = exc
    raise last_error


def _run_warm_rounds(thread_url, rounds):
    with tempfile.TemporaryDirectory(prefix="chatgpt-warm-thread-e2e-") as run_dir:
        cfg_path = Path(run_dir) / "config.json"
        cfg_path.write_text(
            json.dumps({
                "prompt": "",
                "file": [],
                "release_file": str(Path(run_dir) / "release"),
                "close_policy": "after-terminal",
            }),
            encoding="utf-8",
        )

        body = r'''
from urllib.parse import urlsplit

thread_url = __THREAD_URL__
expected_path = urlsplit(thread_url).path.rstrip("/")
rounds = __ROUNDS__

target_id = _new_owned_tab(thread_url)
wait_for_load()

deadline = time.time() + 30
while time.time() < deadline:
    current_url = page_info().get("url", "")
    if urlsplit(current_url).path.rstrip("/") == expected_path:
        break
    time.sleep(.25)
else:
    raise RuntimeError("warm-thread URL mismatch")

wait_until_stable(
    lambda: {"selector": _composer()},
    lambda state: bool(state["selector"]),
    timeout=30,
    phase="warm-thread initial hydration",
)

results = []
for index, item in enumerate(rounds, start=1):
    prompt = item["prompt"]
    expected = item["expected"]
    CFG["prompt"] = prompt
    CFG["file"] = []

    started = time.time()
    receipt = _submit_current_page(
        prompt,
        temporary=False,
        mode_label=f"Warm existing thread round {index}",
    )
    submitted = time.time()

    deadline = time.time() + 90
    stable = 0
    assistant_match = None
    while time.time() < deadline:
        nodes = cdp("Accessibility.getFullAXTree").get("nodes", [])
        matches = []
        for node in nodes:
            role = ((node.get("role") or {}).get("value") or "")
            name = ((node.get("name") or {}).get("value") or "")
            observed = "".join(ch for ch in name if ch.isdigit()) if expected.isdigit() else name
            if role in ("StaticText", "InlineTextBox", "paragraph") and expected in observed:
                matches.append(name)
        if matches:
            stable += 1
            assistant_match = matches[-1]
            if stable >= 2:
                break
        else:
            stable = 0
        time.sleep(.25)
    else:
        raise RuntimeError(
            f"warm-thread round {index} assistant response {expected!r} was not observed"
        )

    completed = time.time()
    current_url = page_info().get("url", "").split("?", 1)[0]
    current = current_tab()
    if urlsplit(current_url).path.rstrip("/") != expected_path:
        raise RuntimeError(f"warm-thread navigated away in round {index}: {current_url}")
    if current.get("targetId") != target_id:
        raise RuntimeError(
            f"warm-thread target changed in round {index}: "
            f"{current.get('targetId')!r} != {target_id!r}"
        )

    results.append({
        "round": index,
        "expected": expected,
        "assistant_match": assistant_match,
        "submit_ms": round((submitted - started) * 1000, 1),
        "response_ms": round((completed - submitted) * 1000, 1),
        "total_ms": round((completed - started) * 1000, 1),
        "verified_by": receipt["verified_by"],
        "target_id": target_id,
        "tab_id": current.get("tabId"),
        "thread_url": current_url,
    })

close_tab(target_id)
_OWNED_TABS.clear()
print(json.dumps({
    "mode": "warm-existing-thread",
    "thread_url": thread_url,
    "rounds": results,
}, ensure_ascii=False))
'''
        sep = chr(10)
        code = (
            READINESS.read_text(encoding="utf-8")
            + sep
            + COMMON.read_text(encoding="utf-8").replace("__CFG_PATH__", str(cfg_path))
            + sep
            + body.replace("__THREAD_URL__", json.dumps(thread_url))
                  .replace("__ROUNDS__", json.dumps(rounds))
        )
        out = _browser_harness(code, timeout=600)
        return json.loads(out.strip().splitlines()[-1])


@pytest.mark.skipif(
    os.environ.get("CHATGPT_BROWSER_E2E") != "1",
    reason="set CHATGPT_BROWSER_E2E=1 to run the authenticated real-browser test",
)
def test_real_browser_warm_existing_thread_five_rounds():
    baseline = _workspace_snapshot()
    thread_url = _create_persistent_thread()
    _assert_no_new_leases(baseline)

    rounds = []
    for _ in range(5):
        left = secrets.randbelow(40_000) + 10_000
        right = secrets.randbelow(40_000) + 10_000
        rounds.append({
            "prompt": f"What is {left} + {right}? Reply with the number only.",
            "expected": str(left + right),
        })

    result = _run_warm_rounds(thread_url, rounds)
    assert len(result["rounds"]) == 5

    assert len({item["target_id"] for item in result["rounds"]}) == 1
    assert len({item["tab_id"] for item in result["rounds"]}) == 1
    assert {item["thread_url"] for item in result["rounds"]} == {
        thread_url.split("?", 1)[0]
    }

    for expected, item in zip((r["expected"] for r in rounds), result["rounds"]):
        observed = "".join(ch for ch in item["assistant_match"] if ch.isdigit())
        assert expected in observed
        assert item["verified_by"] in ("user-turn", "composer-cleared")

    _assert_no_new_leases(baseline)
    print(json.dumps({
        "e2e": "passed",
        "mode": "warm-existing-thread",
        "round_count": 5,
        "same_target": True,
        "same_tab": True,
        "same_thread": True,
        "rounds": result["rounds"],
        "leases_restored": True,
    }))
