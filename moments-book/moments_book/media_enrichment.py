"""Best-effort enrichment of baseline media with original phone assets."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
import json
import math
import subprocess

from .manifest import validate_manifest


VisualSimilarity = Callable[[dict[str, Any], "OriginalMedia"], Any]
MetadataReader = Callable[[Any], dict[str, Any]]
MatchState = str


@dataclass(frozen=True)
class OriginalMedia:
    """A candidate original asset and the evidence available for matching."""

    id: str
    path: str
    kind: str = "unknown"
    captured_at: str | None = None
    width: int | None = None
    height: int | None = None
    sibling_index: int | None = None
    similarity: float | None = None
    metadata: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class MatchResult:
    """A conservative match decision for one baseline media slot."""

    media_id: str
    status: MatchState
    confidence: float
    evidence: tuple[str, ...]
    original: OriginalMedia | None = None


class EnrichmentError(ValueError):
    """Raised when enrichment inputs are malformed before any run is touched."""


def _as_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _score(
    media: dict[str, Any],
    moment: dict[str, Any],
    media_index: int,
    original: OriginalMedia,
) -> tuple[float, list[str]]:
    scores: list[tuple[float, float, str]] = []
    media_time = _as_datetime(media.get("capturedAt") or moment.get("postedAt"))
    original_time = _as_datetime(original.captured_at)
    if media_time and original_time:
        if media_time.tzinfo and original_time.tzinfo:
            age_hours = abs((media_time - original_time).total_seconds()) / 3600
            score = max(0.0, 1.0 - age_hours / 24.0)
        else:
            score = 0.5
        scores.append((0.4, score, "capture-time"))

    similarity = original.similarity
    if similarity is not None:
        if not 0 <= similarity <= 1:
            raise EnrichmentError(f"original {original.id}: similarity must be between 0 and 1")
        scores.append((0.3, similarity, "visual-similarity"))

    if media.get("kind") == original.kind:
        scores.append((0.1, 1.0, "media-kind"))

    if media.get("width") and media.get("height") and original.width and original.height:
        ratio = min(media["width"] / original.width, media["height"] / original.height)
        scores.append((0.1, max(0.0, min(1.0, ratio)), "dimensions"))

    if media_index is not None and original.sibling_index is not None:
        distance = abs(media_index - original.sibling_index)
        scores.append((0.1, max(0.0, 1.0 - distance / 2.0), "ordering"))

    weight = sum(item[0] for item in scores)
    if not weight:
        return 0.0, []
    confidence = sum(item[0] * item[1] for item in scores) / weight
    evidence = [f"evidence:{name}" for _, score, name in scores if score > 0]
    return confidence, evidence


def match_original_media(
    manifest: Mapping[str, Any],
    originals: Sequence[OriginalMedia],
    *,
    visual_similarity: VisualSimilarity | None = None,
) -> dict[str, MatchResult]:
    """Match each baseline slot once, rejecting ties and low-evidence candidates."""

    validate_manifest(manifest)
    if len({item.id for item in originals}) != len(originals):
        raise EnrichmentError("original media IDs must be unique")

    results: dict[str, MatchResult] = {}
    for moment in (item for year in manifest["years"] for item in year["moments"]):
        for index, media in enumerate(moment["media"]):
            candidates: list[tuple[float, list[str], OriginalMedia]] = []
            for original in originals:
                effective = original
                if visual_similarity is not None and original.similarity is None:
                    similarity = visual_similarity(media, original)
                    if similarity is not None and not 0 <= similarity <= 1:
                        raise EnrichmentError(f"original {original.id}: similarity must be between 0 and 1")
                    effective = OriginalMedia(**{**original.__dict__, "similarity": similarity})
                confidence, evidence = _score(media, moment, index, effective)
                candidates.append((confidence, evidence, effective))

            candidates.sort(key=lambda item: item[0], reverse=True)
            if not originals:
                result = MatchResult(media["id"], "unknown", 0.0, ("original-library:unavailable",))
            else:
                best_confidence, best_evidence, best = candidates[0]
                second_confidence = candidates[1][0] if len(candidates) > 1 else -1.0
                if best_confidence < 0.9:
                    result = MatchResult(
                        media["id"],
                        "unmatched",
                        best_confidence,
                        ("match:below-confidence-threshold", *best_evidence),
                    )
                elif second_confidence >= best_confidence * 0.95:
                    competitor = candidates[1][2].id
                    result = MatchResult(
                        media["id"],
                        "unmatched",
                        best_confidence,
                        (f"match:ambiguous-{best.id}-{competitor}",),
                    )
                elif len(best_evidence) < 2:
                    result = MatchResult(
                        media["id"],
                        "unmatched",
                        best_confidence,
                        ("match:insufficient-independent-evidence",),
                    )
                else:
                    result = MatchResult(
                        media["id"],
                        "matched",
                        best_confidence,
                        tuple(best_evidence),
                        best,
                    )
            results[media["id"]] = result
    return results


def read_original_metadata(path: str | Path) -> dict[str, Any]:
    """Read only the date and location tags needed to audit an original asset."""

    try:
        proc = subprocess.run(
            [
                "exiftool",
                "-j",
                "-G1",
                "-n",
                "-DateTimeOriginal",
                "-CreationDate",
                "-CreateDate",
                "-GPSLatitude",
                "-GPSLongitude",
                "-GPSAltitude",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        raise EnrichmentError(f"{path}: original metadata could not be read") from exc
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise EnrichmentError(f"{path}: original metadata was invalid JSON") from exc


def _tag(metadata: Mapping[str, Any], *names: str) -> Any:
    lower = {str(key).lower(): value for key, value in metadata.items()}
    for name in names:
        if name.lower() in lower:
            return lower[name.lower()]
    return None


def _normalized_metadata(metadata: Mapping[str, Any] | None) -> dict[str, Any]:
    if metadata is None or not metadata:
        return {
            "checked": metadata is not None,
            "captureTime": None,
            "captureTimeSource": None,
            "captureTimeTimezoneAware": False,
            "gps": {},
        }

    capture_value = _tag(
        metadata,
        "EXIF:DateTimeOriginal",
        "QuickTime:CreationDate",
        "QuickTime:CreateDate",
    )
    source = None
    timezone_aware = False
    if capture_value is not None:
        matched_key = next(
            (
                key
                for key in ("EXIF:DateTimeOriginal", "QuickTime:CreationDate", "QuickTime:CreateDate")
                if _tag(metadata, key) == capture_value
            ),
            None,
        )
        source = matched_key.split(":", 1)[0].lower() if matched_key else None
        try:
            parsed_capture = datetime.fromisoformat(str(capture_value).replace("Z", "+00:00"))
            timezone_aware = parsed_capture.tzinfo is not None
        except ValueError:
            capture_value = None
            source = None

    latitude = _tag(metadata, "EXIF:GPSLatitude", "QuickTime:GPSLatitude")
    longitude = _tag(metadata, "EXIF:GPSLongitude", "QuickTime:GPSLongitude")
    altitude = _tag(metadata, "EXIF:GPSAltitude", "QuickTime:GPSAltitude")
    return {
        "checked": True,
        "captureTime": str(capture_value) if capture_value is not None else None,
        "captureTimeSource": source,
        "captureTimeTimezoneAware": timezone_aware,
        "gps": {
            "latitude": latitude,
            "longitude": longitude,
            "altitudeMeters": altitude,
        },
    }


def _gps_state(values: Mapping[str, Any], metadata: Mapping[str, Any] | None) -> tuple[str, dict[str, Any]]:
    latitude = values.get("latitude")
    longitude = values.get("longitude")
    altitude = values.get("altitudeMeters")
    if latitude is None or longitude is None:
        return "missing" if metadata else "unknown", {}
    if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
        return "unknown", {}
    if (
        isinstance(latitude, bool)
        or isinstance(longitude, bool)
        or not math.isfinite(latitude)
        or not math.isfinite(longitude)
        or not -90 <= latitude <= 90
        or not -180 <= longitude <= 180
    ):
        return "unknown", {}
    result = {"latitude": latitude, "longitude": longitude}
    if altitude is not None and isinstance(altitude, (int, float)) and not isinstance(altitude, bool) and math.isfinite(altitude):
        result["altitudeMeters"] = altitude
    return "observed", result


def enrich_manifest(
    manifest: Mapping[str, Any],
    originals: Sequence[OriginalMedia],
    *,
    visual_similarity: VisualSimilarity | None = None,
    metadata_reader: MetadataReader | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Return an enriched manifest and non-fatal issue messages."""

    enriched = json.loads(json.dumps(manifest))
    matches = match_original_media(enriched, originals, visual_similarity=visual_similarity)
    issues: list[str] = []
    reader = metadata_reader or read_original_metadata
    for moment in (item for year in enriched["years"] for item in year["moments"]):
        for media in moment["media"]:
            result = matches[media["id"]]
            if result.status == "unknown":
                continue
            media["originalMatch"] = {
                "status": result.status,
                "confidence": result.confidence,
                "evidence": list(result.evidence),
            }
            if result.status != "matched" or result.original is None:
                media["originalAsset"] = None
                media["capturedAt"] = None
                media.pop("originalCaptureTime", None)
                media["gps"] = {"status": "unknown"}
                continue

            original = result.original
            media["originalAsset"] = original.path
            try:
                raw_metadata = dict(original.metadata) if original.metadata is not None else reader(original.path)
            except Exception as exc:
                raw_metadata = None
                issues.append(f"{media['id']}: original metadata unavailable ({exc})")
            details = _normalized_metadata(raw_metadata)
            capture = details["captureTime"]
            source = details["captureTimeSource"]
            if capture:
                media["originalCaptureTime"] = {
                    "status": "observed",
                    "value": capture,
                    "source": source,
                    "evidence": [f"original-metadata:{source or 'unspecified'}-capture-time"],
                }
                if details["captureTimeTimezoneAware"]:
                    media["capturedAt"] = datetime.fromisoformat(str(capture).replace("Z", "+00:00")).isoformat()
            else:
                media["originalCaptureTime"] = {
                    "status": "missing" if details["checked"] else "unknown",
                    "value": None,
                    "source": None,
                }

            state, values = _gps_state(details["gps"], details if details["checked"] else None)
            media["gps"] = {"status": state, **values}
            if state == "observed":
                media["gps"]["evidence"] = ["original-metadata:gps"]

    validate_manifest(enriched)
    return enriched, issues
