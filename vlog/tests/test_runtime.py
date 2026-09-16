import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from neo_vlog import Runtime, WorkflowError
from neo_vlog.runtime import load_config


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config" / "routing.json"


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.db = self.root / "state.sqlite"
        self.runtime = Runtime(self.db, CONFIG)
        self.runtime.init()
        self.media = self.root / "media"
        self.media.mkdir()

    def ingest(self):
        return self.runtime.ingest_event("arrival-1", "neo", {"media_path": str(self.media)})

    def job(self, stage):
        return next(job for job in self.runtime.status()["jobs"] if job["stage"] == stage)

    def complete(self, stage, artifact=None):
        job = self.job(stage)
        claim = self.runtime.claim(job["id"])
        return self.runtime.complete(job["id"], claim["token"], artifact or {"stage": stage})

    def test_restart_idempotency_and_plan_context(self):
        first = self.ingest()
        second = self.ingest()
        self.assertFalse(first["idempotent"])
        self.assertTrue(second["idempotent"])
        restarted = Runtime(self.db, CONFIG)
        status = restarted.status()
        self.assertEqual(status["counts"]["events"], 1)
        self.assertEqual(status["counts"]["episodes"], 1)
        plan = restarted.plans()[0]
        self.assertEqual(plan["context"]["event"]["payload"]["media_path"], str(self.media))
        self.assertEqual(plan["plan"]["owner"], "codex-media-analyst")
        with self.assertRaises(WorkflowError):
            restarted.ingest_event("arrival-1", "other", {})

    def test_gate_revision_file_hash_and_render_revalidation(self):
        episode = self.ingest()["episode"]["id"]
        self.complete("analyze")
        self.complete("story")
        storyboard = self.root / "story.md"
        storyboard.write_text("revision one")
        first = self.complete("storyboard_review", {"files": [{"path": str(storyboard)}]})
        gate_job = self.job("storyboard_review")

        self.runtime.retry(gate_job["id"])
        with self.assertRaises(WorkflowError):
            self.runtime.approve(episode, "storyboard_review", 1, first["sha256"], "reviewer")

        storyboard.write_text("revision two")
        second = self.complete("storyboard_review", {"files": [{"path": str(storyboard)}]})
        self.assertEqual(second["revision"], 2)
        with self.assertRaises(WorkflowError):
            self.runtime.approve(episode, "storyboard_review", 1, first["sha256"], "reviewer")

        storyboard.write_text("changed after completion")
        with self.assertRaises(WorkflowError):
            self.runtime.approve(episode, "storyboard_review", 2, second["sha256"], "reviewer")
        storyboard.write_text("revision two")
        self.runtime.approve(episode, "storyboard_review", 2, second["sha256"], "reviewer")

        storyboard.write_text("changed after approval")
        with self.assertRaises(WorkflowError):
            self.runtime.claim(self.job("render")["id"])
        storyboard.write_text("revision two")
        render_claim = self.runtime.claim(self.job("render")["id"])
        self.runtime.complete(render_claim["id"], render_claim["token"], {"rendered": True})

        final_file = self.root / "final.mp4"
        final_file.write_bytes(b"video bytes")
        final = self.complete("final_review", {"files": [{"path": str(final_file)}]})
        self.runtime.approve(episode, "final_review", final["revision"], final["sha256"], "reviewer")
        self.assertEqual(self.runtime.status()["episodes"][0]["stage"], "ready")

    def test_interrupted_recovery_and_three_attempt_bound(self):
        self.ingest()
        job_id = self.job("analyze")["id"]
        self.runtime.claim(job_id)
        restarted = Runtime(self.db, CONFIG)
        self.assertEqual(restarted.recover_interrupted(force=True), [job_id])
        for expected_attempt in (2, 3):
            claim = restarted.claim(job_id)
            result = restarted.fail(job_id, claim["token"], "worker failed")
            self.assertEqual(result["attempts"], expected_attempt)
            if expected_attempt < 3:
                restarted.retry(job_id)
        with self.assertRaises(WorkflowError):
            restarted.retry(job_id)

    def test_config_limit_and_cli_plan(self):
        bad = self.root / "bad.json"
        bad.write_text(json.dumps({"max_attempts": 4}))
        with self.assertRaises(WorkflowError):
            load_config(bad)

        cli_db = self.root / "cli.sqlite"
        env = os.environ | {"PYTHONPATH": str(ROOT / "src")}
        base = [sys.executable, "-m", "neo_vlog", "--db", str(cli_db), "--config", str(CONFIG)]
        subprocess.run(base + ["init"], cwd=ROOT, env=env, check=True, capture_output=True, text=True)
        subprocess.run(
            base + ["event", "--key", "cli-1", "--series", "neo", "--payload", '{"media_path":"assets"}'],
            cwd=ROOT,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )
        planned = subprocess.run(base + ["run"], cwd=ROOT, env=env, check=True, capture_output=True, text=True)
        output = json.loads(planned.stdout)
        self.assertFalse(output["dispatched"])
        self.assertEqual(output["jobs"][0]["context"]["event"]["payload"]["media_path"], "assets")


if __name__ == "__main__":
    unittest.main()
