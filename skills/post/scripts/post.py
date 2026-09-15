#!/usr/bin/env python3
"""Dispatch to a platform-specific browser-harness posting adapter."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROFILES = HERE.parent / "references" / "platforms.json"
PLATFORMS = {
    "xhs": "xhs",
    "xiaohongshu": "xhs",
    "wechat-channels": "wechat-channels",
    "wechat": "wechat-channels",
    "channels": "wechat-channels",
    "tiktok": "tiktok",
    "youtube": "youtube",
    "yt": "youtube",
}


def usage() -> str:
    return (
        "usage: post.py <platform> [platform arguments...]\n"
        "platforms: xhs, wechat-channels, tiktok, youtube\n"
        "inspect: post.py --profile <platform>\n"
        "example: post.py xhs --video clip.mp4 --title 'Title' --body 'Body' --publish\n"
        "manage: post.py xhs status|comments|comment|reply ..."
    )


def main(argv: list[str]) -> int:
    if not argv or argv[0] in {"-h", "--help"}:
        print(usage())
        return 0 if argv else 2
    if argv[0] == "--list-platforms":
        print("xhs\nwechat-channels\ntiktok\nyoutube")
        return 0
    if argv[0] == "--profile":
        if len(argv) != 2:
            print("usage: post.py --profile <platform>", file=sys.stderr)
            return 2
        platform = PLATFORMS.get(argv[1].lower())
        if not platform:
            print(f"unknown platform: {argv[1]}", file=sys.stderr)
            return 2
        data = json.loads(PROFILES.read_text())
        print(json.dumps(data["platforms"][platform], ensure_ascii=False, indent=2))
        return 0

    platform = PLATFORMS.get(argv[0].lower())
    if not platform:
        print(f"unknown platform: {argv[0]}", file=sys.stderr)
        print(usage(), file=sys.stderr)
        return 2

    management_ops = {"status", "comments", "comment", "reply"}
    if platform == "xhs" and len(argv) > 1 and argv[1] in management_ops:
        entry = HERE / "platforms" / platform / "manage.py"
    else:
        entry = HERE / "platforms" / platform / "post.py"
    return subprocess.run([sys.executable, str(entry), *argv[1:]]).returncode


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
