import importlib.util
import json
from pathlib import Path
import pytest

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location("c", ROOT / "scripts/contract.py")
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

def doc():
    return json.loads((ROOT / "examples/product-demo.json").read_text())

def test_video_director_outputs_canonical_markcut_with_execution_marker():
    md = c.render_markcut(doc())
    assert md.startswith("# video\n")
    assert "<!-- execution " in md
    assert '"type":"demo"' in md
    assert "assets/profiles-demo.mp4" in md

def test_rejects_runtime_automation():
    d = doc()
    d["scenes"][0]["selector"] = "#x"
    with pytest.raises(c.ContractError, match="runtime automation"):
        c.validate_input(d)

def test_duplicate_ids_rejected():
    d = doc()
    d["scenes"].append(dict(d["scenes"][0]))
    with pytest.raises(c.ContractError, match="duplicate scene id"):
        c.validate_input(d)
