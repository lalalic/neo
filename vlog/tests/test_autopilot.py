import importlib.util
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("autopilot", Path(__file__).parents[1] / "scripts" / "autopilot.py")
autopilot = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(autopilot)


class AutopilotTests(unittest.TestCase):
    def test_forwards_complete_instruction_and_private_endpoint(self):
        message = """帮我制作一个 vlog，用今天还没处理的照片和视频

iPhone media MCP server: http://192.168.50.20:9223/mcp
LAN only, no auth. Discover tools with tools/list first."""
        self.assertEqual(autopilot.endpoint(message), "http://192.168.50.20:9223/mcp")
        self.assertEqual(autopilot.handoff_instruction(message), "帮我制作一个 vlog，用今天还没处理的照片和视频")
        self.assertIsNone(autopilot.endpoint(message.replace("192.168.50.20", "8.8.8.8")))
        self.assertIsNone(autopilot.endpoint(message.replace("照片和视频", "天气")))
