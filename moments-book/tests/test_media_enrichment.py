import copy

import pytest

from moments_book import (
    EnrichmentError,
    OriginalMedia,
    enrich_manifest,
    match_original_media,
    validate_manifest,
)


def _manifest(**media_overrides):
    media = {
        "id": "media-001",
        "kind": "image",
        "width": 4000,
        "height": 3000,
        "originalMatch": {"status": "unknown"},
        "gps": {"status": "unknown"},
    }
    media.update(media_overrides)
    return {
        "schemaVersion": 1,
        "source": {"kind": "wechat-moments", "collector": "phone-harness"},
        "years": [{
            "year": 2026,
            "moments": [{
                "id": "moment-001",
                "postedAt": "2026-04-18T10:00:00Z",
                "text": "Synthetic memory",
                "locationText": "A visible place label",
                "media": [media],
            }],
        }],
    }


def _originals(captured_at="2026-04-18T09:00:00Z", **overrides):
    values = {
        "id": "original-001",
        "path": "runs/example/media/original.jpg",
        "kind": "image",
        "captured_at": captured_at,
        "width": None,
        "height": None,
        "similarity": 1.0,
    }
    values.update(overrides)
    return [OriginalMedia(**values)]


def _matched_metadata():
    return {
        "EXIF:DateTimeOriginal": "2026-04-18 09:00:00",
        "EXIF:GPSLatitude": 1.5,
        "EXIF:GPSLongitude": -2.5,
        "EXIF:GPSAltitude": 12.5,
    }


def test_match_requires_multiple_independent_evidence():
    manifest = _manifest()
    result = match_original_media(manifest, _originals(captured_at=None, kind="unknown"))

    assert result["media-001"].status == "unmatched"
    assert result["media-001"].evidence == ("match:insufficient-independent-evidence",)


def test_two_evidence_sources_can_match_a_unique_original():
    manifest = _manifest()
    result = match_original_media(manifest, _originals())

    assert result["media-001"].status == "matched"
    assert set(result["media-001"].evidence) == {"evidence:capture-time", "evidence:media-kind", "evidence:visual-similarity"}


def test_ambiguous_candidates_are_not_promoted_to_matched():
    manifest = _manifest()
    result = match_original_media(manifest, _originals() + _originals(id="original-002", path="runs/example/media/two.jpg"))

    assert result["media-001"].status == "unmatched"
    assert result["media-001"].evidence[0] == "match:ambiguous-original-001-original-002"


def test_unavailable_originals_remain_unknown_and_do_not_change_manifest():
    manifest = _manifest()
    result = match_original_media(manifest, [])
    enriched, issues = enrich_manifest(manifest, [])

    assert result["media-001"].status == "unknown"
    assert issues == []
    assert enriched == manifest
    validate_manifest(enriched)


def test_match_preserves_observed_metadata_and_separate_location_text():
    manifest = _manifest()
    enriched, issues = enrich_manifest(
        manifest,
        _originals(metadata=_matched_metadata()),
    )

    moment = enriched["years"][0]["moments"][0]
    media = enriched["years"][0]["moments"][0]["media"][0]
    assert issues == []
    assert media["originalMatch"]["status"] == "matched"
    assert media["originalAsset"] == "runs/example/media/original.jpg"
    assert moment["locationText"] == "A visible place label"
    assert media["originalCaptureTime"] == {
        "status": "observed",
        "value": "2026-04-18 09:00:00",
        "source": "exif",
        "evidence": ["original-metadata:exif-capture-time"],
    }
    assert media["gps"] == {
        "status": "observed",
        "latitude": 1.5,
        "longitude": -2.5,
        "altitudeMeters": 12.5,
        "evidence": ["original-metadata:gps"],
    }
    validate_manifest(enriched)


def test_quicktime_capture_can_exist_without_gps():
    manifest = _manifest()
    original = _originals(
        metadata={"QuickTime:CreationDate": "2026-04-18T09:00:00+00:00"},
    )[0]
    enriched, issues = enrich_manifest(manifest, [original])
    media = enriched["years"][0]["moments"][0]["media"][0]

    assert issues == []
    assert media["capturedAt"] == "2026-04-18T09:00:00+00:00"
    assert media["originalCaptureTime"]["source"] == "quicktime"
    assert media["gps"] == {"status": "missing"}
    validate_manifest(enriched)


def test_text_location_is_never_promoted_to_gps(monkeypatch):
    manifest = _manifest()
    monkeypatch.setattr(
        "moments_book.media_enrichment.read_original_metadata",
        lambda path: {},
    )
    enriched, issues = enrich_manifest(manifest, _originals())
    media = enriched["years"][0]["moments"][0]["media"][0]
    moment = enriched["years"][0]["moments"][0]

    assert issues == []
    assert moment["locationText"] == "A visible place label"
    assert media["gps"] == {"status": "missing"}
    assert "latitude" not in media["gps"]
    validate_manifest(enriched)


def test_metadata_failure_keeps_the_match_without_inventing_metadata(monkeypatch):
    manifest = _manifest()

    def fail(path):
        raise EnrichmentError(f"{path}: unavailable")

    monkeypatch.setattr("moments_book.media_enrichment.read_original_metadata", fail)
    enriched, issues = enrich_manifest(manifest, _originals())
    media = enriched["years"][0]["moments"][0]["media"][0]

    assert len(issues) == 1
    assert media["originalMatch"]["status"] == "matched"
    assert media["gps"] == {"status": "unknown"}
    assert media["originalCaptureTime"] == {
        "status": "unknown",
        "value": None,
        "source": None,
    }
    validate_manifest(enriched)


def test_invalid_similarity_is_rejected_before_matching():
    with pytest.raises(EnrichmentError, match="similarity"):
        match_original_media(_manifest(), _originals(similarity=1.5))
