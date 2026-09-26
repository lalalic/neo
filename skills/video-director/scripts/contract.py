"""Pure validation and Markcut rendering for the Video Director contract."""

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


def validate_brief(brief: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(brief, dict):
        raise ContractError("brief must be an object")
    for field in ("product", "audience", "channel", "style", "goal"):
        _text(brief.get(field), f"brief.{field}")
    duration = brief.get("duration_seconds")
    if not isinstance(duration, (int, float)) or isinstance(duration, bool) or duration <= 0:
        raise ContractError("brief.duration_seconds must be positive")
    _reject_automation(brief, "brief")
    return brief


def validate_plan(plan: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(plan, dict) or plan.get("schema_version") != 1:
        raise ContractError("plan.schema_version must be 1")
    validate_brief(plan.get("brief"))
    storyboard = plan.get("markcut_storyboard")
    if not isinstance(storyboard, str) or not storyboard.startswith("# video\n"):
        raise ContractError("markcut_storyboard must start with '# video'")
    scenes = plan.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise ContractError("scenes must be a non-empty list")
    ids: set[str] = set()
    total = 0.0
    for index, scene in enumerate(scenes):
        prefix = f"scenes[{index}]"
        if not isinstance(scene, dict):
            raise ContractError(f"{prefix} must be an object")
        scene_id = _text(scene.get("id"), f"{prefix}.id")
        if scene_id in ids:
            raise ContractError(f"duplicate scene id: {scene_id}")
        ids.add(scene_id)
        for field in ("purpose", "communicates"):
            _text(scene.get(field), f"{prefix}.{field}")
        evidence = scene.get("visible_evidence")
        if not isinstance(evidence, list) or not evidence or any(not isinstance(item, str) or not item.strip() for item in evidence):
            raise ContractError(f"{prefix}.visible_evidence must be a non-empty list of strings")
        presentation = scene.get("presentation")
        if not isinstance(presentation, dict):
            raise ContractError(f"{prefix}.presentation must be an object")
        _text(presentation.get("focus"), f"{prefix}.presentation.focus")
        if not isinstance(presentation.get("highlight"), list) or not isinstance(presentation.get("text"), list):
            raise ContractError(f"{prefix}.presentation.highlight and text must be lists")
        if presentation.get("zoom") not in {"none", "subtle", "emphasis"}:
            raise ContractError(f"{prefix}.presentation.zoom is invalid")
        seconds = presentation.get("duration_seconds")
        if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or seconds <= 0:
            raise ContractError(f"{prefix}.presentation.duration_seconds must be positive")
        total += seconds
    if total > plan["brief"]["duration_seconds"] * 1.25:
        raise ContractError("scene durations exceed brief duration by more than 25%")
    _reject_automation(plan)
    return plan


def _quote(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def render_markcut(brief: dict[str, Any], scenes: list[dict[str, Any]]) -> str:
    """Render semantic scenes as Markcut Markdown Descriptive."""
    validate_brief(brief)
    lines = ["# video", "width:1920 height:1080 fps:30 layout:series", ""]
    for scene in scenes:
        presentation = scene["presentation"]
        duration = presentation["duration_seconds"]
        lines.extend([f"## {scene['id']}", f"title:{_quote(scene['purpose'])} instruction:{_quote(scene['communicates'])}"])
        media_source = _quote(f"{scene['id']}.mp4")
        lines.append(f"- video src:{media_source} duration:{duration}")
        for caption in presentation["text"]:
            jsx = _quote(f"<div>{caption}</div>")
            lines.append(f"- component duration:{duration} jsx:{jsx}")
        if scene.get("narration"):
            lines.append(f"- script {_quote(scene['narration'])}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"usage: {argv[0]} PLAN.json", file=sys.stderr)
        return 2
    try:
        plan = json.loads(Path(argv[1]).read_text())
        validate_plan(plan)
    except (OSError, json.JSONDecodeError, ContractError) as exc:
        print(f"invalid video director plan: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"valid": True, "scene_count": len(plan["scenes"])}))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv))
