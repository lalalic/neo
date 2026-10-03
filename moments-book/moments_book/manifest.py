"""Validation for the canonical, privacy-safe Moments Book manifest."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any
import json
import math
import re


class ManifestValidationError(ValueError):
    """Raised when a manifest violates the canonical contract."""


_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_MATCH_STATES = {"matched", "unmatched", "unknown"}
_GPS_STATES = {"observed", "missing", "unknown"}


def _fail(path: str, message: str) -> None:
    raise ManifestValidationError(f"{path}: {message}")


def _obj(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(path, "must be an object")
    return value


def _array(value: Any, path: str) -> list[Any]:
    if not isinstance(value, list):
        _fail(path, "must be an array")
    return value


def _required(obj: dict[str, Any], names: tuple[str, ...], path: str) -> None:
    for name in names:
        if name not in obj:
            _fail(path, f"missing required field {name!r}")


def _id(value: Any, path: str) -> None:
    if not isinstance(value, str) or not value or not _ID.fullmatch(value):
        _fail(path, "must be a non-empty stable run-local identifier")


def _timestamp(value: Any, path: str) -> datetime:
    return _timestamp_value(value, path, require_timezone=True)


def _timestamp_value(value: Any, path: str, *, require_timezone: bool = True) -> datetime:
    if not isinstance(value, str):
        _fail(path, "must be an ISO-8601 timestamp or null")
    try:
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        _fail(path, "must be an ISO-8601 timestamp")
    if require_timezone and timestamp.tzinfo is None:
        _fail(path, "must include a timezone offset")
    return timestamp


def _nonempty_strings(value: Any, path: str) -> list[str]:
    if not isinstance(value, list) or not value:
        _fail(path, "must be a non-empty array")
    if not all(isinstance(item, str) and item for item in value):
        _fail(path, "must contain non-empty strings")
    return value


def _number(value: Any, path: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        _fail(path, "must be a finite number")
    return value


def _relative_path(value: Any, path: str, field: str) -> None:
    if value is None:
        return
    if not isinstance(value, str) or not value:
        _fail(path, f"{field} must be a non-empty run-relative path")
    source = Path(value)
    if source.is_absolute() or ".." in source.parts:
        _fail(path, f"{field} must be a run-relative path")


def _media(media: Any, path: str) -> None:
    media = _obj(media, path)
    _required(media, ("id", "kind", "originalMatch", "gps"), path)
    _id(media["id"], f"{path}.id")
    if media["kind"] not in {"image", "video", "unknown"}:
        _fail(f"{path}.kind", "must be image, video, or unknown")
    _relative_path(media.get("originalAsset"), f"{path}.originalAsset", "originalAsset")

    match = _obj(media["originalMatch"], f"{path}.originalMatch")
    _required(match, ("status",), f"{path}.originalMatch")
    if match["status"] not in _MATCH_STATES:
        _fail(f"{path}.originalMatch.status", "has an invalid state")
    confidence = match.get("confidence")
    if confidence is not None:
        confidence = _number(confidence, f"{path}.originalMatch.confidence")
        if not 0 <= confidence <= 1:
            _fail(f"{path}.originalMatch.confidence", "must be between 0 and 1 or null")
    if match["status"] == "matched":
        if confidence is None:
            _fail(f"{path}.originalMatch.confidence", "is required for matched media")
        _required(match, ("evidence",), f"{path}.originalMatch")
        _nonempty_strings(match["evidence"], f"{path}.originalMatch.evidence")
        if not isinstance(media.get("originalAsset"), str) or not media["originalAsset"]:
            _fail(f"{path}.originalAsset", "is required for matched media")
    elif media.get("originalAsset") is not None:
        _fail(f"{path}.originalAsset", "is only allowed for matched media")

    if media.get("capturedAt") is not None:
        _timestamp_value(media["capturedAt"], f"{path}.capturedAt")
    capture_time = media.get("originalCaptureTime")
    if capture_time is not None:
        capture_time = _obj(capture_time, f"{path}.originalCaptureTime")
        _required(capture_time, ("status",), f"{path}.originalCaptureTime")
        capture_status = capture_time["status"]
        if capture_status not in _GPS_STATES:
            _fail(f"{path}.originalCaptureTime.status", "has an invalid state")
        if capture_status == "observed":
            _required(
                capture_time,
                ("value", "source", "evidence"),
                f"{path}.originalCaptureTime",
            )
            _timestamp_value(
                capture_time["value"],
                f"{path}.originalCaptureTime.value",
                require_timezone=False,
            )
            if capture_time["source"] not in {"exif", "quicktime"}:
                _fail(f"{path}.originalCaptureTime.source", "must be exif or quicktime")
            _nonempty_strings(
                capture_time["evidence"],
                f"{path}.originalCaptureTime.evidence",
            )
        elif any(capture_time.get(name) is not None for name in ("value", "source")):
            _fail(f"{path}.originalCaptureTime", "value and source require status=observed")

    gps = _obj(media["gps"], f"{path}.gps")
    _required(gps, ("status",), f"{path}.gps")
    status = gps["status"]
    if status not in _GPS_STATES:
        _fail(f"{path}.gps.status", "has an invalid state")
    coords = (gps.get("latitude"), gps.get("longitude"))
    if status == "observed":
        for coordinate_path, coordinate in zip(("latitude", "longitude"), coords):
            _number(coordinate, f"{path}.gps.{coordinate_path}")
        if not -90 <= coords[0] <= 90 or not -180 <= coords[1] <= 180:
            _fail(f"{path}.gps", "coordinates are out of range")
        _required(gps, ("evidence",), f"{path}.gps")
        _nonempty_strings(gps["evidence"], f"{path}.gps.evidence")
        if match["status"] != "matched":
            _fail(f"{path}.gps.status", "observed GPS requires matched original media")
    elif any(v is not None for v in coords):
        _fail(f"{path}.gps", "coordinates require status=observed")
    if gps.get("altitudeMeters") is not None:
        _number(gps["altitudeMeters"], f"{path}.gps.altitudeMeters")
        if status != "observed":
            _fail(f"{path}.gps.altitudeMeters", "requires status=observed")


def validate_manifest(manifest: Any, schema_path: str | Path | None = None) -> dict[str, Any]:
    """Validate and return *manifest*; raise a path-specific error otherwise.

    ``schema_path`` is accepted for callers that want to pin the public schema;
    the executable checks below enforce the cross-field rules JSON Schema cannot
    express cleanly (chronology, GPS state, and match provenance).
    """
    if schema_path is not None:
        schema = json.loads(Path(schema_path).read_text())
        if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
            _fail("schema", "must use JSON Schema draft 2020-12")
    root = _obj(manifest, "manifest")
    _required(root, ("schemaVersion", "source", "years"), "manifest")
    if root["schemaVersion"] != 1:
        _fail("manifest.schemaVersion", "must be 1")
    source = _obj(root["source"], "manifest.source")
    if source.get("kind") != "wechat-moments":
        _fail("manifest.source.kind", "must be wechat-moments")
    if source.get("collector") not in {None, "phone-harness"}:
        _fail("manifest.source.collector", "must be phone-harness when present")

    years = _array(root["years"], "manifest.years")
    seen_years: set[int] = set()
    seen_moments: set[str] = set()
    seen_media: set[str] = set()
    previous_year: int | None = None
    for year_index, year in enumerate(years):
        year_path = f"manifest.years[{year_index}]"
        year = _obj(year, year_path)
        _required(year, ("year", "moments"), year_path)
        if not isinstance(year["year"], int) or isinstance(year["year"], bool) or not 1970 <= year["year"] <= 2200:
            _fail(f"{year_path}.year", "must be a calendar year")
        if year["year"] in seen_years:
            _fail(f"{year_path}.year", "year is duplicated")
        if previous_year is not None and year["year"] >= previous_year:
            _fail(f"{year_path}.year", "years must be chronological, newest first")
        seen_years.add(year["year"])
        previous_year = year["year"]
        moments = _array(year["moments"], f"{year_path}.moments")
        previous: datetime | None = None
        for moment_index, moment in enumerate(moments):
            path = f"{year_path}.moments[{moment_index}]"
            moment = _obj(moment, path)
            _required(moment, ("id", "media"), path)
            _id(moment["id"], f"{path}.id")
            if moment["id"] in seen_moments:
                _fail(f"{path}.id", "moment ID is duplicated")
            seen_moments.add(moment["id"])
            posted = moment.get("postedAt")
            if posted is not None:
                current = _timestamp(posted, f"{path}.postedAt")
                if current.year != year["year"]:
                    _fail(f"{path}.postedAt", "does not belong to its year")
                if previous is not None and current > previous:
                    _fail(f"{path}.postedAt", "moments must be chronological, newest first")
                previous = current
            if moment.get("sourceEvidence") is not None:
                _nonempty_strings(moment["sourceEvidence"], f"{path}.sourceEvidence")
            media = _array(moment["media"], f"{path}.media")
            for media_index, item in enumerate(media):
                media_path = f"{path}.media[{media_index}]"
                _media(item, media_path)
                item_id = item["id"]
                if item_id in seen_media:
                    _fail(f"{media_path}.id", "media ID is duplicated within the run")
                seen_media.add(item_id)
    selection = root.get("selection")
    if selection is not None:
        selection = _obj(selection, "manifest.selection")
        if selection.get("mode") == "latest-distinct-years" and selection.get("yearCount") not in {None, 2}:
            _fail("manifest.selection.yearCount", "latest-two-year selection must use yearCount=2")
    return root
