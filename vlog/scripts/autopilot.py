#!/usr/bin/env python3
"""Consume validated NeoX instructions and start Codex production."""
import hashlib
import ipaddress
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
BRIDGE_NEXT = "http://127.0.0.1:8787/agent/next?timeout=25"
BRIDGE_PEEK = "http://127.0.0.1:8787/agent/peek"
HANDOFF = re.compile(
    r"\A(?P<instruction>[^\r\n]{1,1000})\s*"
    r"iPhone media MCP server:\s*(?P<endpoint>http://(?P<host>[^/:]+):9223/mcp)\s*"
    r"LAN only, no auth\.",
    re.DOTALL,
)


def endpoint(message: str) -> Optional[str]:
    match = HANDOFF.match(message.strip())
    if not match:
        return None
    instruction = match.group("instruction").strip().lower()
    if "vlog" not in instruction or not any(
        word in instruction for word in ("photo", "video", "media", "照片", "视频", "媒体")
    ):
        return None
    try:
        if not ipaddress.ip_address(match.group("host")).is_private:
            return None
    except ValueError:
        return None
    return match.group("endpoint")


def handoff_instruction(message: str) -> Optional[str]:
    match = HANDOFF.match(message.strip())
    if not match:
        return None
    return match.group("instruction").strip()


def prompt(phone: str, run_id: str, instruction: str) -> str:
    date = datetime.now().astimezone().date().isoformat()
    run_root = ROOT / "runs" / "neo-vlog" / f"{date}-{run_id}"
    return f"""You are the unattended Neo/Vlog producer. A validated local phone handoff supplied the user's complete instruction.

Today: {date}
Run ID: {run_id}
NeoX MCP endpoint: {phone}
Original user instruction: {instruction}
Workspace: {ROOT}
Run root: {run_root}

Complete production automatically through storyboard review. Do not ask the user to run commands or choose media. Do not publish, schedule, upload, send messages, or render a final video.

1. Read {ROOT.parent / 'AGENTS.md'}, docs/architecture.md, docs/producer.md, and the installed Markcut and NeoX skills.
2. Interpret the original instruction yourself, including natural-language dates, recency, Chinese phrases, and constraints such as “今天还没处理的”. Resolve the requested window in the local timezone, then call NeoX tools/list and search only that window. Inspect metadata/thumbnails or sampled frames, then export only selected assets to {run_root}/assets. Exclude source IDs already used when the instruction asks for unprocessed media. Use 720p for video drafts. Always clear the phone's staged exports after verified downloads.
3. Run `npx @lalalic/markcut vision` on the downloaded assets. If no usable media exists, record that truthfully in the run and finish without creating a fake episode.
4. Create `{run_root}/source-manifest.json` and an original-footage-first `{run_root}/vlog.md`. Use only portable relative paths, preserve series continuity, and make every narrated visual `isBackground:true`. Enforce the audio and voice contract in docs/architecture.md: source episode-appropriate BGM with the installed audio-sourcing skill, store it as an intentional episode asset, and mix it beneath narration/location sound. Prefer suitable original voice; otherwise use tested Ray-timbre narration or the documented Mandarin fallback, and complete local STT QA before any later final render.
5. Run Markcut verify. Create a headless storyboard preview process on an unused local port with \`--no-browser\`, probe its URL with a simple HTTP request, and record the URL plus a brief review note under `{run_root}/review/`. Do not use browser automation. Record real workflow evidence and leave the episode at storyboard review awaiting editorial approval.

Use the run-local SQLite workflow at `{run_root}/state/vlog.sqlite`. This is an unattended run: execute safely within this workspace and leave a concise completion/failure report at `{run_root}/report.md`. Do not make unrelated repository changes."""


def read(url: str, timeout: int) -> Optional[str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return response.read().decode("utf-8") if response.status == 200 else None
    except urllib.error.HTTPError as error:
        return None if error.code == 204 else None


def consume() -> Optional[str]:
    return read(BRIDGE_NEXT, 30)


def peek() -> Optional[str]:
    return read(BRIDGE_PEEK, 5)


def run(message: str) -> int:
    phone = endpoint(message)
    instruction = handoff_instruction(message)
    if not phone or not instruction:
        print("ignored handoff: unsupported or invalid vlog intent", flush=True)
        return 0
    run_id = hashlib.sha256(message.encode()).hexdigest()[:12]
    date = datetime.now().astimezone().date().isoformat()
    run_root = ROOT / "runs" / "neo-vlog" / f"{date}-{run_id}"
    run_root.mkdir(parents=True, exist_ok=True)
    final = run_root / "report.md"
    command = [
        "codex", "exec", "--model", "gpt-6-astra",
        "--dangerously-bypass-approvals-and-sandbox",
        "--cd", str(ROOT), "--output-last-message", str(final), prompt(phone, run_id, instruction),
    ]
    print(f"starting daily-vlog producer {run_id}", flush=True)
    return subprocess.run(command, cwd=ROOT).returncode


def main() -> int:
    while True:
        message = peek()
        if message and endpoint(message):
            claimed = consume()
            if claimed and endpoint(claimed):
                run(claimed)
        elif message:
            # This bridge is shared with other NeoX handoffs. Leave theirs queued.
            time.sleep(10)
        else:
            time.sleep(2)


if __name__ == "__main__":
    sys.exit(main())
