import importlib.util
from pathlib import Path
import pytest

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location("c", ROOT / "scripts/contract.py")
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

def text():
    return (ROOT / "examples/video.md").read_text()

def test_compiles_all_four_lanes():
    index, lanes = c.compile_execution(text())
    assert [x["type"] for x in index["items"]] == ["demo", "capture", "image", "video"]
    assert lanes["demo"]["items"][0]["id"] == "profiles-demo"

def test_write_execution_creates_nonempty_lanes(tmp_path):
    video = tmp_path / "video.md"
    video.write_text(text())
    c.write_execution(video, tmp_path / "execution")
    assert (tmp_path / "execution/index.json").exists()
    assert (tmp_path / "execution/demo.json").exists()
    assert (tmp_path / "execution/capture.json").exists()
    assert (tmp_path / "execution/image.json").exists()
    assert (tmp_path / "execution/video.json").exists()

def test_rejects_runtime_automation():
    bad = '<!-- execution {"id":"x","type":"image","scene_id":"s","output":"a.png","prompt":"x","selector":"#x"} -->'
    with pytest.raises(c.ContractError, match="runtime automation"):
        c.parse_markcut(bad)

def test_duplicate_ids_rejected():
    one = '<!-- execution {"id":"x","type":"image","scene_id":"s","output":"a.png","prompt":"x"} -->'
    with pytest.raises(c.ContractError, match="duplicate execution id"):
        c.parse_markcut(one + "\n" + one)
