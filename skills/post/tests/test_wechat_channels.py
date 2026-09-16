from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parents[1]


def load(name: str, relative_path: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, HERE / relative_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_status_label_mapping() -> None:
    common = load(
        "wechat_channels_common_bh",
        "scripts/platforms/wechat-channels/_common_bh.py",
    )
    assert common.status_label("审核中 1 分钟前") == ("reviewing", "审核中")
    assert common.status_label("已发表 2026-09-15") == ("published", "已发表")
    assert common.status_label("no status") == (None, None)


def test_stable_id_prefers_finder_id_and_url() -> None:
    common = load(
        "wechat_channels_common_bh",
        "scripts/platforms/wechat-channels/_common_bh.py",
    )
    row = {
        "stable_ids": {"objectid": "object-1"},
        "urls": ["https://channels.weixin.qq.com/platform/post?finderObjectId=finder-2"],
    }
    assert common.extract_stable_id(row) == "finder-2"


def test_choose_manager_row_prefers_post_id() -> None:
    common = load(
        "wechat_channels_common_bh",
        "scripts/platforms/wechat-channels/_common_bh.py",
    )
    rows = [
        {"text": "审核中 title", "stable_ids": {"postid": "post-1"}, "urls": []},
        {"text": "已发布 other", "stable_ids": {"postid": "post-2"}, "urls": []},
    ]
    assert common.choose_manager_row(rows, "post-2", "title", None)["text"] == "已发布 other"
    assert common.choose_manager_row(rows, None, "title", None)["text"] == "审核中 title"
    assert common.choose_manager_row([], None, "title", None) is None


def test_publish_rejected_is_not_successful_contract() -> None:
    source = (HERE / "scripts/platforms/wechat-channels/_post_bh.py").read_text()
    assert 'verification["status"] in {"published", "reviewing"}' in source
    assert 'verification["status"] in {"published", "reviewing", "rejected"} if action' not in source


def test_browser_scripts_use_adapter_dir_placeholder() -> None:
    for name in ("_post_bh.py", "_manage_bh.py"):
        source = (HERE / "scripts/platforms/wechat-channels" / name).read_text()
        assert 'sys.path.insert(0, "__ADAPTER_DIR__")' in source
