import copy
import json

import pytest

from moments_book import RenderError, render_book, render_markcut, validate_markcut, verify_outputs, write_outputs


FIXTURE = {
    "schemaVersion": 1,
    "source": {"kind": "wechat-moments", "collector": "phone-harness"},
    "selection": {"mode": "latest-distinct-years", "yearCount": 2},
    "years": [
        {"year": 2026, "moments": [{
            "id": "moment-2026-04-18-001",
            "postedAt": "2026-04-18T10:00:00Z",
            "text": 'A synthetic "memory"\nwith two lines',
            "locationText": "Visible place label",
            "sourceEvidence": ["fixture"],
            "media": [{
                "id": "media-001",
                "kind": "image",
                "originalAsset": "original.jpg",
                "originalMatch": {"status": "matched", "confidence": 0.99, "evidence": ["fixture"]},
                "gps": {"status": "observed", "latitude": 43.65, "longitude": -79.38, "evidence": ["fixture"]},
            }],
        }]},
        {"year": 2025, "moments": [{
            "id": "moment-2025-12-31-001",
            "postedAt": "2025-12-31T10:00:00Z",
            "text": "Baseline-only memory",
            "media": [{
                "id": "media-002",
                "kind": "video",
                "wechatEvidence": "capture.mov",
                "originalMatch": {"status": "unknown"},
                "gps": {"status": "unknown"},
            }],
        }]},
    ],
}


@pytest.fixture
def assets(tmp_path):
    (tmp_path / "manifest.json").write_text("{}")
    (tmp_path / "original.jpg").write_bytes(b"original image")
    (tmp_path / "capture.mov").write_bytes(b"baseline movie")
    return tmp_path


@pytest.fixture
def manifest(assets):
    value = copy.deepcopy(FIXTURE)
    value["years"][0]["moments"][0]["media"][0]["originalAsset"] = "original.jpg"
    value["years"][1]["moments"][0]["media"][0]["wechatEvidence"] = "capture.mov"
    return value


def test_book_preserves_hierarchy_and_source_text(manifest):
    book = render_book(manifest)
    assert "## 2026" in book
    assert "## 2025" in book
    assert "### moment-2026-04-18-001" in book
    assert "### moment-2025-12-31-001" in book
    assert 'A synthetic "memory"' in book
    assert "with two lines" in book
    assert "Visible place label" in book


def test_markcut_matches_manifest_and_requires_background_media(manifest):
    markcut = render_markcut(manifest, asset_paths={"media-001": "assets/original.jpg", "media-002": "assets/capture.mov"})
    assert markcut.startswith("# video\n")
    assert "## year-2026" in markcut
    assert "### moment-2026-04-18-001" in markcut
    assert "- image src:" in markcut
    assert "isBackground:true" in markcut
    assert "- map duration:3 waypoints:[43.65,-79.38," in markcut
    validate_markcut(manifest, markcut)
    assert verify_outputs(manifest, render_book(manifest), markcut)["status"] == "passed"


def test_location_text_never_creates_a_map(manifest):
    value = copy.deepcopy(manifest)
    moment = value["years"][0]["moments"][0]
    moment["locationText"] = "A different visible label"
    moment["media"][0]["gps"] = {"status": "unknown"}
    markcut = render_markcut(
        value,
        asset_paths={"media-001": "assets/original.jpg", "media-002": "assets/capture.mov"},
    )
    validate_markcut(value, markcut)
    assert "map " not in markcut
    assert "A different visible label" not in markcut


def test_missing_background_flag_fails_validation(manifest):
    markcut = render_markcut(
        manifest,
        asset_paths={"media-001": "assets/original.jpg", "media-002": "assets/capture.mov"},
    ).replace(" isBackground:true", "")
    with pytest.raises(RenderError, match="isBackground"):
        validate_markcut(manifest, markcut)


def test_write_outputs_copies_assets_and_reports_shared_ids(manifest, assets, tmp_path):
    output = tmp_path / "rendered"
    paths = write_outputs(manifest, output, manifest_path=assets / "manifest.json")
    assert paths["book"].is_file()
    assert paths["markcut"].is_file()
    assert (output / "assets/media-001.jpg").read_bytes() == b"original image"
    report = json.loads(paths["verification"].read_text())
    assert report["momentIds"] == [
        "moment-2026-04-18-001",
        "moment-2025-12-31-001",
    ]
    assert report["markcutMomentIds"] == report["momentIds"]
