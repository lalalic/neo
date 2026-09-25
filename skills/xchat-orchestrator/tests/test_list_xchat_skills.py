import importlib.machinery
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "list-xchat-skills"
loader = importlib.machinery.SourceFileLoader("list_xchat_skills", str(SCRIPT))
spec = importlib.util.spec_from_loader("list_xchat_skills", loader)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


class ListXchatSkillsTests(unittest.TestCase):
    def skill(self, root: Path, name: str, requires: str = "") -> None:
        path = root / name
        path.mkdir()
        (path / "SKILL.md").write_text(
            "---\n"
            f"name: {name}\n"
            "description: test skill\n"
            f"{requires}"
            "---\n",
            encoding="utf-8",
        )

    def run_discovery(self, roots: list[Path]) -> list[dict]:
        old_roots, old_argv = module.ROOTS, sys.argv
        module.ROOTS = roots
        sys.argv = [str(SCRIPT)]
        output = io.StringIO()
        try:
            with redirect_stdout(output):
                self.assertEqual(module.main(), 0)
        finally:
            module.ROOTS, sys.argv = old_roots, old_argv
        return json.loads(output.getvalue())

    def test_dependency_metadata_and_missing_resolution(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.skill(root, "needs-browser", "requires:\n  skills:\n    - browser-harness\n")
            result = self.run_discovery([root])
            self.assertEqual(result[0]["requires"]["skills"], ["browser-harness"])
            self.assertFalse(result[0]["requires_resolved"])
            self.assertEqual(result[0]["missing_required_skills"], ["browser-harness"])

    def test_dependency_resolves_from_active_skill_set(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.skill(root, "browser-harness")
            self.skill(root, "needs-browser", "requires:\n  skills:\n    - browser-harness\n")
            result = {skill["name"]: skill for skill in self.run_discovery([root])}
            self.assertTrue(result["needs-browser"]["requires_resolved"])
            self.assertEqual(result["needs-browser"]["missing_required_skills"], [])

    def test_legacy_skill_shape_is_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = self.run_discovery([Path(tmp)])
            self.assertEqual(result, [])
            self.skill(Path(tmp), "legacy")
            result = self.run_discovery([Path(tmp)])
            self.assertEqual(set(result[0]), {"name", "description", "path"})

    def test_markdown_reports_dependency_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.skill(root, "needs-browser", "requires:\n  skills:\n    - browser-harness\n")
            old_roots, old_argv = module.ROOTS, sys.argv
            module.ROOTS = [root]
            sys.argv = [str(SCRIPT), "--markdown"]
            output = io.StringIO()
            try:
                with redirect_stdout(output):
                    self.assertEqual(module.main(), 0)
            finally:
                module.ROOTS, sys.argv = old_roots, old_argv
            self.assertIn("Requires", output.getvalue())
            self.assertIn("missing: browser-harness", output.getvalue())


if __name__ == "__main__":
    unittest.main()
