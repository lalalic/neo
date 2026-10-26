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
            config.write_text(json.dumps({"schemaVersion": 1, "workspaceRoot": str(root)}), encoding="utf-8")
            old = os.environ.get("NEO_WORKSPACE_CONFIG")
            os.environ["NEO_WORKSPACE_CONFIG"] = str(config)
            try:
                fresh = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(fresh)
                self.assertEqual(fresh.WORKSPACE, root.resolve())
            finally:
                if old is None:
                    os.environ.pop("NEO_WORKSPACE_CONFIG", None)
                else:
                    os.environ["NEO_WORKSPACE_CONFIG"] = old

    def test_project_discovery_uses_selected_workspace(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "custom-workspace"
            project = workspace / "team" / "sample"
            project.mkdir(parents=True)
            (project / "README.md").write_text("# Sample\n", encoding="utf-8")
            (project / "AGENTS.md").write_text("# Instructions\n", encoding="utf-8")
            subprocess.run(["git", "init", str(project)], check=True, capture_output=True)
            subprocess.run(["git", "-C", str(project), "remote", "add", "origin", "https://github.com/acme/sample.git"], check=True)
            original = module.WORKSPACE
            module.WORKSPACE = workspace.resolve()
            try:
                rows = module.projects()
            finally:
                module.WORKSPACE = original
            self.assertEqual([row["xchat_project"] for row in rows], ["team/sample"])
            self.assertEqual(rows[0]["local_path"], str(project.resolve()))


if __name__ == "__main__":
    unittest.main()
