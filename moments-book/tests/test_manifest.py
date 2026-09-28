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
            "media": [{"id": "media-001", "kind": "image", "originalMatch": {"status": "unknown", "confidence": None}, "gps": {"status": "unknown"}}],
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


def test_duplicate_ids_and_missing_required_fields_fail():
    duplicate = copy.deepcopy(FIXTURE)
    duplicate["years"][1]["moments"][0]["id"] = duplicate["years"][0]["moments"][0]["id"]
    with pytest.raises(ManifestValidationError):
        validate_manifest(duplicate)
    missing = copy.deepcopy(FIXTURE)
    del missing["years"][0]["moments"][0]["media"][0]["gps"]
    with pytest.raises(ManifestValidationError):
        validate_manifest(missing)


def test_public_schema_is_loadable():
    validate_manifest(FIXTURE, Path(__file__).parents[1] / "templates/manifest.schema.json")
