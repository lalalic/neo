"""Pure validation for the Demo Worker intent and evidence contracts."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


REQUIRED_EVIDENCE = ("target", "scenario", "success", "artifact", "computer_use", "recoveries")


class ContractError(ValueError):
    pass


def _text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{name} must be a non-empty string")
    return value.strip()


def validate_intent(intent: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(intent, dict):
        raise ContractError("intent must be an object")
    for key in ("target", "scenario", "success", "recording", "evidence"):
        if not isinstance(intent.get(key), dict):
            raise ContractError(f"{key} must be an object")

    target = intent["target"]
    _text(target.get("product"), "target.product")
    _text(target.get("app"), "target.app")
    scenario = intent["scenario"]
    _text(scenario.get("feature"), "scenario.feature")
    if not isinstance(scenario.get("steps"), list) or not scenario["steps"]:
        raise ContractError("scenario.steps must be a non-empty list")
    if any(not isinstance(step, str) or not step.strip() for step in scenario["steps"]):
        raise ContractError("scenario.steps must contain non-empty strings")

    success = intent["success"]
    _text(success.get("visible_state"), "success.visible_state")
    if success.get("fresh_ui_required") is not True:
        raise ContractError("success.fresh_ui_required must be true")

    recording = intent["recording"]
    if recording.get("required") is not True:
        raise ContractError("recording.required must be true")
    _text(recording.get("scope"), "recording.scope")
    _text(recording.get("format"), "recording.format")

    evidence = intent["evidence"]
    if evidence.get("artifact_required") is not True:
        raise ContractError("evidence.artifact_required must be true")
    fields = evidence.get("fields")
    if not isinstance(fields, list) or any(not isinstance(field, str) for field in fields):
        raise ContractError("evidence.fields must be a list of strings")
    missing = [field for field in REQUIRED_EVIDENCE if field not in fields]
    if missing:
        raise ContractError(f"evidence.fields missing: {', '.join(missing)}")
    return intent


def validate_evidence(evidence: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(evidence, dict):
        raise ContractError("evidence must be an object")
    missing = [field for field in REQUIRED_EVIDENCE if field not in evidence]
    if missing:
        raise ContractError(f"evidence missing: {', '.join(missing)}")
    artifact = evidence["artifact"]
    if not isinstance(artifact, dict):
        raise ContractError("evidence.artifact must be an object")
    _text(artifact.get("path"), "evidence.artifact.path")
    size = artifact.get("size_bytes")
    if not isinstance(size, int) or size <= 0:
        raise ContractError("evidence.artifact.size_bytes must be positive")
    duration = artifact.get("duration_seconds")
    if duration is not None and (not isinstance(duration, (int, float)) or duration <= 0):
        raise ContractError("evidence.artifact.duration_seconds must be positive when present")
    success = evidence["success"]
    if not isinstance(success, dict) or success.get("fresh_ui_verified") is not True:
        raise ContractError("evidence.success.fresh_ui_verified must be true")
    computer_use = evidence["computer_use"]
    if not isinstance(computer_use, dict) or computer_use.get("used") is not True:
        raise ContractError("evidence.computer_use.used must be true")
    if not isinstance(evidence["recoveries"], list):
        raise ContractError("evidence.recoveries must be a list")
    return evidence


def _main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"usage: {argv[0]} INTENT.json", file=sys.stderr)
        return 2
    try:
        intent = json.loads(Path(argv[1]).read_text())
        validate_intent(intent)
    except (OSError, json.JSONDecodeError, ContractError) as exc:
        print(f"invalid demo intent: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"valid": True, "target": intent["target"], "feature": intent["scenario"]["feature"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv))
