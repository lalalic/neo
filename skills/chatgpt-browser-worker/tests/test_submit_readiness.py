import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))

from _submit_readiness import actionable_temporary_chat_candidates, wait_until_stable


class SubmitReadinessTests(unittest.TestCase):
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
