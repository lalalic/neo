from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
SCRIPT = PROJECT / "scripts" / "clippers.py"

spec = importlib.util.spec_from_file_location("clippers", SCRIPT)
clippers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clippers)


def example(name: str) -> dict:
    return json.loads((PROJECT / "examples" / name).read_text(encoding="utf-8"))


def build_run(workdir: Path) -> Path:
    run = workdir / "2026-09-17-test"
    (run / "state").mkdir(parents=True)
    (run / "inputs").mkdir()
    (run / "evidence").mkdir()
    (run / "candidates").mkdir()
    (run / "selection").mkdir()
    (run / "qa").mkdir()
    (run / "specs").mkdir()
    (run / "inputs" / "source-authorization.json").write_text(json.dumps(example("source-authorization-v1.json")))
    (run / "evidence" / "source-research.json").write_text(json.dumps(example("source-research-v1.json")))
    (run / "evidence" / "transcript.json").write_text(json.dumps(example("transcript-evidence-v1.json")))
    (run / "candidates" / "candidate.json").write_text(json.dumps(example("candidate-moment-evidence-v1.json")))
    candidates = {
        "schema_version": 1,
        "source_id": "authorized_example_source",
        "candidates": [example("candidate-moment-evidence-v1.json")],
    }
    (run / "candidates" / "candidates.json").write_text(json.dumps(candidates))
    (run / "selection" / "ranked-selection.json").write_text(json.dumps(example("ranked-selection-v1.json")))
    (run / "qa" / "qa.json").write_text(json.dumps(example("qa-decision-v1.json")))
    state = example("run-state-v1.json")
    state["artifacts"] = {
        "authorization": "inputs/source-authorization.json",
        "research": "evidence/source-research.json",
        "transcript": "evidence/transcript.json",
        "candidates": "candidates/candidates.json",
        "selection": "selection/ranked-selection.json",
        "qa": "qa/qa.json",
    }
    state["state"] = "qa_passed"
    (run / "state" / "run-state.json").write_text(json.dumps(state))
    return run


class ContractTests(unittest.TestCase):
    def test_examples_pass(self) -> None:
        cases = {
            "authorization": "source-authorization-v1.json",
            "research": "source-research-v1.json",
            "transcript": "transcript-evidence-v1.json",
            "candidate": "candidate-moment-evidence-v1.json",
            "ranked": "ranked-selection-v1.json",
            "qa": "qa-decision-v1.json",
            "run-state": "run-state-v1.json",
        }
        for kind, name in cases.items():
            with self.subTest(kind=kind):
                clippers.validate_artifact(kind, PROJECT / "examples" / name)

    def test_validator_reads_rubric_as_data(self) -> None:
        self.assertEqual(
            clippers.rubric_criteria(),
            {
                "hook_first_two_seconds": 0.28,
                "narrative_payoff": 0.24,
                "attention_intensity": 0.18,
                "visual_audio_support": 0.14,
                "platform_fit": 0.10,
                "accessibility": 0.06,
            },
        )

    def test_rejects_authorization_without_clip_creation(self) -> None:
        value = example("source-authorization-v1.json")
        value["scope"]["clip_creation"] = False
        with self.assertRaisesRegex(clippers.ValidationError, "clip_creation"):
            clippers.validate_authorization(value)

    def test_rejects_malformed_candidate_timestamp(self) -> None:
        value = example("candidate-moment-evidence-v1.json")
        value["end_ms"] = value["start_ms"]
        with self.assertRaisesRegex(clippers.ValidationError, "end_ms after start_ms"):
            clippers.validate_candidate(value)

    def test_rejects_candidate_without_media_evidence(self) -> None:
        value = example("candidate-moment-evidence-v1.json")
        value["evidence"] = value["evidence"][:1]
        with self.assertRaisesRegex(clippers.ValidationError, "media, visual, or audio"):
            clippers.validate_candidate(value)

    def test_rejects_excluded_candidate_from_ranking(self) -> None:
        selection = example("ranked-selection-v1.json")
        candidate = example("candidate-moment-evidence-v1.json")
        candidate["status"] = "excluded"
        with self.assertRaisesRegex(clippers.ValidationError, "not eligible"):
            clippers.validate_ranked(selection, {"candidate_example_001": candidate})

    def test_status_passes_qa_without_markcut_spec(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run = build_run(Path(directory))
            state = clippers.validate_run(run)
            self.assertEqual(state["state"], "qa_passed")

    def test_status_keeps_failed_qa_not_ready(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run = build_run(Path(directory))
            state_path = run / "state" / "run-state.json"
            state = json.loads(state_path.read_text(encoding="utf-8"))
            state["state"] = "qa_failed"
            qa = example("qa-decision-v1.json")
            qa.update({
                "decision": "fail",
                "checks": [{"id": "editorial_coherence", "result": "fail", "evidence": "Hook does not match the selected interval."}],
                "blockers": ["Hook does not match the selected interval."],
            })
            (run / "qa" / "qa.json").write_text(json.dumps(qa))
            state_path.write_text(json.dumps(state))
            result = clippers.validate_run(run)
            self.assertEqual(result["state"], "qa_failed")
            self.assertFalse((run / "specs" / "markcut.md").exists())

    def test_command_line_status(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run = build_run(Path(directory))
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "status", str(run)],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertIn("OK qa_passed", result.stdout)


if __name__ == "__main__":
    unittest.main()
