from pathlib import Path


AGENT = Path(__file__).parents[1] / "agents" / "browser-worker.agent.md"


def test_browser_worker_agent_defines_typed_lifecycle_and_verified_result():
    text = AGENT.read_text()

    for operation in ("create", "resume", "continue", "status", "result", "delete"):
        assert f"`{operation}`" in text
    for field in ("thread_id", "project", "message_id", "verified", "observed_at"):
        assert f'"{field}"' in text
    assert "browser-harness" in text
    assert "authentication_required" in text
    assert "Do not report success" in text


def test_callers_are_directed_to_launch_agent_not_helper_scripts():
    skill = (AGENT.parents[1] / "SKILL.md").read_text()
    orchestration = (AGENT.parents[1] / "references" / "orchestration.md").read_text()

    assert "Callers launch that" in skill
    assert "agent with a typed lifecycle intent" in skill
    assert "must not directly call" in skill
    assert "launches the `browser-worker` agent" in orchestration
    assert "must not directly invoke" in orchestration


def test_worker_contract_requires_operation_scoped_tab_cleanup():
    skill = (Path(__file__).parents[1] / "SKILL.md").read_text()
    contract = (Path(__file__).parents[1] / "references" / "contract.md").read_text()
    create_driver = (Path(__file__).parents[1] / "scripts" / "_create_bh.py").read_text()
    operate_driver = (Path(__file__).parents[1] / "scripts" / "_operate_bh.py").read_text()
    assert "must close every tab it created" in skill
    assert "Tabs that existed before the operation started must never be closed" in contract
    for source in (create_driver, operate_driver):
        assert "atexit.register(_close_owned_tabs)" in source
        assert "close_tab(target_id)" in source
        assert "_new_owned_tab(" in source


def test_send_isolated_tab_and_full_ready_contract():
    skill = (Path(__file__).parents[1] / "SKILL.md").read_text()
    contract = (Path(__file__).parents[1] / "references" / "contract.md").read_text()
    agent = AGENT.read_text()
    driver = (Path(__file__).parents[1] / "scripts" / "_operate_bh.py").read_text()

    assert "Every `send`/follow-up operation must open its own fresh tab" in skill
    assert "Sending from a pre-existing/shared user tab is forbidden" in contract
    assert "Wait for full browser hydration" in agent
    assert 'if operation in {"send", "continue"}:' in driver
    assert '_new_owned_tab(f"https://chatgpt.com/c/{THREAD_ID}")' in driver
    assert "_wait_thread_ready(require_composer=True)" in driver
    assert 'ready_state == "complete"' in driver


def test_prompt_defines_output_contract():
    skill = (Path(__file__).parents[1] / "SKILL.md").read_text()
    contract = (Path(__file__).parents[1] / "references" / "contract.md").read_text()
    agent = AGENT.read_text()
    orchestration = (Path(__file__).parents[1] / "references" / "orchestration.md").read_text()

    assert "browser worker owns reliable submission, not the task's completion semantics" in skill
    assert "prompt MUST state the durable output destination or action" in contract
    assert "Do not invent or impose a universal callback/event/file convention" in agent
    assert "Submission and completion are separate concerns" in orchestration
    assert "update a managed PR/job/task" in skill
    assert "write a report or structured result" in skill
