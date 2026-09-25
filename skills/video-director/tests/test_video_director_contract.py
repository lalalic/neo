import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location("video_director_contract", ROOT / "scripts/contract.py")
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)


def brief():
    return {
        "product": "Family Tutor",
        "audience": "Parents",
        "channel": "product_demo",
        "duration_seconds": 30,
        "style": "clear",
        "goal": "Show separate profiles",
    }


def scene(scene_id="hook"):
    return {
        "id": scene_id,
        "purpose": "Reveal the value",
        "communicates": "Each child has a distinct learning space",
        "visible_evidence": ["Two child profiles are visible"],
        "presentation": {
            "focus": "kids list",
            "highlight": ["profile rows"],
            "text": ["A separate learning profile for each child"],
            "zoom": "emphasis",
            "duration_seconds": 6,
        },
    }


def plan():
    return {
        "schema_version": 1,
        "brief": brief(),
        "markcut_storyboard": "# video\nwidth:1920 height:1080 fps:30 layout:series\n",
        "scenes": [scene()],
    }


def test_plan_requires_semantic_visible_evidence_and_markcut():
    contract.validate_plan(plan())
    rendered = contract.render_markcut(brief(), [scene()])
    assert rendered.startswith("# video\n")
    assert "## hook" in rendered
    assert "- video" in rendered


def test_director_rejects_runtime_automation_details():
    bad = plan()
    bad["scenes"][0]["actions"] = ["click the extension icon"]
    with pytest.raises(contract.ContractError, match="runtime automation"):
        contract.validate_plan(bad)

    bad = plan()
    bad["scenes"][0]["communicates"] = "Use a fixed click sequence at coordinates"
    with pytest.raises(contract.ContractError, match="forbidden runtime detail"):
        contract.validate_plan(bad)


def test_plan_rejects_duplicate_ids_and_overlong_timeline():
    bad = plan()
    bad["scenes"].append(scene())
    with pytest.raises(contract.ContractError, match="duplicate scene id"):
        contract.validate_plan(bad)
    bad = plan()
    bad["scenes"][0]["presentation"]["duration_seconds"] = 40
    with pytest.raises(contract.ContractError, match="exceed brief duration"):
        contract.validate_plan(bad)
