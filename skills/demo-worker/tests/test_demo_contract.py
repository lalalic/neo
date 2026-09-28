import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location("demo_contract", ROOT / "scripts/contract.py")
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)


def intent():
    return {
        "target": {"product": "Chrome", "app": "Demo", "url": "https://example.test"},
        "scenario": {"feature": "search", "steps": ["Open search", "Enter Neo"]},
        "success": {"visible_state": "Results are visible", "fresh_ui_required": True},
        "recording": {"required": True, "scope": "full_flow", "format": "mp4"},
        "evidence": {"artifact_required": True, "fields": list(contract.REQUIRED_EVIDENCE)},
    }


def evidence():
    return {
        "target": {"product": "Chrome", "app": "Demo"},
        "scenario": {"feature": "search"},
        "success": {"fresh_ui_verified": True},
        "artifact": {"path": "runs/2026-09-25-demo/output.mp4", "size_bytes": 12, "duration_seconds": 1.2},
        "computer_use": {"used": True, "path": "browser-harness"},
        "recoveries": [],
    }


def test_intent_requires_fresh_ui_and_recording():
    contract.validate_intent(intent())
    bad = intent()
    bad["success"]["fresh_ui_required"] = False
    with pytest.raises(contract.ContractError, match="fresh_ui_required"):
        contract.validate_intent(bad)


def test_intent_requires_all_evidence_fields():
    bad = intent()
    bad["evidence"]["fields"] = ["target"]
    with pytest.raises(contract.ContractError, match="evidence.fields missing"):
        contract.validate_intent(bad)


def test_evidence_rejects_empty_artifact_and_stale_success():
    contract.validate_evidence(evidence())
    bad = evidence()
    bad["artifact"]["size_bytes"] = 0
    with pytest.raises(contract.ContractError, match="size_bytes"):
        contract.validate_evidence(bad)
    bad = evidence()
    bad["success"]["fresh_ui_verified"] = False
    with pytest.raises(contract.ContractError, match="fresh_ui_verified"):
        contract.validate_evidence(bad)
