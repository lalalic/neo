from pathlib import Path


ROOT = Path(__file__).parents[1]
AGENT = ROOT / "agents" / "browser-worker.agent.md"
SKILL = ROOT / "SKILL.md"
DRIVER = ROOT / "scripts" / "_temporary_bh.py"
OWNED_TAB_DRIVERS = [
    ROOT / "scripts" / name
    for name in ("_temporary_bh.py", "_create_bh.py", "_infer_bh.py", "_operate_bh.py")
]
ORCHESTRATOR = ROOT.parent / "xchat-orchestrator" / "SKILL.md"


def test_public_skill_exposes_only_two_durable_output_modes():
    text = SKILL.read_text()

    assert "Task / PR output" in text
    assert "File output" in text
    assert "exactly one durable output mode" in text
    assert "invalid and must not be launched" in text
    assert "Events are execution observability, not a third output mode" in text

    for lifecycle in ("resume(thread_id", "status(thread_id", "result(thread_id", "continue("):
        assert lifecycle not in text


def test_orchestrator_must_choose_output_before_child_creation():
    text = ORCHESTRATOR.read_text()

    assert "Browser ChatGPT worker output is fixed at task creation" in text
    assert "read that skill before creating the child" in text
    assert "task/PR output" in text
    assert "file output" in text
    assert "Do not launch the Browser ChatGPT worker without this declaration" in text
    assert "This decision belongs to the orchestrator at child-task creation time" in text


def test_browser_worker_agent_is_submit_and_close_only():
    text = AGENT.read_text()

    assert "one-shot submission" in text
    assert "Do not expose or operate a" in text
    assert "create/resume/status/result/continue lifecycle" in text
    assert "Do not change model or thinking settings" in text
    assert "wait for the assistant response" in text.lower()
    assert "do not reopen or poll the conversation" in text.lower()
    assert "never as a resumable handle" in text


def test_all_owned_tab_drivers_use_workspace_aware_acquisition():
    for driver in OWNED_TAB_DRIVERS:
        text = driver.read_text()
        assert 'target_id = new_tab(url)' in text, driver.name
        assert '_collision_safe_url' not in text, driver.name
        assert 'neo_owned_tab' not in text, driver.name
        assert 'cdp("Target.createTarget"' not in text, driver.name
        assert 'switch_tab(target_id)' not in text, driver.name
        assert 'close_tab(' in text, driver.name


def test_submit_driver_uses_fresh_owned_tab_and_temporary_chat():
    text = DRIVER.read_text()

    assert 'target_id = new_tab(url)' in text
    assert 'cdp("Target.createTarget"' not in text
    assert '_new_owned_tab("https://chatgpt.com/")' in text
    assert "_click_temporary_chat_toggle()" in text
    assert "Temporary Chat toggle was not actionable" in text
    assert "Temporary Chat toggle is ambiguous" in text
    assert "def _temporary_chat_enabled()" in text
    assert 'button[aria-label="Send"]' in text
    assert "submission_receipt(" in text
    assert "atexit.register(_close_owned_tabs)" in text
    assert "thinking_level" not in text


def test_submit_driver_returns_after_verified_user_turn_not_assistant_result():
    text = DRIVER.read_text()

    assert "_wait_user_turn" in text
    assert '"operation": "submit"' in text
    assert '"status": "submitted"' in text
    assert '"diagnostic_thread_id"' in text
    assert "_wait_result" not in text
    assert "_assistant_messages" not in text
    assert "expect_json" not in text


def test_callers_use_agent_not_helper_scripts():
    skill = SKILL.read_text()
    agent = AGENT.read_text()

    assert "Callers launch that agent" in skill
    assert "do not call helper" in skill
    assert "Callers must not" in agent
