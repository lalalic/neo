import json
import struct
import zlib

import pytest

from moments_book.baseline_capture import CaptureProbeError, probe_baseline_capture


def _png(path, width=4, height=3):
    raw = b"".join(b"\x00" + b"\x11\x22\x33" * width for _ in range(height))

    def chunk(kind, payload):
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    payload = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(payload)


def test_still_probe_measures_derived_capture_without_claiming_source_metadata(tmp_path):
    image = tmp_path / "frame.png"
    _png(image, 7, 5)

    result = probe_baseline_capture(
        image,
        capture_kind="still-frame",
        captured_at="2026-09-28T14:00:00-04:00",
        crop_applied=True,
        overlay_state="none-observed",
    )

    assert result["source"] == "phone-harness/iphone-mirroring-window"
    assert result["fidelity"] == "display-derived"
    assert (result["width"], result["height"]) == (7, 5)
    assert result["container"] == "png"
    assert result["sourceMetadataPreserved"] is False
    assert result["originalCaptureTime"] == "unknown"
    assert result["gps"] == "unknown"
    assert result["cropApplied"] is True


def test_video_probe_reports_derived_stream_properties(monkeypatch, tmp_path):
    movie = tmp_path / "capture.mov"
    movie.write_bytes(b"synthetic movie fixture")

    class Result:
        stdout = json.dumps({
            "format": {"format_name": "mov,mp4", "duration": "2.5"},
            "streams": [{
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1170,
                "height": 2532,
                "r_frame_rate": "30/1",
            }],
        })

    monkeypatch.setattr(
        "moments_book.baseline_capture.subprocess.run",
        lambda *args, **kwargs: Result(),
    )

    result = probe_baseline_capture(
        movie,
        capture_kind="screen-recording",
        captured_at="2026-09-28T18:00:00Z",
        overlay_state="present",
    )

    assert result["codec"] == "h264"
    assert (result["width"], result["height"]) == (1170, 2532)
    assert result["durationSeconds"] == 2.5
    assert result["frameRate"] == "30/1"
    assert result["sourceMetadataPreserved"] is False


@pytest.mark.parametrize(
    "kwargs, message",
    [
        ({"capture_kind": "original", "captured_at": "2026-09-28T18:00:00Z"}, "capture_kind"),
        ({"capture_kind": "still-frame", "captured_at": "2026-09-28T18:00:00"}, "timezone"),
        ({"capture_kind": "still-frame", "captured_at": "2026-09-28T18:00:00Z", "overlay_state": "clean"}, "overlay_state"),
    ],
)
def test_probe_rejects_ambiguous_provenance(tmp_path, kwargs, message):
    image = tmp_path / "frame.png"
    _png(image)
    with pytest.raises(CaptureProbeError, match=message):
        probe_baseline_capture(image, **kwargs)
