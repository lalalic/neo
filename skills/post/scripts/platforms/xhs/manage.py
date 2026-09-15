#!/usr/bin/env python3
"""Manage published Xiaohongshu notes: status, comments, comment, and reply."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BH_SCRIPT = HERE / "_manage_bh.py"


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Inspect and interact with Xiaohongshu posts")
    sub = p.add_subparsers(dest="operation", required=True)

    def target(sp: argparse.ArgumentParser) -> None:
        g = sp.add_mutually_exclusive_group(required=True)
        g.add_argument("--note-id")
        g.add_argument("--title")

    s = sub.add_parser("status", help="Verify platform-side post status")
    target(s)

    c = sub.add_parser("comments", help="Read recent comment/reply notifications for one post")
    target(c)
    c.add_argument("--limit", type=int, default=50)

    n = sub.add_parser("comment", help="Write a top-level comment on a post")
    target(n)
    n.add_argument("--text", required=True)

    r = sub.add_parser("reply", help="Reply to a recent comment/reply notification for one post")
    target(r)
    match = r.add_mutually_exclusive_group(required=True)
    match.add_argument("--comment-id", help="Stable comment id returned by the comments command")
    match.add_argument("--comment-index", type=int, help="0-based index from the comments command")
    match.add_argument("--contains", help="Unique substring in the target comment text")
    r.add_argument("--text", required=True)
    return p


def main() -> int:
    args = parser().parse_args()
    cfg = vars(args)
    if cfg.get("limit", 1) < 1 or cfg.get("limit", 1) > 200:
        raise SystemExit("--limit must be between 1 and 200")

    fd = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    try:
        json.dump(cfg, fd, ensure_ascii=False)
        fd.close()
        code = BH_SCRIPT.read_text().replace("__CFG_PATH__", fd.name)
        result = subprocess.run(["browser-harness"], input=code, text=True, timeout=180)
        return result.returncode
    finally:
        try:
            os.unlink(fd.name)
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
