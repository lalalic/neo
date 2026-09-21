from pathlib import Path

ROOT = Path(__file__).parents[1]
WRAPPER = ROOT / "scripts" / "infer_bh.py"
DRIVER = ROOT / "scripts" / "_infer_bh.py"


def test_inference_is_same_tab_and_synchronous():
    text = DRIVER.read_text()
    assert '_new_owned_tab("https://chatgpt.com/")' in text
    assert "_submit(CFG[" in text
    assert "_result(CFG.get(" in text
    assert "atexit.register(_close_owned_tabs)" in text
    assert "open_thread" not in text
    assert "thread_id" not in text


def test_inference_validates_json_only_when_requested():
    text = DRIVER.read_text()
    wrapper = WRAPPER.read_text()
    assert 'CFG.get("expect_json")' in text
    assert "_parse_json_response(text)" in text
    assert "re.fullmatch" in text
    assert "json.loads(candidate)" in text
    assert "json.dumps(parsed" in text
    assert 'parser.add_argument("--expect-json"' in wrapper


def test_inference_waits_for_attachment_processing_and_verified_user_turn():
    text = DRIVER.read_text()
    assert 'state["pending"]' in text
    assert "stable >= 2" in text
    assert "submitted prompt did not become a durable user turn" in text
