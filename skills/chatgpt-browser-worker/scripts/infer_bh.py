#!/usr/bin/env python3
"""Synchronous authenticated ChatGPT browser inference for local media."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile

BH_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_infer_bh.py")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--file", action="append", default=[])
    parser.add_argument("--expect-json", action="store_true")
    parser.add_argument("--result-timeout", type=float, default=240)
    parser.add_argument("--attempts", type=int, default=3)
    args = parser.parse_args()
    if args.result_timeout <= 0:
        parser.error("--result-timeout must be > 0")
    if args.attempts < 1 or args.attempts > 5:
        parser.error("--attempts must be 1..5")
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as handle:
        json.dump(vars(args), handle, ensure_ascii=False)
        config_path = handle.name
    try:
        code = open(BH_SCRIPT, encoding="utf-8").read().replace("__CFG_PATH__", config_path)
        last_error = ""
        for attempt in range(1, args.attempts + 1):
            try:
                completed = subprocess.run(
                    ["browser-harness"],
                    input=code,
                    text=True,
                    capture_output=True,
                    timeout=args.result_timeout + 90,
                )
            except subprocess.TimeoutExpired:
                last_error = f"attempt {attempt}: browser inference timed out"
                continue
            if completed.returncode != 0:
                last_error = (completed.stderr or completed.stdout or f"attempt {attempt} failed").strip()
                continue
            lines=[line for line in completed.stdout.splitlines() if line.strip()]
            if not lines:
                last_error = f"attempt {attempt}: browser inference returned no result"
                continue
            try:
                payload=json.loads(lines[-1])
                text=payload["text"]
            except (json.JSONDecodeError, KeyError, TypeError) as exc:
                last_error = f"attempt {attempt}: invalid inference envelope: {exc}"
                continue
            print(text)
            return 0
        print(last_error or "chatgpt browser inference failed", file=os.sys.stderr)
        return 1
    finally:
        os.unlink(config_path)


if __name__ == "__main__":
    raise SystemExit(main())
