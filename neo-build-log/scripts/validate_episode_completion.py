#!/usr/bin/env python3
from __future__ import annotations
import argparse
import json
from pathlib import Path
import subprocess
import sys

REQUIRED_FILES = [
    "evidence.md","story.md","post.md","visual-brief.md","video.md","qa.md",
    "next-day-brief.md","reviews/video-director.md","reviews/market.md",
]

PUBLICATION_RECEIPTS = ("publish/xhs-receipt.md", "publish/xiaohongshu.md")

def probe_stream_types(path: Path) -> set[str]:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", str(path)],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        return set()
    return {stream.get("codec_type", "") for stream in json.loads(result.stdout).get("streams", [])}

def validate(run: Path, require_publication: bool) -> list[str]:
    errors = []
    for rel in REQUIRED_FILES:
        p = run / rel
        if not p.is_file() or p.stat().st_size == 0:
            errors.append(f"missing required artifact: {rel}")
    for rel in ("reviews/video-director.md","reviews/market.md"):
        p = run / rel
        if p.is_file():
            t = p.read_text(encoding="utf-8").upper()
            if "PASS" not in t or "CHANGE_REQUIRED" in t:
                errors.append(f"review has not passed: {rel}")
    out = run / "output"
    videos = list(out.glob("*.mp4")) if out.is_dir() else []
    if not videos:
        errors.append("missing final rendered MP4 under output/")
    elif not {"audio", "video"}.issubset(probe_stream_types(videos[0])):
        errors.append("final rendered MP4 must contain audio and video streams")
    if require_publication:
        receipts = [run / rel for rel in PUBLICATION_RECEIPTS]
        if not any(path.is_file() and path.stat().st_size > 0 for path in receipts):
            errors.append("missing Xiaohongshu publication receipt: publish/xhs-receipt.md")
    return errors

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir", type=Path)
    ap.add_argument("--require-publication", action="store_true")
    a = ap.parse_args()
    errors = validate(a.run_dir, a.require_publication)
    if errors:
        for e in errors:
            print("FAIL:", e, file=sys.stderr)
        return 1
    print("PASS: episode completion contract satisfied")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
