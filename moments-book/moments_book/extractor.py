"""Real-post extraction state machine for WeChat Moments.

The collector deliberately separates phone UI automation from normalization.  A
phone-harness adapter supplies structured viewport/card observations and captures
opened media; this module owns de-duplication, checkpointing, chronology, and the
canonical manifest shape.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any, Iterable, Protocol
import json
import re
from difflib import SequenceMatcher

from .manifest import validate_manifest


class ExtractionError(RuntimeError):
    """Raised when a run cannot be normalized safely."""


@dataclass(frozen=True)
class MediaObservation:
    kind: str
    order: int
    evidence_path: str | None = None
    opened_capture_path: str | None = None
    uncertainty: str | None = None

    def __post_init__(self) -> None:
        if self.kind not in {"image", "video", "unknown"}:
            raise ExtractionError(f"unsupported media kind: {self.kind}")
        if self.order < 0:
            raise ExtractionError("media order must be >= 0")


@dataclass(frozen=True)
class PostObservation:
    """One UI observation of one actual WeChat post/card."""

    year: int
    posted_date: str | None
    text: str | None
    location_text: str | None
    media: tuple[MediaObservation, ...] = ()
    evidence: tuple[str, ...] = ()
    ocr_uncertainty: tuple[str, ...] = ()
    ui_key: str | None = None

    def fingerprint(self) -> str:
        """Stable identity for revisit de-duplication within a private run."""
        material = {
            "year": self.year,
            "posted_date": self.posted_date,
            "text": self.text or "",
            "location_text": self.location_text or "",
            "media_kinds": [m.kind for m in sorted(self.media, key=lambda x: x.order)],
            # ui_key is useful when two posts have identical visible text/media.
            "ui_key": self.ui_key,
        }
        encoded = json.dumps(material, ensure_ascii=False, sort_keys=True).encode()
        return sha256(encoded).hexdigest()


@dataclass(frozen=True)
class ViewportObservation:
    posts: tuple[PostObservation, ...]
    has_load_more: bool = False
    reached_end: bool = False
    evidence: tuple[str, ...] = ()


@dataclass
class ExtractionCheckpoint:
    schema_version: int = 1
    selected_years: list[int] = field(default_factory=list)
    seen_fingerprints: list[str] = field(default_factory=list)
    moments: list[dict[str, Any]] = field(default_factory=list)
    next_sequence_by_year: dict[str, int] = field(default_factory=dict)
    pagination_count: int = 0
    viewport_count: int = 0
    state: str = "collecting"
    last_error: str | None = None

    @classmethod
    def load(cls, path: str | Path) -> "ExtractionCheckpoint":
        value = json.loads(Path(path).read_text(encoding="utf-8"))
        if value.get("schema_version") != 1:
            raise ExtractionError("unsupported checkpoint schema_version")
        return cls(**value)

    def save(self, path: str | Path) -> None:
        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        tmp = destination.with_suffix(destination.suffix + ".tmp")
        tmp.write_text(json.dumps(asdict(self), ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(destination)


class PhoneMomentsAdapter(Protocol):
    """Minimal UI contract implemented by a phone-harness driver."""

    def connection_state(self) -> str: ...
    def observe_viewport(self) -> ViewportObservation: ...
    def scroll_next(self) -> None: ...
    def load_more(self) -> None: ...
    def open_media(self, post: PostObservation, media: MediaObservation) -> MediaObservation: ...


def _posted_at(post: PostObservation) -> str | None:
    if not post.posted_date:
        return None
    raw = post.posted_date
    # Prefer explicit ISO date/timestamp supplied by the UI adapter.
    try:
        value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ExtractionError(f"posted_date must be ISO-8601: {raw}") from exc
    if value.year != post.year:
        raise ExtractionError(f"posted_date {raw} does not belong to year {post.year}")
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _moment_from_post(post: PostObservation, sequence: int) -> dict[str, Any]:
    moment_id = f"m-{post.year}-{sequence:04d}"
    media_items: list[dict[str, Any]] = []
    for item in sorted(post.media, key=lambda x: x.order):
        evidence_path = item.opened_capture_path or item.evidence_path
        media_items.append(
            {
                "id": f"{moment_id}-media-{item.order + 1:02d}",
                "kind": item.kind,
                "wechatEvidence": evidence_path,
                "capturedAt": None,
                "originalMatch": {"status": "unknown", "confidence": None, "evidence": []},
                "gps": {
                    "status": "unknown",
                    "latitude": None,
                    "longitude": None,
                    "altitudeMeters": None,
                },
            }
        )
    evidence = list(post.evidence)
    evidence.extend(f"ocr-uncertain:{item}" for item in post.ocr_uncertainty)
    moment = {
        "id": moment_id,
        "postedAt": _posted_at(post),
        "text": post.text,
        "locationText": post.location_text,
        "sourceEvidence": evidence or [f"post-fingerprint:{post.fingerprint()}"],
        "media": media_items,
    }
    return moment


class RealMomentCollector:
    """Stateful one-post-one-Moment collector with resumable checkpoints."""

    def __init__(
        self,
        adapter: PhoneMomentsAdapter,
        *,
        checkpoint_path: str | Path,
        target_year_count: int = 2,
    ) -> None:
        self.adapter = adapter
        self.checkpoint_path = Path(checkpoint_path)
        self.target_year_count = target_year_count
        if self.checkpoint_path.exists():
            self.checkpoint = ExtractionCheckpoint.load(self.checkpoint_path)
        else:
            self.checkpoint = ExtractionCheckpoint()

    def _save(self) -> None:
        self.checkpoint.save(self.checkpoint_path)

    @staticmethod
    def _normalized_text(value: str | None) -> str:
        if not value:
            return ""
        return re.sub(r"\s+", "", value).replace("…", "").lower()

    def _is_duplicate(self, post: PostObservation, fp: str) -> bool:
        if fp in self.checkpoint.seen_fingerprints:
            return True
        posted = _posted_at(post)
        incoming = self._normalized_text(post.text)
        if not incoming or posted is None:
            return False
        for moment in self.checkpoint.moments:
            if moment.get("postedAt") != posted:
                continue
            existing = self._normalized_text(moment.get("text"))
            if not existing:
                continue
            if SequenceMatcher(None, incoming, existing).ratio() >= 0.82:
                return True
        return False

    def _accept_post(self, post: PostObservation) -> bool:
        fp = post.fingerprint()
        if self._is_duplicate(post, fp):
            return False

        if post.year not in self.checkpoint.selected_years:
            if len(self.checkpoint.selected_years) >= self.target_year_count:
                return False
            self.checkpoint.selected_years.append(post.year)

        key = str(post.year)
        sequence = self.checkpoint.next_sequence_by_year.get(key, 1)
        opened_media: list[MediaObservation] = []
        for media in sorted(post.media, key=lambda x: x.order):
            if media.opened_capture_path:
                opened_media.append(media)
                continue
            try:
                opened = self.adapter.open_media(post, media)
                opened_media.append(opened)
            except Exception as exc:  # opened-media failure falls back to card evidence
                opened_media.append(
                    MediaObservation(
                        kind=media.kind,
                        order=media.order,
                        evidence_path=media.evidence_path,
                        uncertainty=f"opened-media-unavailable:{type(exc).__name__}",
                    )
                )

        normalized = PostObservation(
            year=post.year,
            posted_date=post.posted_date,
            text=post.text,
            location_text=post.location_text,
            media=tuple(opened_media),
            evidence=post.evidence,
            ocr_uncertainty=post.ocr_uncertainty,
            ui_key=post.ui_key,
        )
        self.checkpoint.moments.append(_moment_from_post(normalized, sequence))
        self.checkpoint.next_sequence_by_year[key] = sequence + 1
        self.checkpoint.seen_fingerprints.append(fp)
        self._save()
        return True

    def consume_viewport(self, viewport: ViewportObservation) -> int:
        accepted = 0
        self.checkpoint.viewport_count += 1
        for post in viewport.posts:
            # Stop at the first post belonging to the third distinct year.
            if (
                post.year not in self.checkpoint.selected_years
                and len(self.checkpoint.selected_years) >= self.target_year_count
            ):
                self.checkpoint.state = "complete"
                self._save()
                return accepted
            accepted += int(self._accept_post(post))
        if viewport.reached_end:
            self.checkpoint.state = "complete"
        self._save()
        return accepted

    def run(self, *, max_viewports: int | None = None) -> ExtractionCheckpoint:
        processed = 0
        while self.checkpoint.state != "complete":
            state = self.adapter.connection_state()
            if state != "ready":
                self.checkpoint.state = "waiting-for-phone"
                self.checkpoint.last_error = f"phone-state:{state}"
                self._save()
                return self.checkpoint

            self.checkpoint.state = "collecting"
            self.checkpoint.last_error = None
            viewport = self.adapter.observe_viewport()
            self.consume_viewport(viewport)
            processed += 1
            if self.checkpoint.state == "complete":
                break
            if max_viewports is not None and processed >= max_viewports:
                break
            if viewport.has_load_more:
                self.adapter.load_more()
                self.checkpoint.pagination_count += 1
                self._save()
            else:
                self.adapter.scroll_next()
        return self.checkpoint

    def to_manifest(self) -> dict[str, Any]:
        grouped: dict[int, list[dict[str, Any]]] = {}
        for moment in self.checkpoint.moments:
            match = re.match(r"m-(\d{4})-", moment["id"])
            if not match:
                raise ExtractionError(f"invalid generated Moment id: {moment['id']}")
            grouped.setdefault(int(match.group(1)), []).append(moment)

        years = []
        for year in self.checkpoint.selected_years:
            moments = grouped.get(year, [])
            # Preserve collection order. Precise postedAt values, when present, are
            # checked by the canonical manifest validator.
            years.append({"year": year, "moments": moments})

        manifest = {
            "schemaVersion": 1,
            "source": {
                "kind": "wechat-moments",
                "collector": "phone-harness",
                "capturePath": "iphone-mirroring",
                "fidelity": "display-derived",
            },
            "selection": {
                "mode": "latest-distinct-years",
                "yearCount": self.target_year_count,
                "years": list(self.checkpoint.selected_years),
            },
            "years": years,
        }
        return validate_manifest(manifest)
