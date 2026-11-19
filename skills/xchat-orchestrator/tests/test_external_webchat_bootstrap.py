"""Capability contracts for separate Z.ai MCP and DeepSeek REST web chat bootstrap."""
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import json
import re
import unittest

ROOT = Path(__file__).resolve().parents[3]
Z = (ROOT / "docs/z-chat/bootstrap.md").read_text(encoding="utf-8")
DEEPSEEK = (ROOT / "docs/deepseek/bootstrap.md").read_text(encoding="utf-8")
PARENT = (ROOT / "skills/xchat-orchestrator/references/external-child-bootstrap.md").read_text(encoding="utf-8")
OPERATOR = (ROOT / "docs/interactive-mcp-access.md").read_text(encoding="utf-8")
Z_START = "bootstrap with neoy.qili2.com/files/z-chat/bootstrap.md"
DEEPSEEK_START = "bootstrap with neoy.qili2.com/files/deepseek/bootstrap.md"


class ExternalWebchatBootstrapTests(unittest.TestCase):
    def test_two_provider_specific_starters(self):
        self.assertIn(Z_START, Z)
        self.assertIn(DEEPSEEK_START, DEEPSEEK)
        for text in (PARENT, OPERATOR):
            self.assertIn(Z_START, text)
            self.assertIn(DEEPSEEK_START, text)
        self.assertIn("https://neoy.qili2.com/files/z-chat/bootstrap.md", Z)
        self.assertIn("https://neoy.qili2.com/mcp/rest/<TOKEN>", DEEPSEEK)

    def test_z_uses_mcp_tools_only_no_rest(self):
        self.assertIn('"method":"tools/list"', Z)
        self.assertIn('"method":"tools/call"', Z)
        self.assertIn("https://neoy.qili2.com/mcp", Z)
        self.assertIn("Authorization: Bearer <TOKEN>", Z)
        self.assertNotIn("/mcp/rest/", Z)
        self.assertNotIn("/files/deepseek/", Z)
        self.assertNotIn("GET-only", Z)

    def test_deepseek_uses_rest_get_only_no_mcp_post(self):
        self.assertIn("REST GET only", DEEPSEEK)
        self.assertIn("GET-only", DEEPSEEK)
        self.assertIn("https://neoy.qili2.com/mcp/rest/<TOKEN>", DEEPSEEK)
        self.assertIn("/mcp/rest/<TOKEN>/status", DEEPSEEK)
        self.assertIn("NEO_TOOL_UNAVAILABLE", DEEPSEEK)
        self.assertNotIn('"method":"tools/list"', DEEPSEEK)
        self.assertNotIn('"method":"tools/call"', DEEPSEEK)
        self.assertNotIn("Authorization: Bearer", DEEPSEEK)
        self.assertNotIn("fallback to POST", DEEPSEEK)
        self.assertNotRegex(DEEPSEEK, r"https://neoy\.qili2\.com/mcp(?!/rest)")

    def test_deepseek_url_example_encodes_valid_shell_arguments(self):
        url = re.search(r"https://neoy\.qili2\.com/mcp/rest/<TOKEN>/shell\?args=\S+", DEEPSEEK)
        self.assertIsNotNone(url)
        parsed = urlparse(url.group(0))
        self.assertEqual(parsed.path, "/mcp/rest/<TOKEN>/shell")
        arguments = json.loads(parse_qs(parsed.query)["args"][0])
        self.assertEqual(arguments, {"command": "exec", "args": {"command": "neo bootstrap"}})
        self.assertIn('"command":"read"', DEEPSEEK)
        self.assertIn('"encoding":"utf8"', DEEPSEEK)

    def test_four_evidence_gates_and_discovered_skill_loading(self):
        for text in (Z, DEEPSEEK):
            self.assertIn("neo bootstrap", text)
            self.assertIn("xchat-orchestrator", text)
            self.assertIn("absolutePath", text)
            self.assertIn("NEO_BOOTSTRAP_PASS", text)
            self.assertIn("NEO_BOOTSTRAP_BLOCKED", text)
            self.assertIn("NEO_AUTH_REQUIRED", text)
            self.assertIn("Relay Job", text)
        self.assertIn("same verified child thread", PARENT)
        self.assertIn("Only after verification", PARENT)

    def test_no_live_credentials_in_public_docs(self):
        for text in (Z, DEEPSEEK):
            self.assertIn("one-hour", text)
            self.assertNotRegex(text, r"(?i)(?:api_key|bearer)\s*[:=]\s*sk-[a-z0-9]{16,}")
            self.assertNotRegex(text, r"sk-[A-Za-z0-9_-]{25,}")
        self.assertIn("short-lived", PARENT)
        self.assertIn("second private turn", PARENT)


if __name__ == "__main__":
    unittest.main()
