import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).parents[1]
MANIFEST = ROOT / "manifest.yaml"
RUNNER = ROOT / "browser-harness" / "_chrome_web_store_bh.py"


def test_runner_has_explicit_action_and_side_effect_guards():
    source = RUNNER.read_text(encoding="utf-8")
    assert '"submit-review"' in source
    assert "COMMIT" in source
    assert "ALLOW_EXTERNAL_SUBMIT" in source
    assert '"published"' in source
    assert "page_info" in source
    assert "package_version" in source
    assert "allow_external_submit" in source
    assert "screenshots" in source
    assert "reviewer_test_instructions" in source


def test_manifest_covers_release_lifecycle():
    text = MANIFEST.read_text(encoding="utf-8")
    for flow in ("open-item", "upload-package", "update-listing", "submit-review", "check-status", "verify-published"):
        assert flow in text
    assert "status: working" in text


def test_runner_requires_exact_package_version_before_upload():
    source = RUNNER.read_text(encoding="utf-8")
    assert "manifest.json" in source
    assert "does not match expected_version" in source
