"""Pure validation for Demo Agent demo-lane items and runtime evidence."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


class ContractError(ValueError):
    pass


FORBIDDEN_KEYS = {"actions", "coordinates", "selector", "selectors", "xpath", "click_sequence", "keypress_sequence"}


def _text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{name} must be a non-empty string")
    return value.strip()


def _strings(value: Any, name: str, *, nonempty: bool = True) -> list[str]:
    if not isinstance(value, list) or (nonempty and not value) or any(not isinstance(item, str) or not item.strip() for item in value):
        raise ContractError(f"{name} must be a {'non-empty ' if nonempty else ''}list of strings")
    return value


def _reject_automation(value: Any, path: str = "contract") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key.lower() in FORBIDDEN_KEYS:
                raise ContractError(f"{path}.{key} is runtime automation detail")
            _reject_automation(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_automation(child, f"{path}[{index}]")


def validate_request(request: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(request, dict) or request.get("schema_version") != 1:
        raise ContractError("request.schema_version must be 1")
    shot = request.get("item")
    if not isinstance(shot, dict):
        raise ContractError("request.item must be a demo execution item")
    required = ("id", "type", "scene_id", "output", "identity", "intent", "required_visible_evidence", "success", "presentation", "autonomy")
    missing = [field for field in required if field not in shot]
    if missing:
        raise ContractError(f"request.item missing: {', '.join(missing)}")
    _text(shot["id"], "request.item.id")
    if shot["type"] != "demo":
        raise ContractError("request.item.type must be demo")
    _text(shot["scene_id"], "request.item.scene_id")
    _text(shot["output"], "request.item.output")
    identity = shot["identity"]
    if not isinstance(identity, dict):
        raise ContractError("request.item.identity must be an object")
    for field in ("product", "surface", "feature"):
        _text(identity.get(field), f"request.item.identity.{field}")
    _strings(shot["required_visible_evidence"], "request.item.required_visible_evidence")
    success = shot["success"]
    if not isinstance(success, dict) or success.get("fresh_ui_required") is not True:
        raise ContractError("request.item.success.fresh_ui_required must be true")
    _text(success.get("visible_state"), "request.item.success.visible_state")
    runtime = request.get("runtime")
    if not isinstance(runtime, dict):
        raise ContractError("request.runtime must be an object")
    _strings(runtime.get("allowed_tools"), "request.runtime.allowed_tools")
    if runtime.get("capture_scope") not in {"shot", "full_flow"}:
        raise ContractError("request.runtime.capture_scope is invalid")
    if runtime.get("recording_required") is not True:
        raise ContractError("request.runtime.recording_required must be true")
    _reject_automation(request)
    return request


def validate_evidence(evidence: dict[str, Any], *, recording_required: bool = True) -> dict[str, Any]:
    if not isinstance(evidence, dict):
        raise ContractError("evidence must be an object")
    for field in ("shot_id", "target", "success", "observations", "timeline", "actions_summary", "recoveries"):
        if field not in evidence:
            raise ContractError(f"evidence missing: {field}")
    _text(evidence["shot_id"], "evidence.shot_id")
    target = evidence["target"]
    if not isinstance(target, dict):
        raise ContractError("evidence.target must be an object")
    for field in ("product", "surface", "feature"):
        _text(target.get(field), f"evidence.target.{field}")
    success = evidence["success"]
    if not isinstance(success, dict):
        raise ContractError("evidence.success must be an object")
    if success.get("verified") is not True:
        raise ContractError("evidence.success.verified must be true for completed evidence")
    if success.get("fresh_ui_verified") is not True:
        raise ContractError("evidence.success.fresh_ui_verified must be true")
    _text(success.get("visible_state"), "evidence.success.visible_state")
    observations = evidence["observations"]
    if not isinstance(observations, list) or not observations:
        raise ContractError("evidence.observations must be non-empty")
    for index, observation in enumerate(observations):
        if not isinstance(observation, dict):
            raise ContractError(f"evidence.observations[{index}] must be an object")
        _text(observation.get("screenshot"), f"evidence.observations[{index}].screenshot")
        _text(observation.get("timestamp"), f"evidence.observations[{index}].timestamp")
    _text(evidence["actions_summary"], "evidence.actions_summary")
    _strings(evidence["recoveries"], "evidence.recoveries", nonempty=False)
    timeline = evidence["timeline"]
    if not isinstance(timeline, dict):
        raise ContractError("evidence.timeline must be an object")
    for field in ("started_at", "verified_at"):
        _text(timeline.get(field), f"evidence.timeline.{field}")
    if recording_required:
        recording = evidence.get("recording")
        if not isinstance(recording, dict):
            raise ContractError("evidence.recording is required")
        _text(recording.get("backend"), "evidence.recording.backend")
        _text(recording.get("artifact_path"), "evidence.recording.artifact_path")
        size = recording.get("size_bytes")
        if not isinstance(size, int) or size <= 0:
            raise ContractError("evidence.recording.size_bytes must be positive")
        duration = recording.get("duration_seconds")
        if not isinstance(duration, (int, float)) or isinstance(duration, bool) or duration <= 0:
            raise ContractError("evidence.recording.duration_seconds must be positive")
    return evidence


def _main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"usage: {argv[0]} REQUEST.json", file=sys.stderr)
        return 2
    try:
        request = json.loads(Path(argv[1]).read_text())
        validate_request(request)
    except (OSError, json.JSONDecodeError, ContractError) as exc:
        print(f"invalid demo-agent request: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"valid": True, "shot_id": request["item"]["id"], "tools": request["runtime"]["allowed_tools"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv))
