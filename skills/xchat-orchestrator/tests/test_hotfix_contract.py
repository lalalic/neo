"""XChat rules are a small harness document, not a mandatory orchestrator skill."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
BOOTSTRAP = (ROOT / "xchat-bootstrap.md").read_text(encoding="utf-8")
CUSTOM = (ROOT / "references/web-custom-instructions.md").read_text(encoding="utf-8")


class XChatHarnessContractTests(unittest.TestCase):
    def test_bootstrap_is_small_and_not_relay_or_project_dependent(self):
        self.assertLess(len(BOOTSTRAP.splitlines()), 60)
        self.assertIn("Do not duplicate tool discovery or infer a repository from ChatGPT Project/Space", CUSTOM)
        self.assertIn("neo bootstrap", CUSTOM)
        self.assertIn("run `neo bootstrap` once", CUSTOM)
        self.assertIn("If Neo is unavailable", CUSTOM)
        self.assertIn("Legacy Default Instructions compatibility", BOOTSTRAP)
        self.assertIn("Do not invoke it again when reading the generated output", BOOTSTRAP)
        self.assertNotIn("Read `/Users/chengli/Workspace/neo/skills/xchat-orchestrator/SKILL.md`", BOOTSTRAP)
        self.assertIn("Do not infer a repository from Project/Space", BOOTSTRAP)

    def test_privilege_discovery_is_a_shell_command(self):
        self.assertIn("neo privilege list", BOOTSTRAP)
        self.assertIn("neo privilege status", BOOTSTRAP)
        self.assertIn("neo privilege run <approved-action>", BOOTSTRAP)
        self.assertIn("request owner approval", BOOTSTRAP)

    def test_hotfix_is_execution_behavior_not_a_skill_or_relay_job(self):
        self.assertIn("**hotfix**", BOOTSTRAP)
        self.assertIn("no Relay Job/Task or managed PR", BOOTSTRAP)
        self.assertIn("implement → review → fix → review → fix", BOOTSTRAP)
        self.assertIn("merge → live → clean", BOOTSTRAP)
        self.assertIn(".worktrees/orchestrator/", BOOTSTRAP)

    def test_relay_skill_loaded_only_for_managed_work(self):
        self.assertIn("load the discovered `agents-relay` Skill", BOOTSTRAP)
        self.assertIn("An explicit Relay request overrides", BOOTSTRAP)

    def test_skill_catalog_and_tools_not_duplicated(self):
        self.assertIn("neo skill list", BOOTSTRAP)
        self.assertIn("MCP already provides tools", BOOTSTRAP)
        self.assertIn("Load the selected `SKILL.md` only when relevant", BOOTSTRAP)
        self.assertIn("`name`, `description`, and `absolutePath`", BOOTSTRAP)
        self.assertIn("`#skill-name`", BOOTSTRAP)
        self.assertIn("Neo MCP already provides tools", CUSTOM)
        self.assertNotIn("Bearer", CUSTOM)
        self.assertNotIn("ASD-STE100", CUSTOM)
        self.assertNotIn("pm2", CUSTOM)


if __name__ == "__main__":
    unittest.main()
