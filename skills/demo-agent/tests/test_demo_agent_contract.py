import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location("demo_agent_contract", ROOT / "scripts/contract.py")
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)


def request():
    return {
        "schema_version": 1,
        "item": {
            "id": "profiles",
            "type": "demo",
            "scene_id": "profiles",
            "output": "assets/profiles-demo.mp4",
            "identity": {"product": "Tutor", "surface": "popup", "feature": "profiles"},
            "intent": {"purpose": "Show profiles", "communicates": "Each child has one"},
            "required_visible_evidence": ["Two profiles"],
            "success": {"fresh_ui_required": True, "visible_state": "Two profiles are visible"},
            "presentation": {"focus": "list", "highlight": [], "text": [], "zoom": "none", "duration_seconds": 2},
            "autonomy": {"allowed_recovery": ["reopen surface"], "boundary": "Stop if not visible"},
        },
        "runtime": {"allowed_tools": ["computer-use"], "capture_scope": "shot", "recording_required": True},
    }


def evidence():
    return {
        "shot_id": "profiles",
        "target": {"product": "Tutor", "surface": "popup", "feature": "profiles"},
        "success": {"verified": True, "fresh_ui_verified": True, "visible_state": "Two profiles are visible"},
        "observations": [{"screenshot": "runs/2026-09-25-demo/profiles.png", "timestamp": "2026-09-25T21:00:00Z"}],
        "timeline": {"started_at": "2026-09-25T20:59:00Z", "verified_at": "2026-09-25T21:00:00Z"},
        "actions_summary": "Opened the product surface and reached the requested semantic state.",
        "recoveries": [],
        "recording": {"backend": "replaceable-adapter", "artifact_path": "runs/2026-09-25-demo/demo.mp4", "size_bytes": 100, "duration_seconds": 2.0},
    }


def test_request_requires_fresh_ui_and_keeps_runtime_policy_semantic():
    contract.validate_request(request())
    bad = request()
    bad["item"]["success"]["fresh_ui_required"] = False
    with pytest.raises(contract.ContractError, match="fresh_ui_required"):
        contract.validate_request(bad)
    bad = request()
    bad["item"]["actions"] = ["click"]
    with pytest.raises(contract.ContractError, match="automation detail"):
        contract.validate_request(bad)


def test_evidence_requires_observable_fresh_ui_and_recording():
    contract.validate_evidence(evidence())
    bad = evidence()
    bad["success"]["fresh_ui_verified"] = False
    with pytest.raises(contract.ContractError, match="fresh_ui_verified"):
        contract.validate_evidence(bad)
    bad = evidence()
    bad["recording"]["size_bytes"] = 0
    with pytest.raises(contract.ContractError, match="size_bytes"):
        contract.validate_evidence(bad)


def test_recording_requirement_is_adapter_policy():
    result = evidence()
    del result["recording"]
    contract.validate_evidence(result, recording_required=False)
