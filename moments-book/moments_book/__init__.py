"""Reusable Moments Book manifest contract."""

from .manifest import ManifestValidationError, validate_manifest
from .media_enrichment import (
    EnrichmentError,
    OriginalMedia,
    enrich_manifest,
    match_original_media,
    read_original_metadata,
)
from .renderers import (
    RenderError,
    render_book,
    render_markcut,
    validate_markcut,
    verify_outputs,
    write_outputs,
)

__all__ = [
    "EnrichmentError",
    "ManifestValidationError",
    "OriginalMedia",
    "enrich_manifest",
    "match_original_media",
    "read_original_metadata",
    "RenderError",
    "render_book",
    "render_markcut",
    "validate_manifest",
    "validate_markcut",
    "verify_outputs",
    "write_outputs",
]
