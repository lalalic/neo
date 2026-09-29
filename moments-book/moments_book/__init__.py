"""Reusable Moments Book manifest contract."""

from .manifest import ManifestValidationError, validate_manifest
from .extractor import (
    ExtractionCheckpoint,
    ExtractionError,
    MediaObservation,
    PhoneMomentsAdapter,
    PostObservation,
    RealMomentCollector,
    ViewportObservation,
)
from .timeline import CardRegion, card_regions_from_ocr, choose_date, date_candidates
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
    "ExtractionCheckpoint",
    "ExtractionError",
    "MediaObservation",
    "PhoneMomentsAdapter",
    "PostObservation",
    "RealMomentCollector",
    "ViewportObservation",
    "CardRegion",
    "card_regions_from_ocr",
    "choose_date",
    "date_candidates",
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
