import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))

from _submit_readiness import actionable_temporary_chat_candidates, prompt_text_matches, submission_receipt, temporary_chat_enabled_state, temporary_chat_entry_url, wait_until_stable


class SubmitReadinessTests(unittest.TestCase):
    def test_temporary_chat_worker_opens_observable_mode_route(self):
        self.assertEqual(
            temporary_chat_entry_url(),
            "https://chatgpt.com/?temporary-chat=true",
        )

    def test_slow_attachment_does_not_fail_on_visible_filename(self):
        states = iter([
            {"names": ["report.pdf"], "pending": True},
            {"names": ["report.pdf"], "pending": True},
            {"names": ["report.pdf"], "pending": False},
            {"names": ["report.pdf"], "pending": False},
        ])
        result = wait_until_stable(
            lambda: next(states),
            lambda state: state["names"] == ["report.pdf"] and not state["pending"],
            timeout=1,
            interval=0,
            phase="attachment upload readiness",
        )
        self.assertFalse(result["pending"])

    def test_delayed_send_enablement_is_polled_until_stable(self):
        states = iter([
            {"enabled": False},
            {"enabled": False},
            {"enabled": True},
            {"enabled": True},
        ])
        result = wait_until_stable(
            lambda: next(states),
            lambda state: state["enabled"],
            timeout=1,
            interval=0,
            phase="send readiness",
        )
        self.assertTrue(result["enabled"])



    def test_temporary_chat_enabled_prefers_url_state_over_label_variant(self):
        candidates = [{
            "visible": True,
            "disabled": False,
            "pointerEvents": "auto",
            "label": "Temporary chat",
            "text": "",
        }]
        self.assertTrue(
            temporary_chat_enabled_state(
                "https://chatgpt.com/?temporary-chat=true",
                candidates,
            )
        )

    def test_temporary_chat_enabled_accepts_turn_off_label_as_fallback(self):
        candidates = [{
            "visible": True,
            "disabled": False,
            "pointerEvents": "auto",
            "label": "Turn off temporary chat",
            "text": "",
        }]
        self.assertTrue(temporary_chat_enabled_state("https://chatgpt.com/", candidates))

    def test_temporary_chat_enabled_rejects_plain_toggle_without_url_state(self):
        candidates = [{
            "visible": True,
            "disabled": False,
            "pointerEvents": "auto",
            "label": "Temporary chat",
            "text": "",
        }]
        self.assertFalse(temporary_chat_enabled_state("https://chatgpt.com/", candidates))

    def test_prompt_text_matches_prosemirror_reshaping(self):
        expected = "START " + ("alpha beta " * 200) + " END"
        observed = "START\n\n" + ("alpha  beta\n" * 200) + " END"
        self.assertTrue(prompt_text_matches(observed, expected))

    def test_prompt_text_matches_rejects_truncated_prompt(self):
        expected = "START " + ("alpha beta " * 200) + " END"
        self.assertFalse(prompt_text_matches(expected[:400], expected))

    def test_submission_receipt_accepts_matching_user_turn(self):
        prompt = "hello reviewer"
        receipt = submission_receipt(
            [{"id": "old", "text": "old"}, {"id": "new", "text": "hello  reviewer"}],
            1,
            prompt,
            "still populated",
        )
        self.assertEqual(receipt["verified_by"], "user-turn")
        self.assertEqual(receipt["turn"]["id"], "new")

    def test_submission_receipt_accepts_cleared_composer_for_start_ack_gate(self):
        receipt = submission_receipt([], 0, "long prompt", "   ")
        self.assertEqual(receipt["verified_by"], "composer-cleared")
        self.assertIsNone(receipt["turn"]["id"])

    def test_submission_receipt_rejects_nonempty_unmatched_state(self):
        self.assertIsNone(submission_receipt([], 0, "long prompt", "long prompt"))

    def test_temporary_chat_actionability_ignores_hidden_duplicate(self):
        candidates = [
            {"visible": False, "disabled": False, "pointerEvents": "auto"},
            {"visible": True, "disabled": False, "pointerEvents": "auto", "index": 4},
        ]
        self.assertEqual(actionable_temporary_chat_candidates(candidates), [candidates[1]])

    def test_temporary_chat_actionability_rejects_disabled_controls(self):
        candidates = [
            {"visible": True, "disabled": True, "pointerEvents": "auto"},
            {"visible": True, "disabled": False, "pointerEvents": "none"},
        ]
        self.assertEqual(actionable_temporary_chat_candidates(candidates), [])

    def test_temporary_chat_actionability_preserves_true_ambiguity(self):
        candidates = [
            {"visible": True, "disabled": False, "pointerEvents": "auto", "index": 1},
            {"visible": True, "disabled": False, "pointerEvents": "auto", "index": 2},
        ]
        self.assertEqual(len(actionable_temporary_chat_candidates(candidates)), 2)


if __name__ == "__main__":
    unittest.main()
