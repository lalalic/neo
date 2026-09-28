"""Render one canonical manifest as a private book and one Markcut video."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import shutil
from typing import Any, Mapping

from .manifest import validate_manifest


class RenderError(ValueError):
    """Raised when canonical inputs cannot be rendered or verified safely."""


_SAFE_SUFFIX = re.compile(r"^\.[A-Za-z0-9]{1,8}$")
_HEADING = re.compile(r"^(#{1,6}) (.+)$")
_MEDIA_BULLET = re.compile(r'^- (image|video) src:"([^"]+)"(.*)$')
_MAP_BULLET = re.compile(r"^- map .*$")
_SCRIPT_BULLET = re.compile(r'^- script "(.*)"$')
_WAYPOINT = re.compile(r"\[([^\]]+)\]")
_WAYPOINT_ITEM = re.compile(r"(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),\"[^\"]*\"")


def _quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _one_line(value: str) -> str:
    return " ".join(value.splitlines()).strip()


def _book_media_provenance(media: Mapping[str, Any]) -> str:
    match = media["originalMatch"]
    if match["status"] == "matched":
        confidence = match.get("confidence")
        return f"matched original (confidence {confidence})"
    if match["status"] == "unmatched":
        return "unmatched baseline capture"
    return "baseline capture, original-match unknown"


def _gps_status(media: Mapping[str, Any]) -> str:
    gps = media["gps"]
    if gps["status"] == "observed":
        return "observed from matched original metadata"
    if gps["status"] == "missing":
        return "checked; no GPS metadata present"
    return "unknown"


def render_book(manifest: Mapping[str, Any]) -> str:
    """Return an editable Markdown book whose hierarchy mirrors the manifest."""

    manifest = validate_manifest(manifest)
    lines = ["# Memoir", "", "Source: WeChat Moments captured with phone-harness", ""]
    for year in manifest["years"]:
        lines.extend([f"## {year['year']}", ""])
        for moment in year["moments"]:
            lines.extend([f"### {moment['id']}", ""])
            if moment.get("postedAt") is not None:
                lines.append(f"- Posted: {moment['postedAt']}")
            if moment.get("locationText") is not None:
                lines.append(f"- Visible location: {moment['locationText']}")
            if moment.get("text") is not None:
                lines.append("- Text:")
                lines.extend(f"  > {line}" for line in moment["text"].splitlines() or [""])
            else:
                lines.append("- Text: not visible")
            for media in moment["media"]:
                asset = media.get("originalAsset") or media.get("wechatEvidence")
                asset_text = f" (`{asset}`)" if asset else ""
                lines.append(
                    f"- Media {media['id']} ({media['kind']}): "
                    f"{_book_media_provenance(media)}{asset_text}; GPS {_gps_status(media)}"
                )
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _selected_asset(media: Mapping[str, Any]) -> str | None:
    if media["originalMatch"]["status"] == "matched":
        return media.get("originalAsset")
    return media.get("wechatEvidence")


def _copy_assets(
    manifest: Mapping[str, Any],
    output_dir: Path,
    manifest_path: Path | None,
) -> dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    asset_dir = output_dir / "assets"
    asset_dir.mkdir(exist_ok=True)
    mapping: dict[str, str] = {}
    base = manifest_path.resolve().parent if manifest_path is not None else Path.cwd()

    for moment in (item for year in manifest["years"] for item in year["moments"]):
        for media in moment["media"]:
            if media["kind"] not in {"image", "video"}:
                continue
            source_value = _selected_asset(media)
            if not source_value:
                raise RenderError(f"media {media['id']}: {media['kind']} has no renderable asset")
            source = Path(source_value)
            if not source.is_absolute():
                source = base / source
            if not source.is_file():
                raise RenderError(f"media {media['id']}: asset does not exist: {source_value}")
            suffix = source.suffix
            if not _SAFE_SUFFIX.fullmatch(suffix):
                raise RenderError(f"media {media['id']}: unsupported asset suffix {suffix!r}")
            destination = asset_dir / f"{media['id']}{suffix}"
            shutil.copyfile(source, destination)
            mapping[media["id"]] = f"assets/{destination.name}"
    return mapping


def _observed_waypoints(moment: Mapping[str, Any]) -> list[tuple[float, float, str]]:
    waypoints: list[tuple[float, float, str]] = []
    for media in moment["media"]:
        gps = media["gps"]
        if gps["status"] == "observed":
            waypoints.append((gps["latitude"], gps["longitude"], f"observed-gps:{media['id']}"))
    return waypoints


def render_markcut(
    manifest: Mapping[str, Any],
    *,
    asset_paths: Mapping[str, str] | None = None,
) -> str:
    """Return one Markcut document with year parents and Moment children."""

    manifest = validate_manifest(manifest)
    asset_paths = asset_paths or {}
    lines = ["# video", "width:1920 height:1080 fps:30 layout:series", ""]
    for year in manifest["years"]:
        lines.extend([f"## year-{year['year']}", f"title:{_quote(str(year['year']))}", ""])
        for moment in year["moments"]:
            lines.extend([f"### {moment['id']}", ""])
            for media in moment["media"]:
                if media["kind"] not in {"image", "video"}:
                    continue
                path = asset_paths.get(media["id"], _selected_asset(media))
                if not path:
                    raise RenderError(f"media {media['id']}: no renderable Markcut asset")
                normalized = Path(path).as_posix()
                if Path(normalized).is_absolute() or normalized.startswith("../"):
                    raise RenderError(f"media {media['id']}: Markcut asset must be local and relative")
                lines.append(f"- {media['kind']} src:{_quote(normalized)} isBackground:true")

            text = moment.get("text")
            narration = text if text is not None else "Moment without visible text."
            lines.append(f"- script {_quote(_one_line(narration))}")

            waypoints = _observed_waypoints(moment)
            if waypoints:
                encoded = ";".join(
                    f"{latitude},{longitude},{_quote(label)}"
                    for latitude, longitude, label in waypoints
                )
                lines.append(f"- map duration:3 waypoints:[{encoded}]")
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _heading_blocks(source: str) -> list[tuple[int, str, list[str]]]:
    blocks: list[tuple[int, str, list[str]]] = []
    current_level = 0
    current_name = ""
    current_lines: list[str] = []
    for line in source.splitlines():
        heading = _HEADING.fullmatch(line)
        if heading:
            if current_level:
                blocks.append((current_level, current_name, current_lines))
            current_level, current_name = len(heading.group(1)), heading.group(2)
            current_lines = []
        elif current_level:
            current_lines.append(line)
    if current_level:
        blocks.append((current_level, current_name, current_lines))
    return blocks


def _extract_waypoints(line: str) -> list[tuple[float, float]]:
    match = _WAYPOINT.search(line)
    if not match:
        return []
    parsed: list[tuple[float, float]] = []
    for item in match.group(1).split(";"):
        waypoint = _WAYPOINT_ITEM.fullmatch(item.strip())
        if waypoint:
            parsed.append((float(waypoint.group(1)), float(waypoint.group(2))))
    return parsed


def validate_markcut(manifest: Mapping[str, Any], source: str) -> None:
    """Validate the generated Markcut structure and privacy-sensitive map rule."""

    manifest = validate_manifest(manifest)
    blocks = _heading_blocks(source)
    if not blocks or blocks[0][0] != 1 or blocks[0][1] != "video":
        raise RenderError("Markcut must begin with exactly one '# video' root")
    if any(level == 1 for level, _, _ in blocks[1:]):
        raise RenderError("Markcut must contain only one video root")

    year_blocks = [item for item in blocks if item[0] == 2]
    expected_years = [f"year-{year['year']}" for year in manifest["years"]]
    if [name for _, name, _ in year_blocks] != expected_years:
        raise RenderError("Markcut year scenes do not match manifest chronology")

    moment_blocks = [item for item in blocks if item[0] == 3]
    expected_moments = [moment["id"] for year in manifest["years"] for moment in year["moments"]]
    if [name for _, name, _ in moment_blocks] != expected_moments:
        raise RenderError("Markcut Moment scenes do not match manifest chronology")

    moments = [moment for year in manifest["years"] for moment in year["moments"]]
    for moment, (_, _, block_lines) in zip(moments, moment_blocks):
        scripts = [line for line in block_lines if _SCRIPT_BULLET.fullmatch(line)]
        if len(scripts) != 1:
            raise RenderError(f"Moment {moment['id']}: Markcut scene must have exactly one script")
        expected_text = moment.get("text")
        expected_narration = expected_text if expected_text is not None else "Moment without visible text."
        quoted_narration = scripts[0].removeprefix("- script ")
        actual = json.loads(quoted_narration)
        if actual != _one_line(expected_narration):
            raise RenderError(f"Moment {moment['id']}: Markcut narration changed source text")

        for line in block_lines:
            media_match = _MEDIA_BULLET.fullmatch(line)
            if media_match:
                path = Path(media_match.group(2))
                if path.is_absolute() or path.parts and path.parts[0] == "..":
                    raise RenderError(f"Moment {moment['id']}: Markcut asset path is not local-relative")
                if "isBackground:true" not in media_match.group(3):
                    raise RenderError(f"Moment {moment['id']}: narrated media must use isBackground:true")

            if _MAP_BULLET.fullmatch(line):
                actual_coords = _extract_waypoints(line)
                expected_coords = [
                    (float(latitude), float(longitude))
                    for latitude, longitude, _ in _observed_waypoints(moment)
                ]
                if actual_coords != expected_coords:
                    raise RenderError(f"Moment {moment['id']}: Markcut map does not exactly use observed GPS")


def verify_outputs(
    manifest: Mapping[str, Any],
    book: str,
    markcut: str,
) -> dict[str, Any]:
    """Verify shared hierarchy, source preservation, and Markcut invariants."""

    manifest = validate_manifest(manifest)
    validate_markcut(manifest, markcut)
    years = [year["year"] for year in manifest["years"]]
    moments = [moment["id"] for year in manifest["years"] for moment in year["moments"]]
    book_moments = [name for level, name, _ in _heading_blocks(book) if level == 3]
    if book_moments != moments:
        raise RenderError("Book does not preserve manifest Moment order")

    flattened_moments = [item for year in manifest["years"] for item in year["moments"]]
    quoted_book = "\n".join(
            line[4:] if line.startswith("  > ") else line
            for line in book.splitlines()
        )
    for moment in flattened_moments:
        text = moment.get("text")
        if text is not None and text not in quoted_book:
            raise RenderError(f"Moment {moment['id']}: book did not preserve source text")
        location = moment.get("locationText")
        if location is not None and location not in book:
            raise RenderError(f"Moment {moment['id']}: book omitted visible location text")

    return {
        "status": "passed",
        "years": years,
        "momentIds": moments,
        "bookMomentIds": book_moments,
        "markcutMomentIds": [name for level, name, _ in _heading_blocks(markcut) if level == 3],
        "bookSha256": hashlib.sha256(book.encode()).hexdigest(),
        "markcutSha256": hashlib.sha256(markcut.encode()).hexdigest(),
    }


def write_outputs(
    manifest: Mapping[str, Any],
    output_dir: str | Path,
    *,
    manifest_path: str | Path | None = None,
) -> dict[str, Path]:
    """Render, verify, and durably write the book, Markcut source, and QA report."""

    manifest = validate_manifest(manifest)
    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    manifest_path_value = Path(manifest_path) if manifest_path is not None else None
    assets = _copy_assets(manifest, destination, manifest_path_value)
    book = render_book(manifest)
    markcut = render_markcut(manifest, asset_paths=assets)
    verification = verify_outputs(manifest, book, markcut)
    verification["assets"] = assets

    book_path = destination / "book.md"
    markcut_path = destination / "video.md"
    verification_path = destination / "verification.json"
    book_path.write_text(book, encoding="utf-8")
    markcut_path.write_text(markcut, encoding="utf-8")
    verification_path.write_text(
        json.dumps(verification, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return {"book": book_path, "markcut": markcut_path, "verification": verification_path}


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args(argv)
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    paths = write_outputs(manifest, args.output_dir, manifest_path=args.manifest)
    for name, path in paths.items():
        print(f"{name}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
