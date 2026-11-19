"""Capability checks for one-line Neo bootstrap across external web chats."""
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
import json
import re
import unittest

ROOT = Path(__file__).resolve().parents[3]
DOC = (ROOT / "docs/z-chat/bootstrap.md").read_text(encoding="utf-8")
PARENT = (ROOT / "skills/xchat-orchestrator/references/external-child-bootstrap.md").read_text(encoding="utf-8")
OPERATOR = (ROOT / "docs/interactive-mcp-access.md").read_text(encoding="utf-8")
START = "bootstrap with neoy.qili2.com/files/z-chat/bootstrap.md"


class ExternalWebchatBootstrapTests(unittest.TestCase):
    def test_single_public_bootstrap_for_z_and_deepseek(self):
        for content in (DOC, PARENT, OPERATOR):
            self.assertIn(START, content)
        self.assertIn("https://chat.z.ai", DOC)
        self.assertIn("https://chat.deepseek.com", DOC)
        self.assertIn("https://neoy.qili2.com/files/z-chat/bootstrap.md", DOC)
        self.assertNotIn("Z.ai \u2192 Neo Interactive Bootstrap", DOC)

    def test_real_transport_fallback_not_assumed(self):
        self.assertIn("tools/list", DOC)
        self.assertIn("tools/call", DOC)
        self.assertIn("https://neoy.qili2.com/mcp", DOC)
        self.assertIn("GET https://neoy.qili2.com/mcp/rest/<TOKEN>", DOC)
        self.assertIn("NEO_TOOL_UNAVAILABLE", DOC)
        self.assertIn("do not support arbitrary URLs", DOC)

    def test_get_url_example_encodes_real_json_tool_args(self):
        url = re.search(r"GET (https://neoy\.qili2\.com/mcp/rest/<TOKEN>/shell\?args=\S+)", DOC)
        self.assertIsNotNone(url)
        parsed = urlparse(url.group(1))
        self.assertEqual(parsed.path, "/mcp/rest/<TOKEN>/shell")
        args = json.loads(parse_qs(parsed.query)["args"][0])
        self.assertEqual(args, {"command": "exec", "args": {"command": "neo bootstrap"}})

    def test_four_real_evidence_steps_and_load_skill(self):
        self.assertIn("all four results", DOC)
        self.assertIn("xchat-orchestrator/SKILL.md", DOC)
        self.assertIn("discovered-absolutePath", DOC)
        self.assertIn("NEO_BOOTSTRAP_PASS", DOC)
        self.assertIn("NEO_BOOTSTRAP_BLOCKED", DOC)
        self.assertIn("NEO_AUTH_REQUIRED", DOC)
        self.assertIn("same verified child thread", PARENT)
        self.assertIn("no Relay Job, repository binding", DOC)
        self.assertIn("no Relay Job", DOC)

    def test_credentials_are_not_in_public_bootstrap(self):
        self.assertIn("one-hour", DOC)
        self.assertIn("URL-path tokens are sensitive", DOC)
        self.assertIn("short-lived", PARENT)
        self.assertIn("follow-up turn", PARENT)
        self.assertNotRegex(DOC, r"(?i)(?:api_key|bearer)\s*[:=]\s*sk-[a-z0-9]{16,}")


if __name__ == "__main__":
    unittest.main()
