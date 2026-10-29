"""Contract checks: mode selection lives in Bootstrap; execution lives in Skill."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
BOOTSTRAP = (ROOT / "xchat-bootstrap.md").read_text(encoding="utf-8")
SKILL = (ROOT / "SKILL.md").read_text(encoding="utf-8")


class HotfixContractTests(unittest.TestCase):
    def test_mode_selection_precedes_bootstrap_and_links_to_skill(self):
        self.assertLess(
            BOOTSTRAP.index("## Execution mode selection"),
            BOOTSTRAP.index("## Bootstrap workflow"),
        )
        self.assertIn("SKILL.md#direct-chat-hotfix-protocol", BOOTSTRAP)
        self.assertIn("SKILL.md#operating-invariants", BOOTSTRAP)
        self.assertIn("## Direct-chat HOTFIX protocol", SKILL)

    def test_hotfix_direct_chat_and_no_relay_job(self):
        self.assertIn("this XChat thread", BOOTSTRAP)
        self.assertIn("Do **not** create/adopt/repair an Agents Relay Job/Task", BOOTSTRAP)
        self.assertIn("implement → review → fix → review → fix", BOOTSTRAP)
        self.assertIn("merge → live → clean", BOOTSTRAP)
        self.assertIn("/Users/chengli/Workspace/.worktrees/orchestrator/", SKILL)
        self.assertIn("hotfix/<slug>", SKILL)
        self.assertIn("current XChat thread", SKILL)
        self.assertIn("git worktree prune", SKILL)

    def test_managed_remains_default_and_relay_explicit_wins(self):
        self.assertIn("**MANAGED:** Otherwise use Agents Relay", BOOTSTRAP)
        self.assertIn("An explicit request to use Relay overrides", BOOTSTRAP)
        self.assertIn("normal non-HOTFIX managed work only", SKILL)
        self.assertIn("agents-relay job create", SKILL)

    def test_relay_documents_not_required_for_hotfix(self):
        self.assertIn("HOTFIX does not depend on Relay contract availability", BOOTSTRAP)
        self.assertIn("HOTFIX skips this Relay-only prerequisite", BOOTSTRAP)
        self.assertIn("never as a HOTFIX prerequisite", SKILL)
        self.assertIn("[MANAGED only]", BOOTSTRAP)

    def test_failure_preserves_unique_work(self):
        self.assertIn("Keep unique work if blocked", BOOTSTRAP)
        self.assertIn("Preserve branch/worktree if merge", SKILL)
        self.assertIn("git worktree remove", SKILL)

    def test_bootstrap_does_not_duplicate_full_execution_protocol(self):
        self.assertLess(len(BOOTSTRAP.splitlines()), 115)
        self.assertIn("## Closed-loop protocol", SKILL)
        self.assertIn("## Direct-chat HOTFIX protocol", SKILL)


if __name__ == "__main__":
    unittest.main()
