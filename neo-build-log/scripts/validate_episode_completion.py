#!/usr/bin/env python3
from __future__ import annotations
import argparse
from pathlib import Path
import sys

REQUIRED_FILES = [
    "evidence.md","story.md","post.md","visual-brief.md","video.md","qa.md",
    "next-day-brief.md","reviews/video-director.md","reviews/market.md",
]

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
    if not out.is_dir() or not list(out.glob("*.mp4")):
        errors.append("missing final rendered MP4 under output/")
    if require_publication:
        receipt = run / "publish" / "xiaohongshu.md"
        if not receipt.is_file() or receipt.stat().st_size == 0:
            errors.append("missing Xiaohongshu publication receipt: publish/xiaohongshu.md")
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
