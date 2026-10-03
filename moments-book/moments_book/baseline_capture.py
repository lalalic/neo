"""Probe display-derived baseline captures without claiming source metadata."""

from __future__ import annotations

from datetime import datetime
import hashlib
import json
from pathlib import Path
import struct
import subprocess
from typing import Any


class CaptureProbeError(ValueError):
    """Raised when a baseline capture cannot be measured safely."""


def _png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as fh:
        header = fh.read(24)
    if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise CaptureProbeError(f"{path}: not a PNG capture")
    width, height = struct.unpack(">II", header[16:24])
    if width <= 0 or height <= 0:
        raise CaptureProbeError(f"{path}: invalid PNG dimensions")
    return width, height


def _ffprobe(path: Path) -> dict[str, Any]:
    try:
        proc = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=format_name,duration:stream=codec_type,codec_name,width,height,r_frame_rate",
                "-of",
                "json",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        raise CaptureProbeError(f"{path}: ffprobe could not inspect capture") from exc
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise CaptureProbeError(f"{path}: ffprobe returned invalid JSON") from exc


def probe_baseline_capture(
    path: str | Path,
    *,
    capture_kind: str,
    captured_at: str,
    crop_applied: bool = False,
    overlay_state: str = "unknown",
) -> dict[str, Any]:
    """Measure a display-derived iPhone Mirroring capture.

    The returned metadata describes only the derived Mac-side capture. It
    deliberately marks original-media time/GPS/source metadata as unknown.
    """

    capture = Path(path)
    if not capture.is_file():
        raise CaptureProbeError(f"{capture}: capture file does not exist")
    if capture_kind not in {"still-frame", "screen-recording"}:
        raise CaptureProbeError("capture_kind must be still-frame or screen-recording")
    if overlay_state not in {"none-observed", "present", "unknown"}:
        raise CaptureProbeError("overlay_state must be none-observed, present, or unknown")
    try:
        timestamp = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise CaptureProbeError("captured_at must be an ISO-8601 timestamp") from exc
    if timestamp.tzinfo is None:
        raise CaptureProbeError("captured_at must include a timezone offset")

    width: int | None = None
    height: int | None = None
    container: str | None = None
    codec: str | None = None
    frame_rate: str | None = None
    duration_seconds: float | None = None

    if capture_kind == "still-frame":
        width, height = _png_size(capture)
        container = "png"
        codec = "png"
    else:
        details = _ffprobe(capture)
        fmt = details.get("format") or {}
        container = fmt.get("format_name")
        if fmt.get("duration") is not None:
            duration_seconds = float(fmt["duration"])
        video_stream = next(
            (item for item in details.get("streams", []) if item.get("codec_type") == "video"),
            None,
        )
        if video_stream:
            codec = video_stream.get("codec_name")
            width = video_stream.get("width")
            height = video_stream.get("height")
            frame_rate = video_stream.get("r_frame_rate")

    return {
        "source": "phone-harness/iphone-mirroring-window",
        "fidelity": "display-derived",
        "captureKind": capture_kind,
        "path": str(capture),
        "bytes": capture.stat().st_size,
        "sha256": hashlib.sha256(capture.read_bytes()).hexdigest(),
        "width": width,
        "height": height,
        "container": container,
        "codec": codec,
        "frameRate": frame_rate,
        "durationSeconds": duration_seconds,
        "capturedAt": captured_at,
        "cropApplied": crop_applied,
        "overlayState": overlay_state,
        "sourceMetadataPreserved": False,
        "originalCaptureTime": "unknown",
        "gps": "unknown",
    }
