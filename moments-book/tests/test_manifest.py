import copy
from pathlib import Path

import pytest

from moments_book import ManifestValidationError, validate_manifest


FIXTURE = {
    "schemaVersion": 1,
    "source": {"kind": "wechat-moments", "collector": "phone-harness"},
    "selection": {"mode": "latest-distinct-years", "yearCount": 2},
    "years": [
        {"year": 2026, "moments": [{
            "id": "moment-2026-04-18-001", "postedAt": "2026-04-18T10:00:00Z",
            "text": "A synthetic memory", "sourceEvidence": ["fixture"],
            "media": [{
                "id": "media-001",
                "kind": "image",
                "originalAsset": "fixture-original.jpg",
                "originalMatch": {
                    "status": "matched",
                    "confidence": 0.99,
                    "evidence": ["fixture:capture-time-and-dimensions"],
                },
                "gps": {
                    "status": "observed",
                    "latitude": 43.65,
                    "longitude": -79.38,
                    "evidence": ["fixture:original-exif"],
                },
            }],
        }]},
        {"year": 2025, "moments": [{"id": "moment-2025-12-31-001", "postedAt": "2025-12-31T10:00:00Z", "text": None, "media": []}]},
    ],
}


def test_valid_manifest_passes():
    assert validate_manifest(FIXTURE)["schemaVersion"] == 1


@pytest.mark.parametrize("path, value", [
    (("years", 0, "moments", 0, "postedAt"), "2027-01-01T00:00:00Z"),
    (("years", 0, "moments", 0, "media", 0, "gps"), {"status": "observed"}),
    (("years", 0, "moments", 0, "media", 0, "originalMatch"), {"status": "matched", "confidence": 1.2}),
])
def test_invalid_cross_field_contract_fails(path, value):
    manifest = copy.deepcopy(FIXTURE)
    cursor = manifest
    for key in path[:-1]:
        cursor = cursor[key]
    cursor[path[-1]] = value
    with pytest.raises(ManifestValidationError):
        validate_manifest(manifest)


def test_years_and_known_moments_are_newest_first():
    ascending_years = copy.deepcopy(FIXTURE)
    ascending_years["years"].reverse()
    with pytest.raises(ManifestValidationError, match="years must be chronological"):
        validate_manifest(ascending_years)

    unsorted_moments = copy.deepcopy(FIXTURE)
    earlier = copy.deepcopy(unsorted_moments["years"][0]["moments"][0])
    earlier["id"] = "moment-2026-04-17-001"
    earlier["postedAt"] = "2026-04-17T10:00:00Z"
    unsorted_moments["years"][0]["moments"].insert(0, earlier)
    with pytest.raises(ManifestValidationError, match="moments must be chronological"):
        validate_manifest(unsorted_moments)


def test_timestamps_must_be_timezone_aware():
    naive = copy.deepcopy(FIXTURE)
    naive["years"][0]["moments"][0]["postedAt"] = "2026-04-18T10:00:00"
    with pytest.raises(ManifestValidationError, match="timezone offset"):
        validate_manifest(naive)


def test_provenance_claims_require_evidence_and_references():
    missing_match_evidence = copy.deepcopy(FIXTURE)
    match = missing_match_evidence["years"][0]["moments"][0]["media"][0]["originalMatch"]
    del match["evidence"]
    with pytest.raises(ManifestValidationError, match="originalMatch: missing required field 'evidence'"):
        validate_manifest(missing_match_evidence)

    missing_original = copy.deepcopy(FIXTURE)
    del missing_original["years"][0]["moments"][0]["media"][0]["originalAsset"]
    with pytest.raises(ManifestValidationError, match="originalAsset"):
        validate_manifest(missing_original)

    missing_gps_evidence = copy.deepcopy(FIXTURE)
    del missing_gps_evidence["years"][0]["moments"][0]["media"][0]["gps"]["evidence"]
    with pytest.raises(ManifestValidationError, match="gps: missing required field 'evidence'"):
        validate_manifest(missing_gps_evidence)


def test_duplicate_ids_and_missing_required_fields_fail():
    duplicate = copy.deepcopy(FIXTURE)
    duplicate["years"][1]["moments"][0]["id"] = duplicate["years"][0]["moments"][0]["id"]
    with pytest.raises(ManifestValidationError):
        validate_manifest(duplicate)

    duplicate_media = copy.deepcopy(FIXTURE)
    duplicate_media["years"][1]["moments"][0]["media"] = copy.deepcopy(
        duplicate_media["years"][0]["moments"][0]["media"]
    )
    with pytest.raises(ManifestValidationError, match="media ID is duplicated"):
        validate_manifest(duplicate_media)

    missing = copy.deepcopy(FIXTURE)
    del missing["years"][0]["moments"][0]["media"][0]["gps"]
    with pytest.raises(ManifestValidationError):
        validate_manifest(missing)


def test_public_schema_is_loadable():
    validate_manifest(FIXTURE, Path(__file__).parents[1] / "templates/manifest.schema.json")
