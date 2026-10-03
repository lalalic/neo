from pathlib import Path
import importlib.util

SCRIPT = Path(__file__).parents[1] / "scripts" / "validate_episode_completion.py"
spec = importlib.util.spec_from_file_location("validator", SCRIPT)
m = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(m)

def write(p: Path, text="ok"):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)

def fill(tmp_path: Path):
    for rel in m.REQUIRED_FILES:
        write(tmp_path / rel, "PASS" if rel.startswith("reviews/") else "ok")
    write(tmp_path / "output/final.mp4", "test")
    write(tmp_path / "publish/xiaohongshu.md", "Platform: Xiaohongshu\nNote ID: test\n")

def test_editorial_only_is_not_complete(tmp_path):
    for rel in ("evidence.md","story.md","post.md","visual-brief.md","video.md","qa.md","next-day-brief.md"):
        write(tmp_path / rel)
    errors = m.validate(tmp_path, True)
    assert any("rendered MP4" in e for e in errors)
    assert any("publication receipt" in e for e in errors)

def test_publication_receipt_required(tmp_path):
    fill(tmp_path)
    (tmp_path / "publish/xiaohongshu.md").unlink()
    assert any("publication receipt" in e for e in m.validate(tmp_path, True))

def test_complete_run_passes(tmp_path):
    fill(tmp_path)
    assert m.validate(tmp_path, True) == []
