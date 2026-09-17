from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
SCRIPT = PROJECT / "scripts" / "clippers.py"
spec = importlib.util.spec_from_file_location("clippers", SCRIPT)
clippers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clippers)


def example(name: str) -> dict:
    return json.loads((PROJECT / "examples" / name).read_text(encoding="utf-8"))


def write(path: Path, value: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def candidate(candidate_id: str) -> dict:
    value = example("text-candidate-v1.json")
    value["candidate_id"] = candidate_id
    return value


def vision(candidate_id: str) -> dict:
    value = example("vision-editorial-understanding-v1.json")
    value["vision_id"] = f"vision_{candidate_id}"
    value["candidate_id"] = candidate_id
    return value


def judge_entry(candidate_id: str, index: int) -> dict:
    entry = example("editorial-judge-v1.json")["entries"][0]
    entry["entry_id"] = f"entry_{index:03d}"
    entry["candidate_id"] = candidate_id
    entry["vision_artifact"] = "vision/reviews.json"
    return entry


def history_through(state: str) -> list[dict]:
    order = [
        "initiated", "source_authorized", "media_preflight", "transcript_extracted",
        "text_candidates_extracted", "vision_reviewed", "judge_ranked", "variants_planned",
    ]
    if state == "qa_failed":
        order.append("qa_failed")
    elif state in {"qa_passed", "markcut_ready"}:
        order.append("qa_passed")
    if state == "markcut_ready":
        order.append("markcut_ready")
    return [
        {"state": item, "at": "2026-09-17T09:00:00-04:00", "actor": "run-controller"}
        for item in order
    ]


def build_run(workdir: Path, candidate_count: int = 5, state: str = "qa_passed", with_markcut: bool = True) -> Path:
    run = workdir / "2026-09-17-fixture"
    for directory in ("inputs", "media", "evidence", "candidates", "vision", "campaign", "selection", "variants", "qa", "markcut", "state"):
        (run / directory).mkdir(parents=True)

    authorization = example("source-authorization-v1.json")
    authorization["authorization_evidence"]["reference"] = "inputs/permission.txt"
    (run / "inputs" / "permission.txt").write_text("explicit written permission", encoding="utf-8")
    write(run / "inputs" / "authorization.json", authorization)
    write(run / "evidence" / "research.json", example("source-research-v1.json"))
    media = example("media-preflight-v1.json")
    media.update({
        "normalized_media": "media/source.mp4",
        "frame_index": {"keyframes_artifact": "media/keyframes.json", "thumbnails_artifact": "media/thumbs/", "cadence_ms": 1000},
    })
    (run / "media" / "source.mp4").write_bytes(b"fixture media")
    write(run / "media" / "keyframes.json", {"fixture": True})
    write(run / "media" / "preflight.json", media)
    transcript = example("transcript-evidence-v1.json")
    transcript["artifact"] = "evidence/transcript.json"
    write(run / "evidence" / "transcript.json", transcript)
    candidates = [candidate(f"candidate_{index:03d}") for index in range(1, candidate_count + 1)]
    for item in candidates:
        item["evidence"][0]["artifact"] = "evidence/transcript.json"
    write(run / "candidates" / "candidates.json", {
        "schema_version": 1,
        "source_id": "authorized_example_source",
        "stage": "text_first",
        "candidates": candidates,
    })
    reviews = [vision(item["candidate_id"]) for item in candidates]
    for review in reviews:
        review["key_quote"]["artifact"] = "evidence/transcript.json"
        review["evidence"][0]["artifact"] = "media/keyframes.json"
    write(run / "vision" / "reviews.json", {"schema_version": 1, "reviews": reviews})
    campaign = example("campaign-brief-v1.json")
    write(run / "campaign" / "brief.json", campaign)
    entries = [judge_entry(item["candidate_id"], index) for index, item in enumerate(candidates, 1)]
    judge = example("editorial-judge-v1.json")
    judge["campaign_brief_artifact"] = "campaign/brief.json"
    judge["transcript_artifact"] = "evidence/transcript.json"
    judge["entries"] = entries
    write(run / "selection" / "judge.json", judge)
    rankings = []
    for index, entry in enumerate(entries, 1):
        rankings.append({
            "rank": index,
            "candidate_id": entry["candidate_id"],
            "judge_entry_id": entry["entry_id"],
            "vision_artifact": "vision/reviews.json",
            "status": "eligible",
            "weighted_score": clippers.weighted_score(entry["scores"]),
        })
    rankings.sort(key=lambda item: (-item["weighted_score"], item["candidate_id"]))
    for rank, ranking in enumerate(rankings, 1):
        ranking["rank"] = rank
    write(run / "selection" / "selection.json", {
        "schema_version": 2,
        "selection_id": "selection_2026_09_17_example",
        "source_id": "authorized_example_source",
        "platform": "youtube_shorts",
        "rubric_id": "clippers-rubric-v1",
        "rubric_version": 2,
        "judge_artifact": "selection/judge.json",
        "rankings": rankings,
    })
    variants = example("variant-plan-v1.json")["variants"]
    selected_ids = [item["candidate_id"] for item in rankings]
    for index, variant in enumerate(variants):
        variant["candidate_id"] = selected_ids[min(index, len(selected_ids) - 1)]
    write(run / "variants" / "variants.json", {
        "schema_version": 1,
        "plan_id": "variants_2026_09_17_example",
        "source_id": "authorized_example_source",
        "selection_id": "selection_2026_09_17_example",
        "variants": variants,
    })
    qa_template = example("qa-decisions-v1.json")["decisions"][0]
    qa_decisions = []
    for variant in variants:
        decision = copy.deepcopy(qa_template)
        decision["qa_id"] = f"qa_{variant['variant_id']}"
        decision["variant_id"] = variant["variant_id"]
        decision["candidate_id"] = variant["candidate_id"]
        qa_decisions.append(decision)
    qa = example("qa-decisions-v1.json")
    qa["decisions"] = qa_decisions
    write(run / "qa" / "qa.json", qa)
    handoffs = []
    for variant in variants:
        handoff = example("markcut-handoffs-v1.json")["handoffs"][0]
        handoff["variant_id"] = variant["variant_id"]
        handoff["candidate_id"] = variant["candidate_id"]
        handoff["qa_id"] = f"qa_{variant['variant_id']}"
        handoff["evidence_artifacts"] = ["vision/reviews.json", "evidence/transcript.json"]
        handoffs.append(handoff)
    markcut = example("markcut-handoffs-v1.json")
    markcut.update({"input_media": "media/source.mp4", "handoffs": handoffs})
    write(run / "markcut" / "handoffs.json", markcut)
    artifacts = {
        "authorization": "inputs/authorization.json",
        "research": "evidence/research.json",
        "media": "media/preflight.json",
        "transcript": "evidence/transcript.json",
        "text_candidates": "candidates/candidates.json",
        "vision_reviews": "vision/reviews.json",
        "campaign_brief": "campaign/brief.json",
        "judge": "selection/judge.json",
        "selection": "selection/selection.json",
        "variants": "variants/variants.json",
        "qa": "qa/qa.json",
        "markcut": "markcut/handoffs.json",
    }
    write(run / "state" / "run-state.json", {
        "schema_version": 2,
        "run_id": "2026-09-17-fixture",
        "source_id": "authorized_example_source",
        "state": state,
        "artifacts": artifacts if state in {"qa_failed", "qa_passed", "markcut_ready"} else dict(artifacts),
        "blocked_reason": None,
        "history": history_through(state),
    })
    return run


def mutate_run(run: Path, callback) -> None:
    path = run / "state" / "run-state.json"
    state = json.loads(path.read_text(encoding="utf-8"))
    callback(run, state)
    path.write_text(json.dumps(state), encoding="utf-8")


class ContractTests(unittest.TestCase):
    def test_structured_examples_pass(self) -> None:
        cases = {
            "authorization": "source-authorization-v1.json",
            "research": "source-research-v1.json",
            "media": "media-preflight-v1.json",
            "transcript": "transcript-evidence-v1.json",
            "text-candidates": None,
            "vision": "vision-editorial-understanding-v1.json",
            "judge": "editorial-judge-v1.json",
            "selection": "ranked-selection-v2.json",
            "learning": "learning-record-v1.json",
        }
        for kind, name in cases.items():
            if name is None:
                value = example("text-candidate-v1.json")
                with tempfile.TemporaryDirectory() as directory:
                    path = Path(directory) / "text-candidates.json"
                    values = []
                    for index in range(5):
                        item = copy.deepcopy(value)
                        item["candidate_id"] = f"candidate_{index:03d}"
                        values.append(item)
                    path.write_text(json.dumps({"schema_version": 1, "source_id": "authorized_example_source", "stage": "text_first", "candidates": values}), encoding="utf-8")
                    clippers.validate_artifact(kind, path)
                continue
            with self.subTest(kind=kind):
                clippers.validate_artifact(kind, PROJECT / "examples" / name)

    def test_rubric_is_machine_data(self) -> None:
        criteria = clippers.rubric_criteria()
        self.assertEqual(len(criteria), 8)
        self.assertAlmostEqual(sum(criteria.values()), 1.0)

    def test_legal_golden_path_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run = build_run(Path(directory))
            result = clippers.validate_run(run)
            self.assertEqual(result["state"], "qa_passed")

    def test_expired_authorization_is_rejected(self) -> None:
        value = example("source-authorization-v1.json")
        value["authorized_at"] = "2026-09-15T00:00:00+00:00"
        value["expires_at"] = "2026-09-17T00:00:00+00:00"
        now = datetime(2026, 9, 18, tzinfo=timezone.utc)
        with self.assertRaisesRegex(clippers.ValidationError, "expired"):
            clippers.validate_authorization(value, now)

    def test_disallowed_platform_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run = build_run(Path(directory))
            selection_path = run / "selection" / "selection.json"
            selection = json.loads(selection_path.read_text(encoding="utf-8"))
            selection["platform"] = "unauthorized_network"
            selection_path.write_text(json.dumps(selection), encoding="utf-8")
            campaign_path = run / "campaign" / "brief.json"
            campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
            campaign["platform"] = "unauthorized_network"
            campaign_path.write_text(json.dumps(campaign), encoding="utf-8")
            judge_path = run / "selection" / "judge.json"
            judge = json.loads(judge_path.read_text(encoding="utf-8"))
            judge["platform"] = "unauthorized_network"
            judge_path.write_text(json.dumps(judge), encoding="utf-8")
            with self.assertRaisesRegex(clippers.ValidationError, "outside authorization"):
                clippers.validate_run(run)

    def test_missing_candidate_evidence_artifact_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run = build_run(Path(directory))
            candidates_path = run / "candidates" / "candidates.json"
            candidates = json.loads(candidates_path.read_text(encoding="utf-8"))
            candidates["candidates"][0]["evidence"][0]["artifact"] = "evidence/missing.json"
            candidates_path.write_text(json.dumps(candidates), encoding="utf-8")
            with self.assertRaisesRegex(clippers.ValidationError, "does not resolve"):
                clippers.validate_run(run)

    def test_transcript_quote_mismatch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run = build_run(Path(directory))
            candidates_path = run / "candidates" / "candidates.json"
            candidates = json.loads(candidates_path.read_text(encoding="utf-8"))
            candidates["candidates"][0]["transcript_quote"] = "A sentence that does not exist."
            candidates_path.write_text(json.dumps(candidates), encoding="utf-8")
            with self.assertRaisesRegex(clippers.ValidationError, "unsupported"):
                clippers.validate_run(run)

    def test_illegal_state_jump_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run = build_run(Path(directory))
            mutate_run(run, lambda _run, state: state.update({
                "state": "qa_passed",
                "history": [
                    {"state": "initiated", "at": "2026-09-17T09:00:00-04:00", "actor": "run-controller"},
                    {"state": "qa_passed", "at": "2026-09-17T09:05:00-04:00", "actor": "bypass"},
                ],
            }))
            with self.assertRaisesRegex(clippers.ValidationError, "illegal state transition"):
                clippers.validate_run(run)

    def test_qa_failed_cannot_bypass_directly_to_pass(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run = build_run(Path(directory), state="qa_passed")
            mutate_run(run, lambda _run, state: state["history"].insert(-1, {
                "state": "qa_failed", "at": "2026-09-17T09:10:00-04:00", "actor": "reality-checker"
            }))
            with self.assertRaisesRegex(clippers.ValidationError, "illegal state transition"):
                clippers.validate_run(run)

    def test_qa_failed_state_is_valid_without_markcut(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run = build_run(Path(directory), state="qa_failed")
            qa_path = run / "qa" / "qa.json"
            qa = json.loads(qa_path.read_text(encoding="utf-8"))
            qa["decision"] = "fail"
            qa["decisions"][0]["decision"] = "fail"
            qa["decisions"][0]["blockers"] = ["Hook is not self-contained."]
            qa_path.write_text(json.dumps(qa), encoding="utf-8")
            result = clippers.validate_run(run)
            self.assertEqual(result["state"], "qa_failed")

    def test_qa_failure_repairs_through_ranked_review(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run = build_run(Path(directory))
            qa_path = run / "qa" / "qa.json"
            passing_qa = json.loads(qa_path.read_text(encoding="utf-8"))
            qa_path.write_text(json.dumps({
                "schema_version": 1,
                "source_id": "authorized_example_source",
                "selection_id": "selection_2026_09_17_example",
                "reviewer": "reality-checker",
                "independent": True,
                "decision": "fail",
                "decisions": [{
                    "qa_id": "qa_failed_variant_rule", "variant_id": "variant_rule", "candidate_id": "candidate_001",
                    "decision": "fail",
                    "checks": [
                        {"id": "authorization_and_provenance", "result": "pass", "evidence": "authorized"},
                        {"id": "timestamp_evidence", "result": "pass", "evidence": "aligned"},
                        {"id": "ranking_eligibility", "result": "pass", "evidence": "bound"},
                        {"id": "editorial_coherence", "result": "fail", "evidence": "hook mismatch"},
                        {"id": "identity_binding", "result": "pass", "evidence": "bound"},
                    ],
                    "blockers": ["Hook is not self-contained."],
                }],
            }), encoding="utf-8")
            mutate_run(run, lambda _run, state: state.update({"state": "qa_failed", "history": history_through("qa_failed")}))
            self.assertEqual(clippers.validate_run(run)["state"], "qa_failed")
            qa_path.write_text(json.dumps(passing_qa), encoding="utf-8")
            repair_history = history_through("variants_planned") + [
                {"state": "qa_failed", "at": "2026-09-17T09:11:00-04:00", "actor": "reality-checker"},
                {"state": "judge_ranked", "at": "2026-09-17T09:12:00-04:00", "actor": "short-video-editing-coach"},
                {"state": "variants_planned", "at": "2026-09-17T09:13:00-04:00", "actor": "short-video-editing-coach"},
                {"state": "qa_passed", "at": "2026-09-17T09:14:00-04:00", "actor": "reality-checker"},
            ]
            mutate_run(run, lambda _run, state: state.update({"state": "qa_passed", "history": repair_history}))
            self.assertEqual(clippers.validate_run(run)["state"], "qa_passed")

    def test_wrong_rank_order_or_tiebreak_is_rejected(self) -> None:
        selection = example("ranked-selection-v2.json")
        base = selection["rankings"][0]
        first = dict(base, candidate_id="candidate_z", judge_entry_id="entry_z", weighted_score=1.0)
        second = dict(base, candidate_id="candidate_a", judge_entry_id="entry_a", weighted_score=1.0)
        selection["rankings"] = [first, second]
        for rank, ranking in enumerate(selection["rankings"], 1):
            ranking["rank"] = rank
        with self.assertRaisesRegex(clippers.ValidationError, "candidate_id tie-break"):
            clippers.validate_selection(selection)

    def test_qa_identity_mismatch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run = build_run(Path(directory))
            qa_path = run / "qa" / "qa.json"
            qa = json.loads(qa_path.read_text(encoding="utf-8"))
            qa["selection_id"] = "different_selection"
            qa_path.write_text(json.dumps(qa), encoding="utf-8")
            with self.assertRaisesRegex(clippers.ValidationError, "QA selection identity"):
                clippers.validate_run(run)

    def test_arbitrary_markcut_file_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run = build_run(Path(directory))
            arbitrary = run / "markcut" / "brief.md"
            arbitrary.write_text("# arbitrary prose handoff", encoding="utf-8")
            mutate_run(run, lambda _run, state: (state.update({"state": "markcut_ready"}), state["history"].append({"state": "markcut_ready", "at": "2026-09-17T09:15:00-04:00", "actor": "editor"}), state["artifacts"].update({"markcut": "markcut/brief.md"})))
            with self.assertRaisesRegex(clippers.ValidationError, "invalid JSON"):
                clippers.validate_run(run)

    def test_markcut_qa_identity_mismatch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run = build_run(Path(directory), state="markcut_ready")
            path = run / "markcut" / "handoffs.json"
            handoffs = json.loads(path.read_text(encoding="utf-8"))
            handoffs["handoffs"][0]["qa_id"] = "qa_different"
            path.write_text(json.dumps(handoffs), encoding="utf-8")
            with self.assertRaisesRegex(clippers.ValidationError, "qa_id identity mismatch"):
                clippers.validate_run(run)

    def test_command_line_status(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run = build_run(Path(directory))
            result = subprocess.run([sys.executable, str(SCRIPT), "status", str(run)], check=True, capture_output=True, text=True)
            self.assertIn("OK qa_passed", result.stdout)


if __name__ == "__main__":
    unittest.main()
