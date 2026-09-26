"""Pure validation and conversion for the Execution Director contract."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


class ContractError(ValueError):
    pass


FORBIDDEN_KEYS = {"actions", "coordinates", "selector", "selectors", "xpath", "click_sequence", "keypress_sequence"}
FORBIDDEN_TERMS = ("coordinate", "css selector", "xpath", "click sequence", "keypress sequence", "fixed click", "mouse click")


def _text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{name} must be a non-empty string")
    return value.strip()


def _reject_automation(value: Any, path: str = "plan") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key.lower() in FORBIDDEN_KEYS:
                raise ContractError(f"{path}.{key} is runtime automation detail")
            _reject_automation(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_automation(child, f"{path}[{index}]")
    elif isinstance(value, str):
        lowered = value.lower()
        for term in FORBIDDEN_TERMS:
            if term in lowered:
                raise ContractError(f"{path} contains forbidden runtime detail: {term}")


def _strings(value: Any, name: str, *, nonempty: bool = True) -> list[str]:
    if not isinstance(value, list) or (nonempty and not value) or any(not isinstance(item, str) or not item.strip() for item in value):
        raise ContractError(f"{name} must be a {'non-empty ' if nonempty else ''}list of strings")
    return value


def validate_shot(shot: dict[str, Any], prefix: str = "shot") -> dict[str, Any]:
    if not isinstance(shot, dict):
        raise ContractError(f"{prefix} must be an object")
    shot_id = _text(shot.get("id"), f"{prefix}.id")
    if any(char not in "abcdefghijklmnopqrstuvwxyz0123456789-" for char in shot_id):
        raise ContractError(f"{prefix}.id must use lowercase letters, digits, and hyphens")
    identity = shot.get("identity")
    if not isinstance(identity, dict):
        raise ContractError(f"{prefix}.identity must be an object")
    for field in ("product", "surface", "feature"):
        _text(identity.get(field), f"{prefix}.identity.{field}")
    intent = shot.get("intent")
    if not isinstance(intent, dict):
        raise ContractError(f"{prefix}.intent must be an object")
    for field in ("purpose", "communicates"):
        _text(intent.get(field), f"{prefix}.intent.{field}")
    _strings(shot.get("required_visible_evidence"), f"{prefix}.required_visible_evidence")
    success = shot.get("success")
    if not isinstance(success, dict) or success.get("fresh_ui_required") is not True:
        raise ContractError(f"{prefix}.success.fresh_ui_required must be true")
    _text(success.get("visible_state"), f"{prefix}.success.visible_state")
    presentation = shot.get("presentation")
    if not isinstance(presentation, dict):
        raise ContractError(f"{prefix}.presentation must be an object")
    _text(presentation.get("focus"), f"{prefix}.presentation.focus")
    _strings(presentation.get("highlight"), f"{prefix}.presentation.highlight", nonempty=False)
    _strings(presentation.get("text"), f"{prefix}.presentation.text", nonempty=False)
    if presentation.get("zoom") not in {"none", "subtle", "emphasis"}:
        raise ContractError(f"{prefix}.presentation.zoom is invalid")
    seconds = presentation.get("duration_seconds")
    if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or seconds <= 0:
        raise ContractError(f"{prefix}.presentation.duration_seconds must be positive")
    autonomy = shot.get("autonomy")
    if not isinstance(autonomy, dict):
        raise ContractError(f"{prefix}.autonomy must be an object")
    _strings(autonomy.get("allowed_recovery"), f"{prefix}.autonomy.allowed_recovery", nonempty=False)
    _text(autonomy.get("boundary"), f"{prefix}.autonomy.boundary")
    return shot


def validate_plan(plan: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(plan, dict) or plan.get("schema_version") != 1:
        raise ContractError("plan.schema_version must be 1")
    _text(plan.get("source_scene_id"), "plan.source_scene_id")
    shots = plan.get("shots")
    if not isinstance(shots, list) or not shots:
        raise ContractError("plan.shots must be a non-empty list")
    ids: set[str] = set()
    for index, shot in enumerate(shots):
        validate_shot(shot, f"shots[{index}]")
        if shot["id"] in ids:
            raise ContractError(f"duplicate shot id: {shot['id']}")
        ids.add(shot["id"])
    _reject_automation(plan)
    return plan


def from_video_scene(scene: dict[str, Any], *, product: str, surface: str, feature: str, visible_state: str, allowed_recovery: list[str], boundary: str) -> dict[str, Any]:
    """Convert one Video Director scene without inventing runtime navigation."""
    if not isinstance(scene, dict):
        raise ContractError("scene must be an object")
    for field in ("id", "purpose", "communicates", "visible_evidence", "presentation"):
        if field not in scene:
            raise ContractError(f"scene.{field} is required")
    shot = {
        "id": scene["id"],
        "identity": {"product": product, "surface": surface, "feature": feature},
        "intent": {"purpose": scene["purpose"], "communicates": scene["communicates"]},
        "required_visible_evidence": scene["visible_evidence"],
        "success": {"fresh_ui_required": True, "visible_state": visible_state},
        "presentation": scene["presentation"],
        "autonomy": {"allowed_recovery": allowed_recovery, "boundary": boundary},
    }
    return validate_plan({"schema_version": 1, "source_scene_id": scene["id"], "shots": [shot]})


def _main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"usage: {argv[0]} PLAN.json", file=sys.stderr)
        return 2
    try:
        plan = json.loads(Path(argv[1]).read_text())
        validate_plan(plan)
    except (OSError, json.JSONDecodeError, ContractError) as exc:
        print(f"invalid execution director plan: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"valid": True, "shot_count": len(plan["shots"])}))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv))
