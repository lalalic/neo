import importlib.machinery
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "list-xchat-projects"
sys.path.insert(0, str(SCRIPT.parent))
spec = importlib.util.spec_from_loader(
    "list_xchat_projects", importlib.machinery.SourceFileLoader("list_xchat_projects", str(SCRIPT))
)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


class ListXchatProjectsTests(unittest.TestCase):
    def test_resolver_loads_workspace_root_from_shared_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "selected"
            root.mkdir()
            config = Path(tmp) / "workspace.json"
            config.write_text(json.dumps({"schemaVersion": 1, "neoRoot": str(root)}), encoding="utf-8")
            old = os.environ.get("NEO_WORKSPACE_CONFIG")
            os.environ["NEO_WORKSPACE_CONFIG"] = str(config)
            try:
                fresh = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(fresh)
                self.assertEqual(fresh.PROJECTS_ROOT, root.resolve())
            finally:
                if old is None:
                    os.environ.pop("NEO_WORKSPACE_CONFIG", None)
                else:
                    os.environ["NEO_WORKSPACE_CONFIG"] = old

    def test_discovery_accepts_only_independent_git_roots_directly_under_selected_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "custom-workspace"
            workspace.mkdir()
            root = workspace / "projects"
            root.mkdir()
            project = root / "sample"
            project.mkdir()
            (project / "README.md").write_text("# Sample\n", encoding="utf-8")
            (project / "AGENTS.md").write_text("# Instructions\n", encoding="utf-8")
            (project / "graph.mmd").write_text("flowchart TD\nA[agent:test]", encoding="utf-8")
            subprocess.run(["git", "init", "-q", str(project)], check=True)
            legacy = root / "legacy"
            legacy.mkdir()
            (legacy / "README.md").write_text("# Legacy\n", encoding="utf-8")
            (legacy / "AGENTS.md").write_text("# Legacy\n", encoding="utf-8")
            generic = root / "generic-repo"
            generic.mkdir()
            (generic / "README.md").write_text("# Generic repository\n", encoding="utf-8")
            (generic / "AGENTS.md").write_text("# Rules\n", encoding="utf-8")
            subprocess.run(["git", "init", "-q", str(generic)], check=True)
            subprocess.run(["git", "-C", str(project), "remote", "add", "origin", "git@github.com:someone/remote-name.git"], check=True)
            nested = project / "nested"
            nested.mkdir()
            (nested / "README.md").write_text("# Nested\n", encoding="utf-8")
            (nested / "AGENTS.md").write_text("# Nested\n", encoding="utf-8")
            previous = module.PROJECTS_ROOT
            module.PROJECTS_ROOT = root.resolve()
            try:
                rows = module.projects()
                self.assertEqual([row["xchat_project"] for row in rows], ["sample"])
                self.assertEqual(rows[0]["local_path"], str(project.resolve()))
                self.assertEqual(rows[0]["repo"], "sample")
                self.assertEqual(rows[0]["origin"], "git@github.com:someone/remote-name.git")
                self.assertEqual(rows[0]["neo_project"], True)
                self.assertEqual(module.resolve(rows, "sample")["git_root"], str(project.resolve()))
                with self.assertRaises(SystemExit):
                    module.resolve(rows, "legacy")
                with self.assertRaises(SystemExit):
                    module.resolve(rows, "sample/nested")
            finally:
                module.PROJECTS_ROOT = previous


if __name__ == "__main__":
    unittest.main()
