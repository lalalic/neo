#!/usr/bin/env python3
"""WeChat Channels management commands backed by the authenticated creator UI."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BH_SCRIPT = HERE / "_manage_bh.py"


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Inspect WeChat Channels posts")
    subcommands = result.add_subparsers(dest="operation", required=True)
    status = subcommands.add_parser(
        "status",
        help="Resolve one post and return its manager status",
    )
    target = status.add_mutually_exclusive_group(required=True)
    target.add_argument("--post-id", help="Stable platform content id")
    target.add_argument("--title", help="Unique creator-manager title or description fragment")
    target.add_argument("--desc", help="Unique description fragment")
    return result


def main() -> int:
    args = parser().parse_args()
    config = vars(args)
    descriptor = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    try:
        json.dump(config, descriptor, ensure_ascii=False)
        descriptor.close()
        code = (
            BH_SCRIPT.read_text()
            .replace("__CFG_PATH__", descriptor.name)
            .replace("__ADAPTER_DIR__", str(HERE))
        )
        completed = subprocess.run(["browser-harness"], input=code, text=True, timeout=180)
        return completed.returncode
    finally:
        try:
            os.unlink(descriptor.name)
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
