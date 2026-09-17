#!/usr/bin/env python3
"""Validate Clippers contracts and report a run's promotion state."""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


REQUIRED_QA_CHECKS = {
    "authorization_and_provenance",
    "timestamp_evidence",
    "ranking_eligibility",
    "editorial_coherence",
}
CONTRACT_ROOT = Path(__file__).resolve().parents[1]


def rubric_criteria() -> dict[str, float]:
    config = load_json(CONTRACT_ROOT / "config" / "rubric-v1.json")
    require(config.get("rubric_id") == "clippers-rubric-v1", "invalid rubric id")
    require(config.get("version") == 1, "invalid rubric version")
    criteria = config.get("criteria")
    require(isinstance(criteria, list) and bool(criteria), "rubric criteria must be non-empty")
    result = {}
    for criterion in criteria:
        require_object(criterion, "rubric criterion")
        require_text(criterion.get("id"), "rubric criterion id")
        weight = criterion.get("weight")
        require(isinstance(weight, (int, float)) and not isinstance(weight, bool), "rubric criterion weight must be numeric")
        result[criterion["id"]] = weight
    return result


class ValidationError(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValidationError(f"{path}: invalid JSON: {exc}") from exc
    require(isinstance(value, dict), f"{path}: expected a JSON object")
    return value


def require_object(value: Any, field: str) -> None:
    require(isinstance(value, dict), f"{field} must be an object")


def require_text(value: Any, field: str) -> None:
    require(isinstance(value, str) and bool(value.strip()), f"{field} must be non-empty text")


def require_int(value: Any, field: str, minimum: int | None = None) -> None:
    require(isinstance(value, int) and not isinstance(value, bool), f"{field} must be an integer")
    if minimum is not None:
        require(value >= minimum, f"{field} must be at least {minimum}")


def require_bool(value: Any, field: str) -> None:
    require(isinstance(value, bool), f"{field} must be boolean")


def parse_datetime(value: Any, field: str) -> datetime:
    require_text(value, field)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValidationError(f"{field} is not an ISO-8601 timestamp") from exc
    require(parsed.tzinfo is not None, f"{field} must include a timezone")
    return parsed


def validate_authorization(value: dict[str, Any]) -> None:
    require(value.get("schema_version") == 1, "authorization schema_version must be 1")
    require_text(value.get("authorization_id"), "authorization_id")
    require_text(value.get("source_id"), "source_id")
    require_object(value.get("authorizer"), "authorizer")
    require_text(value["authorizer"].get("name"), "authorizer.name")
    require_text(value["authorizer"].get("authority"), "authorizer.authority")
    parse_datetime(value.get("authorized_at"), "authorized_at")
    require_object(value.get("authorization_evidence"), "authorization_evidence")
    require_text(value["authorization_evidence"].get("method"), "authorization_evidence.method")
    require_text(value["authorization_evidence"].get("reference"), "authorization_evidence.reference")
    require_object(value.get("scope"), "scope")
    require_bool(value["scope"].get("source_research"), "scope.source_research")
    require_bool(value["scope"].get("transcription"), "scope.transcription")
    require_bool(value["scope"].get("clip_creation"), "scope.clip_creation")
    require(value["scope"]["clip_creation"] is True, "scope.clip_creation must be true")
    if value.get("expires_at") is not None:
        expiry = parse_datetime(value["expires_at"], "expires_at")
        require(expiry > parse_datetime(value["authorized_at"], "authorized_at"), "expires_at must be after authorized_at")


def validate_interval(start: Any, end: Any, field: str) -> None:
    require_int(start, f"{field}.start_ms", 0)
    require_int(end, f"{field}.end_ms", 1)
    require(end > start, f"{field} requires end_ms after start_ms")


def validate_candidate(value: dict[str, Any]) -> None:
    require(value.get("schema_version") == 1, "candidate schema_version must be 1")
    candidate_id = value.get("candidate_id")
    require_text(candidate_id, "candidate_id")
    require(isinstance(candidate_id, str) and candidate_id.startswith("candidate_"), "candidate_id must start with candidate_")
    require_text(value.get("source_id"), "source_id")
    validate_interval(value.get("start_ms"), value.get("end_ms"), "candidate")
    duration = value["end_ms"] - value["start_ms"]
    require(5000 <= duration <= 90000, f"candidate duration {duration}ms is outside 5-90 seconds")
    require(value.get("status") in {"candidate", "eligible", "excluded"}, "candidate status is invalid")
    require_text(value.get("title"), "title")
    require_text(value.get("why_now"), "why_now")
    evidence = value.get("evidence")
    require(isinstance(evidence, list) and bool(evidence), "candidate evidence must be a non-empty array")
    kinds = set()
    for index, item in enumerate(evidence, 1):
        field = f"evidence[{index}]"
        require_object(item, field)
        require(item.get("kind") in {"transcript", "media", "visual", "audio", "metadata"}, f"{field}.kind is invalid")
        kinds.add(item["kind"])
        require_text(item.get("artifact"), f"{field}.artifact")
        validate_interval(item.get("start_ms"), item.get("end_ms"), field)
        require(item["start_ms"] >= value["start_ms"] and item["end_ms"] <= value["end_ms"], f"{field} is outside the candidate interval")
        require_text(item.get("observation"), f"{field}.observation")
    require("transcript" in kinds, "candidate requires transcript evidence")
    require(kinds & {"media", "visual", "audio"}, "candidate requires media, visual, or audio evidence")


def validate_transcript(value: dict[str, Any]) -> None:
    require(value.get("schema_version") == 1, "transcript schema_version must be 1")
    require_text(value.get("source_id"), "source_id")
    segments = value.get("segments")
    require(isinstance(segments, list) and bool(segments), "transcript segments must be non-empty")
    previous_end = -1
    for index, segment in enumerate(segments, 1):
        field = f"segments[{index}]"
        require_object(segment, field)
        validate_interval(segment.get("start_ms"), segment.get("end_ms"), field)
        require_text(segment.get("text"), f"{field}.text")
        require(segment["start_ms"] >= previous_end, "transcript segments overlap")
        previous_end = segment["end_ms"]


def validate_research(value: dict[str, Any]) -> None:
    require(value.get("schema_version") == 1, "research schema_version must be 1")
    require_text(value.get("source_id"), "source_id")
    require_text(value.get("title"), "title")
    require_text(value.get("producer"), "producer")
    require_text(value.get("provenance"), "provenance")
    require_object(value.get("campaign"), "campaign")
    require_text(value["campaign"].get("objective"), "campaign.objective")
    require(isinstance(value["campaign"].get("targets"), list) and bool(value["campaign"]["targets"]), "campaign.targets must be non-empty")


def close_enough(left: float, right: float) -> bool:
    return math.isclose(left, right, rel_tol=0.0, abs_tol=0.001)


def validate_ranked(value: dict[str, Any], candidates: dict[str, Any] | None = None) -> None:
    require(value.get("schema_version") == 1, "selection schema_version must be 1")
    require_text(value.get("selection_id"), "selection_id")
    require_text(value.get("source_id"), "source_id")
    require(value.get("rubric_id") == "clippers-rubric-v1", "rubric_id must be clippers-rubric-v1")
    require(value.get("rubric_version") == 1, "rubric_version must be 1")
    rankings = value.get("rankings")
    require(isinstance(rankings, list) and bool(rankings), "rankings must be non-empty")
    seen = set()
    for index, entry in enumerate(rankings, 1):
        field = f"rankings[{index}]"
        require_object(entry, field)
        require(entry.get("rank") == index, f"{field}.rank must be contiguous and ordered")
        candidate_id = entry.get("candidate_id")
        require_text(candidate_id, f"{field}.candidate_id")
        require(candidate_id not in seen, f"duplicate ranked candidate {candidate_id}")
        seen.add(candidate_id)
        require_text(entry.get("candidate_artifact"), f"{field}.candidate_artifact")
        require(entry.get("status") == "eligible", f"{field} must have eligible status")
        scores = entry.get("scores")
        require_object(scores, f"{field}.scores")
        criteria = rubric_criteria()
        require(set(scores) == set(criteria), f"{field}.scores must contain exactly rubric-v1 criteria")
        expected = 0.0
        for criterion, weight in criteria.items():
            score = scores[criterion]
            require(isinstance(score, (int, float)) and not isinstance(score, bool), f"{field}.scores.{criterion} must be numeric")
            require(0 <= score <= 2, f"{field}.scores.{criterion} must be between 0 and 2")
            expected += score * weight
        weighted = entry.get("weighted_score")
        require(isinstance(weighted, (int, float)) and not isinstance(weighted, bool), f"{field}.weighted_score must be numeric")
        require(0 <= weighted <= 2, f"{field}.weighted_score must be between 0 and 2")
        require(close_enough(weighted, expected), f"{field}.weighted_score does not match rubric weights")
        if candidates is not None:
            candidate = candidates.get(candidate_id)
            require(candidate is not None, f"ranked candidate {candidate_id} is absent from candidates artifact")
            require(candidate["status"] == "eligible", f"candidate {candidate_id} is not eligible")


def load_candidate_index(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    value = load_json(path)
    require(value.get("schema_version") == 1, "candidate collection schema_version must be 1")
    require_text(value.get("source_id"), "candidate collection source_id")
    raw = value.get("candidates")
    require(isinstance(raw, list), "candidate collection candidates must be an array")
    index = {}
    for position, candidate in enumerate(raw, 1):
        require_object(candidate, f"candidates[{position}]")
        validate_candidate(candidate)
        candidate_id = candidate["candidate_id"]
        require(candidate_id not in index, f"duplicate candidate {candidate_id}")
        index[candidate_id] = candidate
    return value, index


def validate_qa(value: dict[str, Any], qa_state: str) -> None:
    require(value.get("schema_version") == 1, "QA schema_version must be 1")
    require_text(value.get("qa_id"), "qa_id")
    require_text(value.get("source_id"), "source_id")
    require_text(value.get("reviewer"), "reviewer")
    require(value.get("independent") is True, "QA reviewer must be independent")
    decision = value.get("decision")
    require(decision in {"pass", "fail"}, "QA decision must be pass or fail")
    checks = value.get("checks")
    require(isinstance(checks, list) and bool(checks), "QA checks must be non-empty")
    by_id = {}
    for index, check in enumerate(checks, 1):
        field = f"checks[{index}]"
        require_object(check, field)
        require_text(check.get("id"), f"{field}.id")
        require(check.get("id") not in by_id, f"duplicate QA check {check['id']}")
        by_id[check["id"]] = check
        require(check.get("result") in {"pass", "fail", "not_applicable"}, f"{field}.result is invalid")
        require_text(check.get("evidence"), f"{field}.evidence")
    if qa_state == "qa_passed" or decision == "pass":
        require(decision == "pass", "QA decision does not permit passed run state")
        for check_id in REQUIRED_QA_CHECKS:
            check = by_id.get(check_id)
            require(check is not None, f"QA is missing required check {check_id}")
            require(check["result"] == "pass", f"required QA check {check_id} did not pass")
    else:
        require(decision == "fail", "qa_failed state requires a fail decision")
        blockers = value.get("blockers")
        require(isinstance(blockers, list) and bool(blockers), "failed QA must list blockers")


def validate_run_state(value: dict[str, Any]) -> None:
    require(value.get("schema_version") == 1, "run schema_version must be 1")
    require_text(value.get("run_id"), "run_id")
    require_text(value.get("source_id"), "source_id")
    state = value.get("state")
    states = {"initiated", "source_authorized", "source_researched", "evidence_extracted", "candidates_extracted", "ranked", "qa_passed", "qa_failed", "markcut_ready", "blocked", "failed"}
    require(state in states, "run state is invalid")
    artifacts = value.get("artifacts")
    require_object(artifacts, "artifacts")
    require_text(artifacts.get("authorization"), "artifacts.authorization")


VALIDATORS = {
    "authorization": validate_authorization,
    "research": validate_research,
    "transcript": validate_transcript,
    "candidate": validate_candidate,
    "qa": lambda value: validate_qa(value, value.get("decision", "")),
    "run-state": validate_run_state,
}


def validate_artifact(kind: str, path: Path) -> None:
    value = load_json(path)
    if kind == "ranked":
        validate_ranked(value)
    elif kind == "candidates":
        load_candidate_index(path)
    else:
        validator = VALIDATORS.get(kind)
        require(validator is not None, f"unknown artifact kind {kind}")
        validator(value)


def artifact_path(run: Path, key: str, artifacts: dict[str, Any]) -> Path:
    require_text(artifacts.get(key), f"artifacts.{key}")
    path = run / artifacts[key]
    require(path.is_file(), f"artifacts.{key} does not point to a file: {path}")
    return path


def required_artifacts(state: str) -> tuple[str, ...]:
    stages = {
        "initiated": (),
        "source_authorized": ("authorization",),
        "source_researched": ("authorization", "research"),
        "evidence_extracted": ("authorization", "research", "transcript"),
        "candidates_extracted": ("authorization", "research", "transcript", "candidates"),
        "ranked": ("authorization", "research", "transcript", "candidates", "selection"),
        "qa_passed": ("authorization", "research", "transcript", "candidates", "selection", "qa"),
        "qa_failed": ("authorization", "research", "transcript", "candidates", "selection", "qa"),
        "markcut_ready": ("authorization", "research", "transcript", "candidates", "selection", "qa", "markcut_spec"),
        "blocked": (),
        "failed": (),
    }
    return stages[state]


def validate_run(run: Path) -> dict[str, Any]:
    state_path = run / "state" / "run-state.json"
    state = load_json(state_path)
    validate_run_state(state)
    run_state = state["state"]
    artifacts = state["artifacts"]
    resolved = {key: artifact_path(run, key, artifacts) for key in required_artifacts(run_state)}
    authorization = load_json(resolved["authorization"])
    validate_authorization(authorization)
    require(authorization["source_id"] == state["source_id"], "authorization source_id does not match run state")
    if run_state in {"initiated", "blocked", "failed"}:
        return state

    research = load_json(resolved["research"])
    validate_research(research)
    require(research["source_id"] == state["source_id"], "research source_id does not match run state")
    require(authorization["scope"]["source_research"] is True, "source research is outside authorization scope")
    if run_state == "source_researched":
        return state

    transcript = load_json(resolved["transcript"])
    validate_transcript(transcript)
    require(transcript["source_id"] == state["source_id"], "transcript source_id does not match run state")
    require(authorization["scope"]["transcription"] is True, "transcription is outside authorization scope")
    if run_state == "evidence_extracted":
        return state

    _, candidates = load_candidate_index(resolved["candidates"])
    require(all(candidate["source_id"] == state["source_id"] for candidate in candidates.values()), "candidate source_id does not match run state")
    if run_state == "candidates_extracted":
        return state

    selection = load_json(resolved["selection"])
    validate_ranked(selection, candidates)
    require(selection["source_id"] == state["source_id"], "selection source_id does not match run state")
    if run_state == "ranked":
        return state

    qa = load_json(resolved["qa"])
    validate_qa(qa, run_state)
    require(qa["source_id"] == state["source_id"], "QA source_id does not match run state")
    if run_state == "qa_failed":
        require(markcut_spec_absent(run, artifacts), "qa_failed run cannot expose a Markcut spec")
        return state
    if run_state == "qa_passed":
        require(markcut_spec_absent(run, artifacts), "qa_passed run is not yet Markcut-ready")
        return state

    require(Path(run / artifacts["markcut_spec"]).is_file(), "Markcut spec must exist for markcut_ready")
    return state


def markcut_spec_absent(run: Path, artifacts: dict[str, Any]) -> bool:
    value = artifacts.get("markcut_spec")
    return value is None or not (run / value).is_file()


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate = subparsers.add_parser("validate")
    validate.add_argument("kind", choices=sorted(set(VALIDATORS) | {"candidates", "ranked"}))
    validate.add_argument("file", type=Path)
    status = subparsers.add_parser("status")
    status.add_argument("run", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "validate":
            validate_artifact(args.kind, args.file)
            print(f"OK {args.kind}: {args.file}")
        else:
            state = validate_run(args.run.resolve())
            print(f"OK {state['state']}: {state['run_id']}")
    except ValidationError as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
