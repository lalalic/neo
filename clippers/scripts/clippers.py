#!/usr/bin/env python3
"""Validate Clippers stage contracts and run promotion state."""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


CONTRACT_ROOT = Path(__file__).resolve().parents[1]
REQUIRED_QA_CHECKS = {
    "authorization_and_provenance",
    "timestamp_evidence",
    "ranking_eligibility",
    "editorial_coherence",
    "identity_binding",
}
LEGAL_TRANSITIONS = {
    "initiated": {"source_authorized"},
    "source_authorized": {"media_preflight"},
    "media_preflight": {"transcript_extracted"},
    "transcript_extracted": {"text_candidates_extracted"},
    "text_candidates_extracted": {"vision_reviewed"},
    "vision_reviewed": {"judge_ranked"},
    "judge_ranked": {"variants_planned"},
    "variants_planned": {"qa_failed", "qa_passed"},
    "qa_failed": {"judge_ranked"},
    "qa_passed": {"markcut_ready"},
    "markcut_ready": {"publication_authorized"},
    "publication_authorized": {"published"},
    "published": {"metrics_24h"},
    "metrics_24h": {"metrics_72h"},
    "metrics_72h": {"metrics_7d"},
    "metrics_7d": {"learning_recorded"},
    "learning_recorded": set(),
}
CORE_ARTIFACTS = (
    "authorization", "research", "media", "transcript", "text_candidates",
    "vision_reviews", "campaign_brief", "judge", "selection",
)
REQUIRED_ARTIFACTS = {
    "initiated": ("authorization",),
    "source_authorized": ("authorization",),
    "media_preflight": ("authorization", "research", "media"),
    "transcript_extracted": ("authorization", "research", "media", "transcript"),
    "text_candidates_extracted": ("authorization", "research", "media", "transcript", "text_candidates"),
    "vision_reviewed": ("authorization", "research", "media", "transcript", "text_candidates", "vision_reviews"),
    "judge_ranked": (*CORE_ARTIFACTS,),
    "variants_planned": (*CORE_ARTIFACTS, "variants"),
    "qa_failed": (*CORE_ARTIFACTS, "variants", "qa"),
    "qa_passed": (*CORE_ARTIFACTS, "variants", "qa"),
    "markcut_ready": (*CORE_ARTIFACTS, "variants", "qa", "markcut"),
    "publication_authorized": (*CORE_ARTIFACTS, "variants", "qa", "markcut", "publication_authorization"),
    "published": (*CORE_ARTIFACTS, "variants", "qa", "markcut", "publication_authorization", "publication_record"),
    "metrics_24h": (*CORE_ARTIFACTS, "variants", "qa", "markcut", "publication_authorization", "publication_record", "metrics_24h"),
    "metrics_72h": (*CORE_ARTIFACTS, "variants", "qa", "markcut", "publication_authorization", "publication_record", "metrics_24h", "metrics_72h"),
    "metrics_7d": (*CORE_ARTIFACTS, "variants", "qa", "markcut", "publication_authorization", "publication_record", "metrics_24h", "metrics_72h", "metrics_7d"),
    "learning_recorded": (*CORE_ARTIFACTS, "variants", "qa", "markcut", "publication_authorization", "publication_record", "metrics_24h", "metrics_72h", "metrics_7d", "learning"),
}


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


def rubric_criteria() -> dict[str, float]:
    config = load_json(CONTRACT_ROOT / "config" / "rubric-v1.json")
    require(config.get("rubric_id") == "clippers-rubric-v1", "invalid rubric id")
    require(config.get("version") == 2, "rubric version must be 2")
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


def require_object(value: Any, field: str) -> None:
    require(isinstance(value, dict), f"{field} must be an object")


def require_text(value: Any, field: str) -> None:
    require(isinstance(value, str) and bool(value.strip()), f"{field} must be non-empty text")


def require_int(value: Any, field: str, minimum: int | None = None, maximum: int | None = None) -> None:
    require(isinstance(value, int) and not isinstance(value, bool), f"{field} must be an integer")
    if minimum is not None:
        require(value >= minimum, f"{field} must be at least {minimum}")
    if maximum is not None:
        require(value <= maximum, f"{field} must be at most {maximum}")


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


def validate_authorization(value: dict[str, Any], now: datetime | None = None) -> None:
    require(value.get("schema_version") == 1, "authorization schema_version must be 1")
    require_text(value.get("authorization_id"), "authorization_id")
    require_text(value.get("source_id"), "source_id")
    require_object(value.get("authorizer"), "authorizer")
    require_text(value["authorizer"].get("name"), "authorizer.name")
    require_text(value["authorizer"].get("authority"), "authorizer.authority")
    authorized_at = parse_datetime(value.get("authorized_at"), "authorized_at")
    current = now or datetime.now(timezone.utc)
    require(authorized_at <= current + timedelta(minutes=5), "authorized_at cannot be in the future")
    if value.get("expires_at") is not None:
        expiry = parse_datetime(value["expires_at"], "expires_at")
        require(expiry > authorized_at, "expires_at must be after authorized_at")
        require(expiry > current, "authorization is expired")
    require_object(value.get("authorization_evidence"), "authorization_evidence")
    require_text(value["authorization_evidence"].get("method"), "authorization_evidence.method")
    require_text(value["authorization_evidence"].get("reference"), "authorization_evidence.reference")
    require_object(value.get("scope"), "scope")
    require_bool(value["scope"].get("source_research"), "scope.source_research")
    require_bool(value["scope"].get("transcription"), "scope.transcription")
    require_bool(value["scope"].get("clip_creation"), "scope.clip_creation")
    require(value["scope"]["clip_creation"] is True, "scope.clip_creation must be true")
    platforms = value["scope"].get("allowed_platforms")
    require(isinstance(platforms, list) and bool(platforms), "scope.allowed_platforms must be non-empty")


def validate_research(value: dict[str, Any]) -> None:
    require(value.get("schema_version") == 1, "research schema_version must be 1")
    require_text(value.get("source_id"), "source_id")
    require_text(value.get("title"), "title")
    require_text(value.get("producer"), "producer")
    require_text(value.get("provenance"), "provenance")
    require_object(value.get("campaign"), "campaign")
    require_text(value["campaign"].get("objective"), "campaign.objective")
    require(isinstance(value["campaign"].get("targets"), list) and bool(value["campaign"]["targets"]), "campaign.targets must be non-empty")


def validate_media(value: dict[str, Any]) -> None:
    require(value.get("schema_version") == 1, "media schema_version must be 1")
    require_text(value.get("source_id"), "source_id")
    require_text(value.get("normalized_media"), "normalized_media")
    require_int(value.get("duration_ms"), "duration_ms", 1)
    require_object(value.get("video"), "video")
    require_int(value["video"].get("width"), "video.width", 1)
    require_int(value["video"].get("height"), "video.height", 1)
    fps = value["video"].get("fps")
    require(isinstance(fps, (int, float)) and not isinstance(fps, bool) and fps > 0, "video.fps must be positive")
    require_object(value.get("audio"), "audio")
    require_text(value["audio"].get("codec"), "audio.codec")
    require_int(value["audio"].get("channels"), "audio.channels", 1)
    require_int(value["audio"].get("sample_rate_hz"), "audio.sample_rate_hz", 1)
    require_object(value.get("frame_index"), "frame_index")
    require_text(value["frame_index"].get("keyframes_artifact"), "frame_index.keyframes_artifact")
    require_text(value["frame_index"].get("thumbnails_artifact"), "frame_index.thumbnails_artifact")
    require_int(value["frame_index"].get("cadence_ms"), "frame_index.cadence_ms", 1)
    require_object(value.get("normalization"), "normalization")
    require_text(value["normalization"].get("command"), "normalization.command")
    require_bool(value["normalization"].get("streaming_faststart"), "normalization.streaming_faststart")


def validate_interval(start: Any, end: Any, field: str) -> None:
    require_int(start, f"{field}.start_ms", 0)
    require_int(end, f"{field}.end_ms", 1)
    require(end > start, f"{field} requires end_ms after start_ms")


def normalized_text(value: str) -> str:
    return " ".join(value.casefold().split())


def transcript_contains_quote(transcript: dict[str, Any], quote: str, start: int, end: int) -> bool:
    wanted = normalized_text(quote)
    return any(
        segment["end_ms"] >= start
        and segment["start_ms"] <= end
        and wanted in normalized_text(segment["text"])
        for segment in transcript["segments"]
    )


def validate_transcript(value: dict[str, Any]) -> None:
    require(value.get("schema_version") == 1, "transcript schema_version must be 1")
    require_text(value.get("source_id"), "source_id")
    require(value.get("format") in {"structured_json", "vtt"}, "transcript format is invalid")
    require_text(value.get("artifact"), "transcript artifact")
    segments = value.get("segments")
    require(isinstance(segments, list) and bool(segments), "transcript segments must be non-empty")
    previous_end = -1
    for index, segment in enumerate(segments, 1):
        field = f"segments[{index}]"
        require_object(segment, field)
        validate_interval(segment.get("start_ms"), segment.get("end_ms"), field)
        require_text(segment.get("text"), f"{field}.text")
        require(segment["start_ms"] >= previous_end, "transcript segments overlap")
        if segment.get("speaker") is not None:
            require_text(segment["speaker"], f"{field}.speaker")
        previous_end = segment["end_ms"]


def validate_text_candidates(value: dict[str, Any]) -> dict[str, dict[str, Any]]:
    require(value.get("schema_version") == 1, "text candidates schema_version must be 1")
    require_text(value.get("source_id"), "source_id")
    require(value.get("stage") == "text_first", "text candidate stage must be text_first")
    candidates = value.get("candidates")
    require(isinstance(candidates, list), "text candidates must be an array")
    require(5 <= len(candidates) <= 25, "text candidates must contain 5-25 cheap slices")
    index = {}
    for position, candidate in enumerate(candidates, 1):
        field = f"candidates[{position}]"
        require_object(candidate, field)
        require(candidate.get("schema_version") == 1, f"{field}.schema_version must be 1")
        candidate_id = candidate.get("candidate_id")
        require_text(candidate_id, f"{field}.candidate_id")
        require(candidate_id.startswith("candidate_"), f"{field}.candidate_id must start with candidate_")
        require(candidate_id not in index, f"duplicate candidate {candidate_id}")
        require_text(candidate.get("source_id"), f"{field}.source_id")
        validate_interval(candidate.get("start_ms"), candidate.get("end_ms"), field)
        duration = candidate["end_ms"] - candidate["start_ms"]
        require(5000 <= duration <= 90000, f"{field} duration is outside 5-90 seconds")
        require(candidate.get("status") == "candidate", f"{field}.status must be candidate")
        require_text(candidate.get("title"), f"{field}.title")
        require_text(candidate.get("transcript_quote"), f"{field}.transcript_quote")
        require_text(candidate.get("preliminary_reason"), f"{field}.preliminary_reason")
        evidence = candidate.get("evidence")
        require(isinstance(evidence, list) and bool(evidence), f"{field}.evidence must be non-empty")
        for evidence_index, item in enumerate(evidence, 1):
            evidence_field = f"{field}.evidence[{evidence_index}]"
            require_object(item, evidence_field)
            require(item.get("kind") == "transcript", "text candidate evidence is transcript-only")
            require_text(item.get("artifact"), f"{evidence_field}.artifact")
            validate_interval(item.get("start_ms"), item.get("end_ms"), evidence_field)
            require_text(item.get("observation"), f"{evidence_field}.observation")
        index[candidate_id] = candidate
    return index


def validate_vision(value: dict[str, Any], candidate: dict[str, Any] | None = None) -> None:
    require(value.get("schema_version") == 1, "vision schema_version must be 1")
    require_text(value.get("vision_id"), "vision_id")
    require_text(value.get("source_id"), "source_id")
    require_text(value.get("candidate_id"), "candidate_id")
    validate_interval(value.get("start_ms"), value.get("end_ms"), "vision")
    for field in ("topic", "summary"):
        require_text(value.get(field), field)
    require(isinstance(value.get("speakers"), list), "vision speakers must be an array")
    require_object(value.get("key_quote"), "vision key_quote")
    validate_interval(value["key_quote"].get("start_ms"), value["key_quote"].get("end_ms"), "key_quote")
    require_text(value["key_quote"].get("text"), "key_quote.text")
    require_text(value["key_quote"].get("artifact"), "key_quote.artifact")
    require(value["key_quote"]["start_ms"] >= value["start_ms"] and value["key_quote"]["end_ms"] <= value["end_ms"], "key_quote is outside candidate bounds")
    subjects = value.get("subjects")
    require(isinstance(subjects, list) and bool(subjects), "vision subjects must be non-empty")
    for index, subject in enumerate(subjects, 1):
        require_object(subject, f"subjects[{index}]")
        require_text(subject.get("label"), f"subjects[{index}].label")
        require_object(subject.get("position"), f"subjects[{index}].position")
        require(subject.get("face_visibility") in {"visible", "partial", "off_frame"}, "face_visibility is invalid")
        require(subject.get("clarity") in {"clear", "usable", "unclear"}, "subject clarity is invalid")
    signals = value.get("signals")
    require_object(signals, "signals")
    require(signals.get("visual_quality") in {"strong", "usable", "weak"}, "visual quality is invalid")
    require(signals.get("audio_quality") in {"strong", "usable", "weak"}, "audio quality is invalid")
    for field in ("emotions", "actions", "events", "on_screen_text", "shot_changes"):
        require(isinstance(signals.get(field), list), f"signals.{field} must be an array")
    narrative = value.get("narrative")
    require_object(narrative, "narrative")
    require(narrative.get("self_contained") in {"yes", "partial", "no"}, "self_contained is invalid")
    require_object(value.get("hook"), "hook")
    validate_interval(value["hook"].get("start_ms"), value["hook"].get("end_ms"), "hook")
    require(value["hook"]["end_ms"] - value["hook"]["start_ms"] <= 3000, "hook must cover at most 3 seconds")
    require_text(value["hook"].get("evidence"), "hook.evidence")
    require(isinstance(value.get("moments"), list), "moments must be an array")
    require(isinstance(value.get("weak_regions"), list), "weak_regions must be an array")
    require_object(value.get("cut_suggestion"), "cut_suggestion")
    validate_interval(value["cut_suggestion"].get("start_ms"), value["cut_suggestion"].get("end_ms"), "cut_suggestion")
    vertical = value.get("vertical_suitability")
    require_object(vertical, "vertical_suitability")
    require(vertical.get("score") in {"strong", "usable", "weak"}, "vertical suitability score is invalid")
    require_bool(vertical.get("crop_tracking_feasible"), "crop_tracking_feasible")
    require_text(vertical.get("subject_safety"), "subject_safety")
    require_text(vertical.get("notes"), "vertical_suitability.notes")
    require_object(value.get("production_suggestions"), "production_suggestions")
    evidence = value.get("evidence")
    require(isinstance(evidence, list) and bool(evidence), "vision evidence must be non-empty")
    for index, item in enumerate(evidence, 1):
        field = f"evidence[{index}]"
        require_object(item, field)
        require_text(item.get("claim"), f"{field}.claim")
        require_text(item.get("artifact"), f"{field}.artifact")
        validate_interval(item.get("start_ms"), item.get("end_ms"), field)
        require(item["start_ms"] >= value["start_ms"] and item["end_ms"] <= value["end_ms"], f"{field} is outside candidate bounds")
    if candidate:
        require(value["candidate_id"] == candidate["candidate_id"], "vision candidate_id mismatch")
        require(value["source_id"] == candidate["source_id"], "vision source_id mismatch")
        require(value["start_ms"] == candidate["start_ms"] and value["end_ms"] == candidate["end_ms"], "vision interval mismatch")


def validate_judge(value: dict[str, Any]) -> dict[str, dict[str, Any]]:
    require(value.get("schema_version") == 1, "judge schema_version must be 1")
    require_text(value.get("source_id"), "source_id")
    require_text(value.get("selection_id"), "selection_id")
    require_text(value.get("platform"), "platform")
    require(value.get("rubric_id") == "clippers-rubric-v1", "judge rubric_id mismatch")
    require(value.get("rubric_version") == 2, "judge rubric_version mismatch")
    require_text(value.get("campaign_brief_artifact"), "campaign_brief_artifact")
    require_text(value.get("transcript_artifact"), "transcript_artifact")
    entries = value.get("entries")
    require(isinstance(entries, list) and bool(entries), "judge entries must be non-empty")
    index = {}
    for position, entry in enumerate(entries, 1):
        field = f"entries[{position}]"
        require_object(entry, field)
        entry_id = entry.get("entry_id")
        require_text(entry_id, f"{field}.entry_id")
        require(entry_id not in index, f"duplicate judge entry {entry_id}")
        require_text(entry.get("candidate_id"), f"{field}.candidate_id")
        require_text(entry.get("vision_artifact"), f"{field}.vision_artifact")
        scores = entry.get("scores")
        criteria = rubric_criteria()
        require_object(scores, f"{field}.scores")
        require(set(scores) == set(criteria), f"{field}.scores must match rubric-v2 criteria")
        for criterion in criteria:
            score = scores[criterion]
            require(isinstance(score, (int, float)) and not isinstance(score, bool), f"{field}.scores.{criterion} must be numeric")
            require(0 <= score <= 2, f"{field}.scores.{criterion} must be between 0 and 2")
        require_text(entry.get("risk_notes"), f"{field}.risk_notes")
        require_text(entry.get("rationale"), f"{field}.rationale")
        require_text(entry.get("edit_recommendation"), f"{field}.edit_recommendation")
        index[entry_id] = entry
    return index


def weighted_score(scores: dict[str, Any]) -> float:
    return round(sum(score * weight for score, weight in zip(scores.values(), rubric_criteria().values())), 3)


def close_enough(left: float, right: float) -> bool:
    return math.isclose(left, right, rel_tol=0.0, abs_tol=0.001)


def validate_selection(value: dict[str, Any], judge: dict[str, Any] | None = None) -> None:
    require(value.get("schema_version") == 2, "selection schema_version must be 2")
    require_text(value.get("selection_id"), "selection_id")
    require_text(value.get("source_id"), "source_id")
    require_text(value.get("platform"), "platform")
    require(value.get("rubric_id") == "clippers-rubric-v1", "selection rubric_id mismatch")
    require(value.get("rubric_version") == 2, "selection rubric_version mismatch")
    require_text(value.get("judge_artifact"), "selection judge_artifact")
    rankings = value.get("rankings")
    require(isinstance(rankings, list) and bool(rankings), "rankings must be non-empty")
    require(len(rankings) <= 10, "ranked shortlist must contain at most 10 candidates")
    seen = set()
    ordered = []
    for position, entry in enumerate(rankings, 1):
        field = f"rankings[{position}]"
        require_object(entry, field)
        require(entry.get("rank") == position, f"{field}.rank must be contiguous")
        candidate_id = entry.get("candidate_id")
        require_text(candidate_id, f"{field}.candidate_id")
        require(candidate_id not in seen, f"duplicate ranked candidate {candidate_id}")
        seen.add(candidate_id)
        require_text(entry.get("judge_entry_id"), f"{field}.judge_entry_id")
        require_text(entry.get("vision_artifact"), f"{field}.vision_artifact")
        require(entry.get("status") == "eligible", f"{field}.status must be eligible")
        weighted = entry.get("weighted_score")
        require(isinstance(weighted, (int, float)) and not isinstance(weighted, bool), f"{field}.weighted_score must be numeric")
        require(0 <= weighted <= 2, f"{field}.weighted_score must be between 0 and 2")
        ordered.append((candidate_id, weighted))
        if judge:
            judge_entry = judge.get(entry["judge_entry_id"])
            require(judge_entry is not None, f"{field}.judge_entry_id is absent from Judge artifact")
            require(judge_entry["candidate_id"] == candidate_id, f"{field} Judge candidate identity mismatch")
            require(close_enough(weighted, weighted_score(judge_entry["scores"])), f"{field}.weighted_score does not match rubric weights")
    expected = sorted(ordered, key=lambda item: (-item[1], item[0]))
    require(ordered == expected, "rankings must descend by score with candidate_id tie-break")


def validate_variants(value: dict[str, Any], auth: dict[str, Any], selected_candidates: set[str] | None = None) -> dict[str, dict[str, Any]]:
    require(value.get("schema_version") == 1, "variant schema_version must be 1")
    require_text(value.get("plan_id"), "plan_id")
    require_text(value.get("source_id"), "source_id")
    require_text(value.get("selection_id"), "selection_id")
    variants = value.get("variants")
    require(isinstance(variants, list) and bool(variants), "variants must be non-empty")
    require(len(variants) == 3, "the first learning experiment requires exactly 3 variants")
    index = {}
    families = set()
    allowed = set(auth["scope"]["allowed_platforms"])
    for position, variant in enumerate(variants, 1):
        field = f"variants[{position}]"
        require_object(variant, field)
        variant_id = variant.get("variant_id")
        require_text(variant_id, f"{field}.variant_id")
        require(variant_id not in index, f"duplicate variant {variant_id}")
        candidate_id = variant.get("candidate_id")
        require_text(candidate_id, f"{field}.candidate_id")
        if selected_candidates:
            require(candidate_id in selected_candidates, f"{field}.candidate_id was not selected")
        family = variant.get("strategy_family")
        require_text(family, f"{field}.strategy_family")
        require(family not in families, f"duplicate strategy family {family}")
        families.add(family)
        for key in ("hook_strategy", "edit_strategy"):
            require_text(variant.get(key), f"{field}.{key}")
            require(len(variant[key]) >= 12, f"{field}.{key} is too shallow")
        require_text(variant.get("material_difference"), f"{field}.material_difference")
        require(len(variant["material_difference"]) >= 20, f"{field}.material_difference must not be cosmetic-only")
        require_text(variant.get("target_platform"), f"{field}.target_platform")
        require(variant["target_platform"] in allowed, f"{field}.target_platform is outside authorization")
        index[variant_id] = variant
    return index


def validate_qa(value: dict[str, Any], state: str, variants: dict[str, Any]) -> list[dict[str, Any]]:
    require(value.get("schema_version") == 1, "QA schema_version must be 1")
    require_text(value.get("source_id"), "source_id")
    require_text(value.get("selection_id"), "selection_id")
    require_text(value.get("reviewer"), "reviewer")
    require(value.get("independent") is True, "QA reviewer must be independent")
    require(value.get("decision") in {"pass", "fail"}, "QA decision is invalid")
    decisions = value.get("decisions")
    require(isinstance(decisions, list) and bool(decisions), "QA decisions must be non-empty")
    variant_ids = set()
    qa_ids = set()
    for position, decision in enumerate(decisions, 1):
        field = f"decisions[{position}]"
        require_object(decision, field)
        qa_id = decision.get("qa_id")
        require_text(qa_id, f"{field}.qa_id")
        require(qa_id not in qa_ids, f"duplicate QA id {qa_id}")
        qa_ids.add(qa_id)
        variant_id = decision.get("variant_id")
        require_text(variant_id, f"{field}.variant_id")
        require(variant_id in variants, f"{field}.variant_id is absent from variant plan")
        require(variant_id not in variant_ids, f"duplicate QA variant {variant_id}")
        variant_ids.add(variant_id)
        require(decision.get("candidate_id") == variants[variant_id]["candidate_id"], f"{field}.candidate_id mismatch")
        require(decision.get("decision") in {"pass", "fail"}, f"{field}.decision is invalid")
        checks = decision.get("checks")
        require(isinstance(checks, list), f"{field}.checks must be an array")
        check_ids = set()
        for check_index, check in enumerate(checks, 1):
            check_field = f"{field}.checks[{check_index}]"
            require_object(check, check_field)
            check_id = check.get("id")
            require_text(check_id, f"{check_field}.id")
            require(check_id not in check_ids, f"duplicate QA check {check_id}")
            check_ids.add(check_id)
            require(check.get("result") in {"pass", "fail", "not_applicable"}, f"{check_field}.result is invalid")
            require_text(check.get("evidence"), f"{check_field}.evidence")
        for required in REQUIRED_QA_CHECKS:
            require(required in check_ids, f"QA is missing required check {required}")
        if decision["decision"] == "fail":
            require(bool(decision.get("blockers")), f"{field} failure must list blockers")
    if state == "qa_passed":
        require(value["decision"] == "pass", "overall QA must pass for qa_passed")
        require(all(item["decision"] == "pass" for item in decisions), "all variant QA decisions must pass")
    if state == "qa_failed":
        require(value["decision"] == "fail", "overall QA must fail for qa_failed")
        require(any(item["decision"] == "fail" for item in decisions), "at least one variant QA decision must fail")
    return decisions


def validate_markcut(value: dict[str, Any], auth: dict[str, Any], selection: dict[str, Any], variants: dict[str, Any], qa: list[dict[str, Any]]) -> None:
    require(value.get("schema_version") == 1, "Markcut schema_version must be 1")
    require(value.get("source_id") == selection["source_id"], "Markcut source identity mismatch")
    require(value.get("selection_id") == selection["selection_id"], "Markcut selection identity mismatch")
    require_text(value.get("input_media"), "input_media")
    handoffs = value.get("handoffs")
    require(isinstance(handoffs, list) and bool(handoffs), "Markcut handoffs must be non-empty")
    expected_variants = set(variants)
    qa_by_variant = {item["variant_id"]: item for item in qa if item["decision"] == "pass"}
    seen = set()
    allowed = set(auth["scope"]["allowed_platforms"])
    selected = {item["candidate_id"] for item in selection["rankings"]}
    for position, handoff in enumerate(handoffs, 1):
        field = f"handoffs[{position}]"
        require_object(handoff, field)
        variant_id = handoff.get("variant_id")
        require_text(variant_id, f"{field}.variant_id")
        require(variant_id in expected_variants, f"{field}.variant_id is absent from variant plan")
        require(variant_id not in seen, f"duplicate Markcut variant {variant_id}")
        seen.add(variant_id)
        require(handoff.get("candidate_id") == variants[variant_id]["candidate_id"], f"{field}.candidate_id mismatch")
        require(handoff.get("candidate_id") in selected, f"{field}.candidate_id was not selected")
        qa_item = qa_by_variant.get(variant_id)
        require(qa_item is not None, f"{field} has no passing QA decision")
        require(handoff.get("qa_id") == qa_item["qa_id"], f"{field}.qa_id identity mismatch")
        require(handoff.get("target_platform") in allowed, f"{field}.target_platform is outside authorization")
        require_object(handoff.get("source_interval"), f"{field}.source_interval")
        validate_interval(handoff["source_interval"].get("start_ms"), handoff["source_interval"].get("end_ms"), f"{field}.source_interval")
        require_text(handoff.get("hook_strategy"), f"{field}.hook_strategy")
        directives = handoff.get("edit_directives")
        require(isinstance(directives, list) and bool(directives), f"{field}.edit_directives must be non-empty")
        require_text(handoff.get("deliverable"), f"{field}.deliverable")
        evidence = handoff.get("evidence_artifacts")
        require(isinstance(evidence, list) and bool(evidence), f"{field}.evidence_artifacts must be non-empty")
    require(seen == expected_variants, "Markcut handoffs must exactly cover the variant plan")


def validate_publication_authorization(value: dict[str, Any], auth: dict[str, Any]) -> None:
    require(value.get("schema_version") == 1, "publication authorization schema_version must be 1")
    require_text(value.get("source_id"), "source_id")
    require_text(value.get("selection_id"), "selection_id")
    require_text(value.get("variant_id"), "variant_id")
    require_text(value.get("candidate_id"), "candidate_id")
    require(value.get("human_decision") == "explicit_publish", "publication requires explicit human decision")
    require_text(value.get("authorizer"), "authorizer")
    parse_datetime(value.get("authorized_at"), "authorized_at")
    require_text(value.get("artifact_id"), "artifact_id")
    require(value.get("platform") in auth["scope"]["allowed_platforms"], "publication platform is outside authorization")


def validate_publication_record(value: dict[str, Any], auth: dict[str, Any]) -> None:
    require(value.get("schema_version") == 1, "publication record schema_version must be 1")
    require_text(value.get("publication_id"), "publication_id")
    require_text(value.get("source_id"), "source_id")
    require_text(value.get("selection_id"), "selection_id")
    require_text(value.get("variant_id"), "variant_id")
    parse_datetime(value.get("published_at"), "published_at")
    require_text(value.get("destination_url"), "destination_url")
    require(value.get("platform") in auth["scope"]["allowed_platforms"], "publication platform is outside authorization")


def validate_metrics(value: dict[str, Any], window: str) -> None:
    require(value.get("schema_version") == 1, "metrics schema_version must be 1")
    require_text(value.get("observation_id"), "observation_id")
    for field in ("source_id", "selection_id", "variant_id", "publication_artifact", "interpretation"):
        require_text(value.get(field), field)
    require(value.get("window") == window, "metrics window mismatch")
    parse_datetime(value.get("captured_at"), "captured_at")
    metrics = value.get("metrics")
    require_object(metrics, "metrics")
    for field in ("views", "watch_time_seconds", "retention_rate", "completion_rate"):
        require(field in metrics, f"metrics is missing {field}")


def validate_learning(value: dict[str, Any]) -> None:
    require(value.get("schema_version") == 1, "learning schema_version must be 1")
    require_text(value.get("learning_id"), "learning_id")
    require_text(value.get("source_id"), "source_id")
    require_text(value.get("selection_id"), "selection_id")
    require(isinstance(value.get("metrics_artifacts"), list) and len(value["metrics_artifacts"]) >= 3, "learning requires three metric observations")
    for field in ("observations", "hypothesis_updates"):
        require(isinstance(value.get(field), list) and bool(value[field]), f"{field} must be non-empty")
    require_text(value.get("next_experiment"), "next_experiment")


VALIDATORS = {
    "authorization": validate_authorization,
    "research": validate_research,
    "media": validate_media,
    "transcript": validate_transcript,
    "text-candidates": validate_text_candidates,
    "vision": validate_vision,
    "judge": validate_judge,
    "selection": validate_selection,
    "learning": validate_learning,
}


def validate_artifact(kind: str, path: Path) -> None:
    validator = VALIDATORS.get(kind)
    require(validator is not None, f"unknown artifact kind {kind}")
    validator(load_json(path))


def artifact_path(run: Path, value: Any, field: str, must_exist: bool = True) -> Path:
    require_text(value, field)
    path = (run / value).resolve()
    try:
        path.relative_to(run.resolve())
    except ValueError as exc:
        raise ValidationError(f"{field} escapes the run directory: {value}") from exc
    if must_exist:
        require(path.is_file(), f"{field} does not resolve to a file: {value}")
    return path


def validate_history(state: dict[str, Any]) -> None:
    history = state.get("history")
    require(isinstance(history, list) and bool(history), "history must be non-empty")
    require(history[0].get("state") == "initiated", "history must begin at initiated")
    require(history[-1].get("state") == state.get("state"), "history must end at current state")
    previous = None
    for index, item in enumerate(history, 1):
        require_object(item, f"history[{index}]")
        require_text(item.get("state"), f"history[{index}].state")
        parse_datetime(item.get("at"), f"history[{index}].at")
        require_text(item.get("actor"), f"history[{index}].actor")
        if previous is not None:
            require(item["state"] in LEGAL_TRANSITIONS.get(previous, set()), f"illegal state transition {previous} -> {item['state']}")
        previous = item["state"]


def validate_run(run: Path, now: datetime | None = None) -> dict[str, Any]:
    state = load_json(run / "state" / "run-state.json")
    require(state.get("schema_version") == 2, "run schema_version must be 2")
    require_text(state.get("run_id"), "run_id")
    require_text(state.get("source_id"), "source_id")
    state_name = state.get("state")
    require(state_name in REQUIRED_ARTIFACTS, "run state is invalid")
    validate_history(state)
    artifacts = state.get("artifacts")
    require_object(artifacts, "artifacts")
    resolved = {}
    for key in REQUIRED_ARTIFACTS[state_name]:
        require_text(artifacts.get(key), f"artifacts.{key}")
        resolved[key] = artifact_path(run, artifacts[key], f"artifacts.{key}")
    auth = load_json(resolved["authorization"])
    validate_authorization(auth, now)
    source_id = state["source_id"]
    require(auth["source_id"] == source_id, "authorization source_id mismatch")
    if state_name in {"initiated", "source_authorized"}:
        return state

    research = load_json(resolved["research"])
    validate_research(research)
    require(research["source_id"] == source_id, "research source_id mismatch")
    media = load_json(resolved["media"])
    validate_media(media)
    require(media["source_id"] == source_id, "media source_id mismatch")
    artifact_path(run, media["normalized_media"], "media.normalized_media")
    artifact_path(run, media["frame_index"]["keyframes_artifact"], "frame_index.keyframes_artifact")
    if state_name == "media_preflight":
        return state

    transcript = load_json(resolved["transcript"])
    validate_transcript(transcript)
    require(transcript["source_id"] == source_id, "transcript source_id mismatch")
    require(auth["scope"]["transcription"] is True, "transcription is outside authorization")
    require(artifact_path(run, transcript["artifact"], "transcript.artifact").samefile(resolved["transcript"]), "transcript artifact must point to validated transcript")
    if state_name == "transcript_extracted":
        return state

    candidate_index = validate_text_candidates(load_json(resolved["text_candidates"]))
    require(all(item["source_id"] == source_id for item in candidate_index.values()), "candidate source_id mismatch")
    for candidate_id, candidate in candidate_index.items():
        for evidence in candidate["evidence"]:
            evidence_path = artifact_path(run, evidence["artifact"], f"candidate {candidate_id} evidence artifact")
            require(evidence_path.samefile(resolved["transcript"]), f"candidate {candidate_id} transcript evidence is detached")
        require(transcript_contains_quote(transcript, candidate["transcript_quote"], candidate["start_ms"], candidate["end_ms"]), f"candidate {candidate_id} quote/time claim is unsupported")
    if state_name == "text_candidates_extracted":
        return state

    vision_path = resolved["vision_reviews"]
    vision_doc = load_json(vision_path)
    vision_values = vision_doc.get("reviews") if isinstance(vision_doc.get("reviews"), list) else [vision_doc]
    vision_by_candidate = {}
    for position, vision in enumerate(vision_values, 1):
        require_object(vision, f"vision review {position}")
        validate_vision(vision, candidate_index.get(vision.get("candidate_id")))
        require(vision["candidate_id"] in candidate_index, f"vision candidate {vision.get('candidate_id')} is absent")
        require(vision["candidate_id"] not in vision_by_candidate, f"duplicate vision review for {vision['candidate_id']}")
        for evidence in vision["evidence"]:
            artifact_path(run, evidence["artifact"], f"vision {vision['vision_id']} evidence artifact")
        key_quote_path = artifact_path(run, vision["key_quote"]["artifact"], "vision key_quote artifact")
        require(key_quote_path.samefile(resolved["transcript"]), "vision key quote is detached from transcript")
        require(transcript_contains_quote(transcript, vision["key_quote"]["text"], vision["key_quote"]["start_ms"], vision["key_quote"]["end_ms"]), "vision key quote/time claim is unsupported")
        vision_by_candidate[vision["candidate_id"]] = vision
    require(set(vision_by_candidate) == set(candidate_index), "Vision must review every text candidate")
    if state_name == "vision_reviewed":
        return state

    campaign = load_json(resolved["campaign_brief"])
    require(campaign.get("schema_version") == 1, "campaign schema_version must be 1")
    require(campaign.get("source_id") == source_id, "campaign source_id mismatch")
    require_text(campaign.get("campaign_id"), "campaign_id")
    require_text(campaign.get("objective"), "campaign objective")
    require(campaign.get("platform") in auth["scope"]["allowed_platforms"], "campaign platform is outside authorization")
    judge = load_json(resolved["judge"])
    judge_index = validate_judge(judge)
    require(judge["source_id"] == source_id, "judge source_id mismatch")
    require(judge["campaign_brief_artifact"] in artifacts.values(), "Judge campaign reference is not the run campaign")
    require(judge["transcript_artifact"] in artifacts.values(), "Judge transcript reference is not the run transcript")
    for entry in judge_index.values():
        vision = vision_by_candidate.get(entry["candidate_id"])
        require(vision is not None, f"Judge candidate {entry['candidate_id']} has no Vision review")
        require(artifact_path(run, entry["vision_artifact"], "Judge vision artifact").samefile(vision_path), "Judge vision reference is detached")
        for evidence in vision["evidence"]:
            artifact_path(run, evidence["artifact"], "Judge evidence artifact")
    selection = load_json(resolved["selection"])
    validate_selection(selection, judge_index)
    require(selection["source_id"] == source_id, "selection source_id mismatch")
    require(selection["platform"] == judge["platform"] == campaign["platform"], "selection campaign/platform mismatch")
    require(selection["platform"] in auth["scope"]["allowed_platforms"], "selection platform is outside authorization")
    require(artifact_path(run, selection["judge_artifact"], "selection judge artifact").samefile(resolved["judge"]), "selection judge reference is detached")
    for ranking in selection["rankings"]:
        require(artifact_path(run, ranking["vision_artifact"], "selection vision artifact").samefile(vision_path), "selection vision reference is detached")
    if state_name == "judge_ranked":
        return state

    variant_doc = load_json(resolved["variants"])
    selected_candidates = {item["candidate_id"] for item in selection["rankings"]}
    variants = validate_variants(variant_doc, auth, selected_candidates)
    require(variant_doc["source_id"] == source_id, "variant source identity mismatch")
    require(variant_doc["selection_id"] == selection["selection_id"], "variant selection identity mismatch")
    if state_name == "variants_planned":
        return state

    qa_doc = load_json(resolved["qa"])
    qa = validate_qa(qa_doc, state_name, variants)
    require(qa_doc["source_id"] == source_id, "QA source identity mismatch")
    require(qa_doc["selection_id"] == selection["selection_id"], "QA selection identity mismatch")
    if state_name == "qa_failed":
        return state
    if state_name == "qa_passed":
        return state

    markcut = load_json(resolved["markcut"])
    validate_markcut(markcut, auth, selection, variants, qa)
    require(markcut["input_media"] == media["normalized_media"], "Markcut input media identity mismatch")
    for handoff in markcut["handoffs"]:
        for evidence in handoff["evidence_artifacts"]:
            artifact_path(run, evidence, "Markcut evidence artifact")
    if state_name == "markcut_ready":
        return state

    pub_auth = load_json(resolved["publication_authorization"])
    validate_publication_authorization(pub_auth, auth)
    require(pub_auth["source_id"] == source_id, "publication source identity mismatch")
    require(pub_auth["selection_id"] == selection["selection_id"], "publication selection identity mismatch")
    if state_name == "publication_authorized":
        return state

    pub_record = load_json(resolved["publication_record"])
    validate_publication_record(pub_record, auth)
    require(pub_record["source_id"] == source_id, "publication record source mismatch")
    require(pub_record["selection_id"] == selection["selection_id"], "publication record selection mismatch")
    require(pub_record["variant_id"] == pub_auth["variant_id"], "publication record variant mismatch")
    if state_name == "published":
        return state

    for key, window in (("metrics_24h", "24h"), ("metrics_72h", "72h"), ("metrics_7d", "7d")):
        metrics = load_json(resolved[key])
        validate_metrics(metrics, window)
        require(metrics["source_id"] == source_id, "metrics source identity mismatch")
        require(metrics["selection_id"] == selection["selection_id"], "metrics selection identity mismatch")
        require(metrics["variant_id"] == pub_record["variant_id"], "metrics variant identity mismatch")
        require(artifact_path(run, metrics["publication_artifact"], "metrics publication artifact").samefile(resolved["publication_record"]), "metrics publication reference is detached")
    if state_name in {"metrics_24h", "metrics_72h", "metrics_7d"}:
        return state

    learning = load_json(resolved["learning"])
    validate_learning(learning)
    require(learning["source_id"] == source_id, "learning source identity mismatch")
    require(learning["selection_id"] == selection["selection_id"], "learning selection identity mismatch")
    for artifact in learning["metrics_artifacts"]:
        require(artifact in artifacts.values(), "learning references an unbound metrics artifact")
    return state


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate = subparsers.add_parser("validate")
    validate.add_argument("kind", choices=sorted(VALIDATORS))
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
