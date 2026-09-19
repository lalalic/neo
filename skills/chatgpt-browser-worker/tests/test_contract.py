from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("chatgpt_browser_worker_contract", HERE / "scripts/contract.py")
assert spec and spec.loader
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)


def state(status="created", project=None):
    return {
        "schema_version": 1,
        "thread_id": "thread-1",
        "project": project or {"id": "project-1", "name": "neo"},
        "status": status,
        "requested_thinking_level": "high",
        "effective_thinking_level": "unknown",
    }


def test_create_and_resume_require_verified_project_and_preserve_level_request():
    created = contract.validate_request(
        {"operation": "create", "project": {"name": "neo"}, "prompt": "hello", "thinking_level": "high"}
    )
    resumed = contract.validate_request(
        {"operation": "resume", "thread_id": "thread-1", "project": {"id": "project-1", "name": "neo"}}
    )
    assert created["project"] == {"name": "neo"}
    assert created["thinking_level"] == "high"
    assert resumed["thread_id"] == "thread-1"
    with pytest.raises(contract.ContractError):
        contract.validate_request({"operation": "create", "prompt": "hello", "thinking_level": "high"})


def test_project_mismatch_is_rejected_and_unknown_effective_level_is_valid():
    current = contract.validate_state(state())
    assert current["effective_thinking_level"] == "unknown"
    with pytest.raises(contract.ContractError, match="Project"):
        contract.transition(current, "running", observed_project={"id": "other", "name": "other"})


def test_completion_requires_explicit_transition_and_delete_is_terminal():
    running = contract.transition(state(), "running")
    waiting = contract.transition(running, "awaiting_result")
    completed = contract.transition(waiting, "completed")
    assert completed["status"] == "completed"
    deleted = contract.transition(completed, "deleted")
    assert deleted["status"] == "deleted"
    with pytest.raises(contract.ContractError, match="terminal"):
        contract.transition(deleted, "running")


def test_contract_module_has_no_browser_runtime_dependency():
    source = (HERE / "scripts/contract.py").read_text()
    assert "import browser_harness" not in source
    assert "import macbridge" not in source.lower()
