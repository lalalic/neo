import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location("execution_director_contract", ROOT / "scripts/contract.py")
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)


def scene():
    return {
        "id": "profiles",
        "purpose": "Reveal separate learning spaces",
        "communicates": "Each child has a distinct profile",
        "visible_evidence": ["Two named child profiles are visible"],
        "presentation": {"focus": "kids list", "highlight": ["profile rows"], "text": ["One profile per child"], "zoom": "emphasis", "duration_seconds": 6},
    }


def plan():
    return {
        "schema_version": 1,
        "source_scene_id": "profiles",
        "shots": [{
            "id": "profiles",
            "identity": {"product": "Family Tutor", "surface": "extension popup", "feature": "kids list"},
            "intent": {"purpose": "Reveal separate learning spaces", "communicates": "Each child has a distinct profile"},
            "required_visible_evidence": ["Two named child profiles are visible"],
            "success": {"fresh_ui_required": True, "visible_state": "The two profiles are visible in the current UI"},
            "presentation": scene()["presentation"],
            "autonomy": {"allowed_recovery": ["reopen the product surface", "retry the same semantic goal once"], "boundary": "Stop and report if the required visible state cannot be verified from fresh UI."},
        }],
    }


def test_plan_and_scene_conversion_are_valid():
    contract.validate_plan(plan())
    converted = contract.from_video_scene(scene(), product="Family Tutor", surface="extension popup", feature="kids list", visible_state="The two profiles are visible", allowed_recovery=["reopen the surface"], boundary="Stop if fresh UI cannot verify the state.")
    assert converted["shots"][0]["success"]["fresh_ui_required"] is True


def test_contract_rejects_automation_details():
    bad = plan()
    bad["shots"][0]["coordinates"] = {"x": 1, "y": 2}
    with pytest.raises(contract.ContractError, match="runtime automation"):
        contract.validate_plan(bad)
    bad = plan()
    bad["shots"][0]["autonomy"]["boundary"] = "Use a fixed click sequence"
    with pytest.raises(contract.ContractError, match="forbidden runtime detail"):
        contract.validate_plan(bad)


def test_fresh_ui_and_unique_ids_are_required():
    bad = plan()
    bad["shots"][0]["success"]["fresh_ui_required"] = False
    with pytest.raises(contract.ContractError, match="fresh_ui_required"):
        contract.validate_plan(bad)
    bad = plan()
    bad["shots"].append(bad["shots"][0].copy())
    with pytest.raises(contract.ContractError, match="duplicate shot id"):
        contract.validate_plan(bad)
