from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


STAGES = ("ingest", "analyze", "story", "storyboard_review", "render", "final_review", "ready")
JOB_STAGES = STAGES[1:-1]
GATES = {"storyboard_review": "render", "final_review": "ready"}

DEFAULT_CONFIG: dict[str, Any] = {
    "max_attempts": 3,
    "lease_seconds": 900,
    "profiles": {
        "markcut_vision": {
            "owner": "markcut",
            "model": "vision-default",
            "command": ["npx", "@lalalic/markcut", "vision", "{media_path}"],
        },
        "codex_story": {
            "owner": "codex-producer",
            "model": "story-default",
            "command": ["codex-producer", "consume", "{job_id}"],
        },
        "markcut_storyboard": {
            "owner": "markcut",
            "model": "generation-default",
            "command": ["npx", "@lalalic/markcut", "preview", "{storyboard_path}", "--storyboard"],
        },
        "markcut_render": {
            "owner": "markcut",
            "model": "render-default",
            "command": ["npx", "@lalalic/markcut", "render", "{storyboard_path}"],
        },
        "codex_review": {
            "owner": "codex-producer",
            "model": "review-default",
            "command": ["codex-producer", "review", "{job_id}"],
        },
    },
    "routes": {
        "analyze": "markcut_vision",
        "story": "codex_story",
        "storyboard_review": "markcut_storyboard",
        "render": "markcut_render",
        "final_review": "codex_review",
    },
}


class WorkflowError(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _hash(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


def _id(prefix: str, value: str) -> str:
    return f"{prefix}_{hashlib.sha256(value.encode()).hexdigest()[:16]}"


def _artifact(artifact: Any, *, require_files: bool) -> tuple[dict[str, Any], str]:
    if not isinstance(artifact, dict):
        raise WorkflowError("artifact must be a JSON object")
    normalized = json.loads(_canonical(artifact))
    files = normalized.get("files", [])
    if not isinstance(files, list) or (require_files and not files):
        raise WorkflowError("review artifacts require a non-empty files array")
    checked = []
    for item in files:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise WorkflowError("each artifact file requires a path")
        path = Path(item["path"]).expanduser().resolve()
        if not path.is_file():
            raise WorkflowError(f"artifact file does not exist: {path}")
        with path.open("rb") as media_file:
            hasher = hashlib.sha256()
            for chunk in iter(lambda: media_file.read(1024 * 1024), b""):
                hasher.update(chunk)
            digest = hasher.hexdigest()
        if item.get("sha256") and not secrets.compare_digest(item["sha256"], digest):
            raise WorkflowError(f"artifact file hash does not match: {path}")
        checked.append(item | {"path": str(path), "sha256": digest, "size": path.stat().st_size})
    if files:
        normalized["files"] = checked
    return normalized, _hash(normalized)


def _revalidate_artifact(row: sqlite3.Row) -> dict[str, Any]:
    content = json.loads(row["content_json"])
    normalized, digest = _artifact(content, require_files=True)
    if not secrets.compare_digest(digest, row["sha256"]):
        raise WorkflowError("artifact content or referenced file bytes changed after completion")
    return normalized


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    config = json.loads(_canonical(DEFAULT_CONFIG))
    if path:
        supplied = json.loads(Path(path).read_text())
        if not isinstance(supplied, dict):
            raise WorkflowError("config must be a JSON object")
        config.update({k: v for k, v in supplied.items() if k not in {"profiles", "routes"}})
        config["profiles"].update(supplied.get("profiles", {}))
        config["routes"].update(supplied.get("routes", {}))
    if not isinstance(config.get("max_attempts"), int) or not 1 <= config["max_attempts"] <= 3:
        raise WorkflowError("max_attempts must be an integer from 1 through 3")
    if not isinstance(config.get("lease_seconds"), int) or config["lease_seconds"] < 1:
        raise WorkflowError("lease_seconds must be a positive integer")
    for stage in JOB_STAGES:
        profile_name = config["routes"].get(stage)
        profile = config["profiles"].get(profile_name)
        if not profile or not all(key in profile for key in ("owner", "model", "command")):
            raise WorkflowError(f"route {stage!r} must name a profile with owner, model, and command")
        if profile["command"] is not None and (
            not isinstance(profile["command"], list) or not all(isinstance(x, str) for x in profile["command"])
        ):
            raise WorkflowError(f"profile {profile_name!r} command must be null or a JSON string array")
    return config


SCHEMA = """
CREATE TABLE IF NOT EXISTS series (
  key TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, event_key TEXT UNIQUE NOT NULL, series_key TEXT NOT NULL REFERENCES series(key),
  kind TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY, event_id TEXT UNIQUE NOT NULL REFERENCES events(id), series_key TEXT NOT NULL REFERENCES series(key),
  title TEXT NOT NULL, stage TEXT NOT NULL CHECK(stage IN ('ingest','analyze','story','storyboard_review','render','final_review','ready')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, episode_id TEXT NOT NULL REFERENCES episodes(id), stage TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 3),
  plan_json TEXT NOT NULL, claim_token TEXT, lease_expires_at TEXT, artifact_revision INTEGER,
  last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(episode_id, stage)
);
CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, episode_id TEXT NOT NULL REFERENCES episodes(id), stage TEXT NOT NULL,
  revision INTEGER NOT NULL, sha256 TEXT NOT NULL, content_json TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(episode_id, stage, revision)
);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, artifact_id INTEGER UNIQUE NOT NULL REFERENCES artifacts(id),
  episode_id TEXT NOT NULL REFERENCES episodes(id), stage TEXT NOT NULL, revision INTEGER NOT NULL,
  artifact_sha256 TEXT NOT NULL, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
  UNIQUE(episode_id, stage, revision)
);
"""


class Runtime:
    def __init__(self, db_path: str | Path, config_path: str | Path | None = None):
        self.db_path = Path(db_path)
        self.config = load_config(config_path)

    def _connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(self.db_path, timeout=10)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys=ON")
        con.execute("PRAGMA journal_mode=WAL")
        return con

    def init(self) -> dict[str, Any]:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as con:
            con.executescript(SCHEMA)
        return {
            "database": str(self.db_path.resolve()),
            "event_semantics": "event records intake metadata only; media files are not imported",
            "config": self.config,
        }

    def _ready(self) -> sqlite3.Connection:
        if not self.db_path.exists():
            raise WorkflowError(f"database does not exist: {self.db_path}; run init first")
        return self._connect()

    def _plan(self, episode_id: str, stage: str) -> dict[str, Any]:
        profile_name = self.config["routes"][stage]
        profile = self.config["profiles"][profile_name]
        return {
            "schema": "neo-vlog.job-plan/v1",
            "mode": "plan-only",
            "episode_id": episode_id,
            "stage": stage,
            "profile": profile_name,
            "owner": profile["owner"],
            "model": profile["model"],
            "command": profile["command"],
            "dispatch": False,
        }

    def _enqueue(self, con: sqlite3.Connection, episode_id: str, stage: str) -> None:
        now = _now()
        job_id = _id("job", f"{episode_id}:{stage}")
        plan = self._plan(episode_id, stage) | {"job_id": job_id}
        con.execute(
            "INSERT OR IGNORE INTO jobs(id,episode_id,stage,status,attempts,max_attempts,plan_json,created_at,updated_at) "
            "VALUES(?,?,?,'queued',0,?,?,?,?)",
            (job_id, episode_id, stage, self.config["max_attempts"], _canonical(plan), now, now),
        )

    def ingest_event(
        self,
        event_key: str,
        series_key: str,
        payload: Any,
        *,
        kind: str = "media.added",
        title: str | None = None,
        series_title: str | None = None,
    ) -> dict[str, Any]:
        if not event_key.strip() or not series_key.strip():
            raise WorkflowError("event key and series key are required")
        payload_json = _canonical(payload)
        event_id, episode_id = _id("evt", event_key), _id("ep", event_key)
        now = _now()
        with self._ready() as con:
            con.execute("BEGIN IMMEDIATE")
            old = con.execute("SELECT * FROM events WHERE event_key=?", (event_key,)).fetchone()
            if old:
                if (old["series_key"], old["kind"], old["payload_json"]) != (series_key, kind, payload_json):
                    raise WorkflowError(f"event key {event_key!r} already exists with different content")
                episode = con.execute("SELECT * FROM episodes WHERE event_id=?", (old["id"],)).fetchone()
                return {"idempotent": True, "event_id": old["id"], "episode": dict(episode)}
            con.execute(
                "INSERT OR IGNORE INTO series(key,title,created_at) VALUES(?,?,?)",
                (series_key, series_title or series_key, now),
            )
            con.execute(
                "INSERT INTO events(id,event_key,series_key,kind,payload_json,created_at) VALUES(?,?,?,?,?,?)",
                (event_id, event_key, series_key, kind, payload_json, now),
            )
            con.execute(
                "INSERT INTO episodes(id,event_id,series_key,title,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                (episode_id, event_id, series_key, title or event_key, "ingest", now, now),
            )
            self._enqueue(con, episode_id, "analyze")
            episode = con.execute("SELECT * FROM episodes WHERE id=?", (episode_id,)).fetchone()
        return {"idempotent": False, "event_id": event_id, "episode": dict(episode)}

    def status(self) -> dict[str, Any]:
        with self._ready() as con:
            counts = {
                table: con.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
                for table in ("series", "events", "episodes", "jobs", "artifacts", "approvals")
            }
            episodes = [dict(row) for row in con.execute("SELECT * FROM episodes ORDER BY created_at,id")]
            events = [dict(row) | {"payload": json.loads(row["payload_json"])} for row in con.execute("SELECT * FROM events ORDER BY created_at,id")]
            artifacts = [dict(row) | {"content": json.loads(row["content_json"])} for row in con.execute("SELECT * FROM artifacts ORDER BY episode_id,stage,revision")]
            jobs = [self._job_view(con, row) for row in con.execute("SELECT * FROM jobs ORDER BY created_at,id")]
            for event in events:
                del event["payload_json"]
            for artifact in artifacts:
                del artifact["content_json"]
        return {"counts": counts, "events": events, "episodes": episodes, "jobs": jobs, "artifacts": artifacts}

    def _job_view(self, con: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
        event = con.execute(
            "SELECT e.* FROM events e JOIN episodes ep ON ep.event_id=e.id WHERE ep.id=?", (row["episode_id"],)
        ).fetchone()
        artifacts = con.execute(
            "SELECT a.* FROM artifacts a WHERE a.episode_id=? AND a.revision=(SELECT max(b.revision) FROM artifacts b WHERE b.episode_id=a.episode_id AND b.stage=a.stage) ORDER BY a.stage",
            (row["episode_id"],),
        ).fetchall()
        result = dict(row)
        result["plan"] = json.loads(result.pop("plan_json"))
        result["context"] = {
            "event": dict(event) | {"payload": json.loads(event["payload_json"])},
            "latest_artifacts": [dict(item) | {"content": json.loads(item["content_json"])} for item in artifacts],
        }
        del result["context"]["event"]["payload_json"]
        for item in result["context"]["latest_artifacts"]:
            del item["content_json"]
        return result

    def plans(self) -> list[dict[str, Any]]:
        with self._ready() as con:
            rows = con.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at,id").fetchall()
            return [self._job_view(con, row) for row in rows]

    def recover_interrupted(self, *, force: bool = False) -> list[str]:
        now = _now()
        recovered: list[str] = []
        with self._ready() as con:
            con.execute("BEGIN IMMEDIATE")
            rows = con.execute("SELECT * FROM jobs WHERE status='running'").fetchall()
            for row in rows:
                if not force and row["lease_expires_at"] and row["lease_expires_at"] > now:
                    continue
                status = "queued" if row["attempts"] < row["max_attempts"] else "failed"
                con.execute(
                    "UPDATE jobs SET status=?,claim_token=NULL,lease_expires_at=NULL,last_error=?,updated_at=? WHERE id=?",
                    (status, "interrupted claim recovered", now, row["id"]),
                )
                recovered.append(row["id"])
        return recovered

    def claim(self, job_id: str | None = None) -> dict[str, Any]:
        self.recover_interrupted()
        with self._ready() as con:
            con.execute("BEGIN IMMEDIATE")
            if job_id:
                row = con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            else:
                row = con.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1").fetchone()
            if not row:
                raise WorkflowError("no matching job")
            if row["status"] != "queued":
                raise WorkflowError(f"job {row['id']} is {row['status']}, not queued")
            if row["attempts"] >= row["max_attempts"]:
                raise WorkflowError(f"job {row['id']} exhausted its {row['max_attempts']} attempts")
            if row["stage"] == "render":
                approved = con.execute(
                    "SELECT a.* FROM approvals p JOIN artifacts a ON a.id=p.artifact_id "
                    "WHERE p.episode_id=? AND p.stage='storyboard_review' ORDER BY p.revision DESC LIMIT 1",
                    (row["episode_id"],),
                ).fetchone()
                if not approved:
                    raise WorkflowError("render requires an approved storyboard revision")
                _revalidate_artifact(approved)
            token = secrets.token_urlsafe(18)
            lease = (datetime.now(timezone.utc) + timedelta(seconds=self.config["lease_seconds"])).isoformat(timespec="seconds")
            now = _now()
            con.execute(
                "UPDATE jobs SET status='running',attempts=attempts+1,claim_token=?,lease_expires_at=?,last_error=NULL,updated_at=? WHERE id=?",
                (token, lease, now, row["id"]),
            )
            claimed = con.execute("SELECT * FROM jobs WHERE id=?", (row["id"],)).fetchone()
            result = self._job_view(con, claimed) | {"token": token}
        return result

    def _running(self, con: sqlite3.Connection, job_id: str, token: str) -> sqlite3.Row:
        row = con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row:
            raise WorkflowError(f"unknown job {job_id}")
        if row["status"] != "running" or not secrets.compare_digest(row["claim_token"] or "", token):
            raise WorkflowError("job is not running or claim token is stale")
        return row

    def fail(self, job_id: str, token: str, error: str) -> dict[str, Any]:
        with self._ready() as con:
            con.execute("BEGIN IMMEDIATE")
            row = self._running(con, job_id, token)
            now = _now()
            con.execute(
                "UPDATE jobs SET status='failed',claim_token=NULL,lease_expires_at=NULL,last_error=?,updated_at=? WHERE id=?",
                (error, now, job_id),
            )
        return {
            "job_id": job_id,
            "status": "failed",
            "attempts": row["attempts"],
            "retryable": row["attempts"] < row["max_attempts"],
        }

    def complete(self, job_id: str, token: str, artifact: Any) -> dict[str, Any]:
        with self._ready() as con:
            con.execute("BEGIN IMMEDIATE")
            job = self._running(con, job_id, token)
            normalized, digest = _artifact(artifact, require_files=job["stage"] in GATES)
            content = _canonical(normalized)
            episode = con.execute("SELECT * FROM episodes WHERE id=?", (job["episode_id"],)).fetchone()
            expected = {
                "analyze": "ingest",
                "story": "analyze",
                "storyboard_review": "story",
                "render": "render",
                "final_review": "render",
            }[job["stage"]]
            valid_stages = {expected, job["stage"]} if job["stage"] in GATES else {expected}
            if episode["stage"] not in valid_stages:
                raise WorkflowError(f"episode is at {episode['stage']}, expected {expected}")
            revision = con.execute(
                "SELECT coalesce(max(revision),0)+1 FROM artifacts WHERE episode_id=? AND stage=?",
                (job["episode_id"], job["stage"]),
            ).fetchone()[0]
            now = _now()
            con.execute(
                "INSERT INTO artifacts(episode_id,stage,revision,sha256,content_json,created_at) VALUES(?,?,?,?,?,?)",
                (job["episode_id"], job["stage"], revision, digest, content, now),
            )
            con.execute(
                "UPDATE jobs SET status='succeeded',claim_token=NULL,lease_expires_at=NULL,artifact_revision=?,updated_at=? WHERE id=?",
                (revision, now, job_id),
            )
            con.execute("UPDATE episodes SET stage=?,updated_at=? WHERE id=?", (job["stage"], now, job["episode_id"]))
            next_stage = {"analyze": "story", "story": "storyboard_review", "render": "final_review"}.get(job["stage"])
            if next_stage:
                self._enqueue(con, job["episode_id"], next_stage)
        return {
            "job_id": job_id,
            "episode_id": job["episode_id"],
            "stage": job["stage"],
            "revision": revision,
            "sha256": digest,
            "gate_required": job["stage"] in GATES,
        }

    def approve(self, episode_id: str, stage: str, revision: int, sha256: str, approved_by: str) -> dict[str, Any]:
        if stage not in GATES:
            raise WorkflowError(f"{stage} is not an approval gate")
        with self._ready() as con:
            con.execute("BEGIN IMMEDIATE")
            artifact = con.execute(
                "SELECT * FROM artifacts WHERE episode_id=? AND stage=? AND revision=?",
                (episode_id, stage, revision),
            ).fetchone()
            if not artifact or not secrets.compare_digest(artifact["sha256"], sha256):
                raise WorkflowError("artifact revision or hash does not match")
            _revalidate_artifact(artifact)
            old = con.execute("SELECT * FROM approvals WHERE artifact_id=?", (artifact["id"],)).fetchone()
            if old:
                return {"idempotent": True, "approval": dict(old)}
            episode = con.execute("SELECT * FROM episodes WHERE id=?", (episode_id,)).fetchone()
            job = con.execute("SELECT * FROM jobs WHERE episode_id=? AND stage=?", (episode_id, stage)).fetchone()
            if not episode or episode["stage"] != stage or not job or job["status"] != "succeeded" or job["artifact_revision"] != revision:
                raise WorkflowError("approval must target the currently succeeded revision at the episode's gate")
            now = _now()
            con.execute(
                "INSERT INTO approvals(artifact_id,episode_id,stage,revision,artifact_sha256,approved_by,approved_at) VALUES(?,?,?,?,?,?,?)",
                (artifact["id"], episode_id, stage, revision, sha256, approved_by, now),
            )
            next_stage = GATES[stage]
            con.execute("UPDATE episodes SET stage=?,updated_at=? WHERE id=?", (next_stage, now, episode_id))
            if next_stage != "ready":
                self._enqueue(con, episode_id, next_stage)
            approval = con.execute("SELECT * FROM approvals WHERE artifact_id=?", (artifact["id"],)).fetchone()
        return {"idempotent": False, "next_stage": next_stage, "approval": dict(approval)}

    def retry(self, job_id: str) -> dict[str, Any]:
        with self._ready() as con:
            con.execute("BEGIN IMMEDIATE")
            job = con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not job:
                raise WorkflowError(f"unknown job {job_id}")
            episode = con.execute("SELECT * FROM episodes WHERE id=?", (job["episode_id"],)).fetchone()
            allowed = job["status"] == "failed" or (
                job["status"] == "succeeded" and job["stage"] in GATES and episode["stage"] == job["stage"]
            )
            if not allowed:
                raise WorkflowError("only failed jobs or an unapproved current gate revision can be retried")
            if job["attempts"] >= job["max_attempts"]:
                raise WorkflowError(f"job {job_id} exhausted its {job['max_attempts']} attempts")
            now = _now()
            con.execute(
                "UPDATE jobs SET status='queued',claim_token=NULL,lease_expires_at=NULL,artifact_revision=NULL,last_error=NULL,updated_at=? WHERE id=?",
                (now, job_id),
            )
        return {
            "job_id": job_id,
            "status": "queued",
            "attempts_remaining": job["max_attempts"] - job["attempts"],
        }
