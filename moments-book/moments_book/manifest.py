"""Validation for the canonical, privacy-safe Moments Book manifest."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any
import json
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
    if not isinstance(value, str):
        _fail(path, "must be an ISO-8601 timestamp or null")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        _fail(path, "must be an ISO-8601 timestamp")


def _media(media: Any, path: str) -> None:
    media = _obj(media, path)
    _required(media, ("id", "kind", "originalMatch", "gps"), path)
    _id(media["id"], f"{path}.id")
    if media["kind"] not in {"image", "video", "unknown"}:
        _fail(f"{path}.kind", "must be image, video, or unknown")

    match = _obj(media["originalMatch"], f"{path}.originalMatch")
    _required(match, ("status",), f"{path}.originalMatch")
    if match["status"] not in _MATCH_STATES:
        _fail(f"{path}.originalMatch.status", "has an invalid state")
    confidence = match.get("confidence")
    if confidence is not None and (not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or not 0 <= confidence <= 1):
        _fail(f"{path}.originalMatch.confidence", "must be between 0 and 1 or null")
    if match["status"] == "matched" and confidence is None:
        _fail(f"{path}.originalMatch.confidence", "is required for matched media")
    if match["status"] != "matched" and media.get("originalAsset") is not None:
        _fail(f"{path}.originalAsset", "is only allowed for matched media")

    gps = _obj(media["gps"], f"{path}.gps")
    _required(gps, ("status",), f"{path}.gps")
    status = gps["status"]
    if status not in _GPS_STATES:
        _fail(f"{path}.gps.status", "has an invalid state")
    coords = (gps.get("latitude"), gps.get("longitude"))
    if status == "observed":
        if any(not isinstance(v, (int, float)) or isinstance(v, bool) for v in coords):
            _fail(f"{path}.gps", "observed GPS requires numeric latitude and longitude")
        if not -90 <= coords[0] <= 90 or not -180 <= coords[1] <= 180:
            _fail(f"{path}.gps", "coordinates are out of range")
    elif any(v is not None for v in coords):
        _fail(f"{path}.gps", "coordinates require status=observed")
    if gps.get("altitudeMeters") is not None and not isinstance(gps["altitudeMeters"], (int, float)):
        _fail(f"{path}.gps.altitudeMeters", "must be numeric or null")


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
    for year_index, year in enumerate(years):
        year_path = f"manifest.years[{year_index}]"
        year = _obj(year, year_path)
        _required(year, ("year", "moments"), year_path)
        if not isinstance(year["year"], int) or isinstance(year["year"], bool) or not 1970 <= year["year"] <= 2200:
            _fail(f"{year_path}.year", "must be a calendar year")
        if year["year"] in seen_years:
            _fail(f"{year_path}.year", "year is duplicated")
        seen_years.add(year["year"])
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
            if moment.get("sourceEvidence") is not None and not all(isinstance(v, str) and v for v in _array(moment["sourceEvidence"], f"{path}.sourceEvidence")):
                _fail(f"{path}.sourceEvidence", "must contain non-empty strings")
            media = _array(moment["media"], f"{path}.media")
            media_ids: set[str] = set()
            for media_index, item in enumerate(media):
                media_path = f"{path}.media[{media_index}]"
                _media(item, media_path)
                item_id = item["id"]
                if item_id in media_ids:
                    _fail(f"{media_path}.id", "media ID is duplicated within the moment")
                media_ids.add(item_id)
    selection = root.get("selection")
    if selection is not None:
        selection = _obj(selection, "manifest.selection")
        if selection.get("mode") == "latest-distinct-years" and selection.get("yearCount") not in {None, 2}:
            _fail("manifest.selection.yearCount", "latest-two-year selection must use yearCount=2")
    return root
