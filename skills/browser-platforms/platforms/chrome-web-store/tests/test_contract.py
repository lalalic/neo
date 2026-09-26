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
    for flow in ("open-item", "create-item", "upload-package", "update-listing", "submit-review", "check-status", "verify-published"):
        assert flow in text
    assert "status: working" in text


def test_runner_requires_exact_package_version_before_upload():
    source = RUNNER.read_text(encoding="utf-8")
    assert "manifest.json" in source
    assert "does not match expected_version" in source


def test_runner_reuses_harness_real_tab_for_stable_navigation():
    source = RUNNER.read_text(encoding="utf-8")
    assert "ensure_real_tab()" in source
    assert "goto_url(url)" in source


def test_runner_uses_accessible_labels_and_draft_save_control():
    source = RUNNER.read_text(encoding="utf-8")
    assert "aria-labelledby" in source
    assert "label[for=" in source
    assert "Save draft" in source


def test_runner_derives_publisher_scoped_item_route():
    source = RUNNER.read_text(encoding="utf-8")
    assert "publisher_id_from_url" in source
    assert 'f"https://chrome.google.com/webstore/devconsole/{publisher_id}/{ITEM_ID}/edit"' in source


def test_runner_bootstraps_publisher_scope_before_item_navigation():
    source = RUNNER.read_text(encoding="utf-8")
    assert 'goto_url(CONSOLE_URL)' in source
    assert 'publisher-scoped developer console route not observed' in source
    assert 'CONSOLE_URL + f"/store-item/{ITEM_ID}"' not in source


def test_runner_supports_dry_run_new_item_creation():
    source = RUNNER.read_text(encoding="utf-8")
    assert '"create-item"' in source
    assert 'would_create=True' in source
    assert 'created item editor route not observed' in source
    assert 'manifest key field is not allowed' in source
