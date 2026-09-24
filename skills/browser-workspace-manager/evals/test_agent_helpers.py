import runpy
import sys
import types
import unittest
from pathlib import Path

HELPER = Path(__file__).resolve().parents[1] / "browser-harness" / "agent_helpers.py"


def load_helper():
    helpers = types.ModuleType("browser_harness.helpers")
    helpers.switch_tab = lambda *args, **kwargs: None
    helpers.current_tab = lambda: {"targetId": "current"}
    helpers.goto_url = lambda url: url
    helpers.cdp = lambda *args, **kwargs: {"targetInfos": []}
    helpers.js = lambda *args, **kwargs: None
    package = types.ModuleType("browser_harness")
    package.helpers = helpers
    old_package = sys.modules.get("browser_harness")
    old_helpers = sys.modules.get("browser_harness.helpers")
    sys.modules["browser_harness"] = package
    sys.modules["browser_harness.helpers"] = helpers
    try:
        return runpy.run_path(str(HELPER))
    finally:
        if old_package is None:
            sys.modules.pop("browser_harness", None)
        else:
            sys.modules["browser_harness"] = old_package
        if old_helpers is None:
            sys.modules.pop("browser_harness.helpers", None)
        else:
            sys.modules["browser_harness.helpers"] = old_helpers


class WorkspaceMappingTest(unittest.TestCase):
    def test_unique_mapping_and_ambiguous_drop(self):
        mapper = load_helper()["_map_workspace_tabs"]
        chrome_tabs = [
            {"tabId": 1, "groupId": 7, "url": "https://one.test/", "title": "One"},
            {"tabId": 2, "groupId": 7, "url": "https://dup.test/", "title": "Same"},
        ]
        targets = [
            {"targetId": "a", "type": "page", "url": "https://one.test/", "title": "One"},
            {"targetId": "b", "type": "page", "url": "https://dup.test/", "title": "Same"},
            {"targetId": "c", "type": "page", "url": "https://dup.test/", "title": "Same"},
        ]
        self.assertEqual(
            mapper(chrome_tabs, targets),
            [{
                "targetId": "a",
                "target_id": "a",
                "tabId": 1,
                "groupId": 7,
                "title": "One",
                "url": "https://one.test/",
            }],
        )


if __name__ == "__main__":
    unittest.main()
