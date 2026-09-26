from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from typing import Any

from .runtime import Runtime, WorkflowError


def _json(value: str, label: str) -> Any:
    try:
        return json.loads(value)
    except json.JSONDecodeError as exc:
        raise WorkflowError(f"{label} must be valid JSON: {exc.msg}") from exc


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="python -m neo_vlog", description="Offline vlog workflow; emits plans only.")
    root.add_argument("--db", default=f"runs/{date.today().isoformat()}-local/state/vlog.sqlite", help="run-local SQLite state path")
    root.add_argument("--config", help="optional JSON routing configuration")
    commands = root.add_subparsers(dest="command", required=True)

    commands.add_parser("init", help="initialize the database and print effective config")
    commands.add_parser("status", help="show persisted episodes and jobs")

    event = commands.add_parser(
        "event",
        help="record event intake metadata; does not import media",
        description="Record event intake metadata idempotently. This does not copy or import media files.",
    )
    event.add_argument("--key", required=True)
    event.add_argument("--series", required=True)
    event.add_argument("--series-title")
    event.add_argument("--title")
    event.add_argument("--kind", default="media.added")
    event.add_argument("--payload", default="{}", help="JSON event payload")

    run = commands.add_parser("run", help="print plans, or record producer job lifecycle")
    action = run.add_mutually_exclusive_group()
    action.add_argument("--claim", metavar="JOB_ID")
    action.add_argument("--complete", metavar="JOB_ID")
    action.add_argument("--fail", metavar="JOB_ID")
    run.add_argument("--token", help="claim token returned by --claim")
    run.add_argument("--artifact", help="JSON artifact content for --complete")
    run.add_argument("--error", help="failure text for --fail")

    approve = commands.add_parser("approve", help="approve an exact artifact revision and content hash")
    approve.add_argument("episode_id")
    approve.add_argument("--stage", choices=("storyboard_review", "final_review"), required=True)
    approve.add_argument("--revision", type=int, required=True)
    approve.add_argument("--hash", dest="sha256", required=True)
    approve.add_argument("--by", dest="approved_by", required=True)

    retry = commands.add_parser("retry", help="requeue a retryable failure or unapproved gate revision")
    retry.add_argument("job_id")
    return root


def execute(args: argparse.Namespace) -> Any:
    runtime = Runtime(args.db, args.config)
    if args.command == "init":
        return runtime.init()
    if args.command == "status":
        return runtime.status()
    if args.command == "event":
        return runtime.ingest_event(
            args.key,
            args.series,
            _json(args.payload, "payload"),
            kind=args.kind,
            title=args.title,
            series_title=args.series_title,
        )
    if args.command == "retry":
        return runtime.retry(args.job_id)
    if args.command == "approve":
        return runtime.approve(args.episode_id, args.stage, args.revision, args.sha256, args.approved_by)
    if not any((args.claim, args.complete, args.fail)):
        return {"mode": "plan-only", "dispatched": False, "jobs": runtime.plans()}
    if args.claim:
        return runtime.claim(args.claim)
    if args.complete:
        if not args.token or args.artifact is None:
            raise WorkflowError("--complete requires --token and --artifact JSON")
        return runtime.complete(args.complete, args.token, _json(args.artifact, "artifact"))
    if not args.token or not args.error:
        raise WorkflowError("--fail requires --token and --error")
    return runtime.fail(args.fail, args.token, args.error)


def main(argv: list[str] | None = None) -> int:
    try:
        result = execute(parser().parse_args(argv))
        print(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False))
        return 0
    except (WorkflowError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2
