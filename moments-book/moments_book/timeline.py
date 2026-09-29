"""Heuristics for turning WeChat Moments album OCR into post/card observations.

The iPhone Mirroring backend exposes pixels + OCR, not an accessibility tree.
This parser uses the date rail as the durable card boundary. It intentionally
does not guess media from pixels; the phone adapter opens the card/media and
fills those slots with observed media.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Iterable
import re

from .extractor import PostObservation


_YEAR = re.compile(r"^(20\d{2})年")
_DATE = re.compile(r"^([0-9]{2,4})月$")


@dataclass(frozen=True)
class CardRegion:
    year: int
    posted_date: str
    top: float
    bottom: float
    text: str | None
    evidence_texts: tuple[str, ...]
    tap_x: float
    tap_y: float

    def to_post(self, *, ui_key: str | None = None) -> PostObservation:
        return PostObservation(
            year=self.year,
            posted_date=self.posted_date,
            text=self.text,
            location_text=None,
            evidence=(),
            ui_key=ui_key,
        )


def _compact_digits(text: str) -> str:
    return "".join(ch for ch in text if ch.isdigit())


def date_candidates(token: str) -> list[tuple[int, int]]:
    """Return possible (month, day) pairs for OCR like '297月' or '111月'."""
    m = _DATE.fullmatch(token.strip())
    if not m:
        return []
    digits = m.group(1).lstrip("0") or "0"
    candidates: list[tuple[int, int]] = []
    # Split into day prefix + month suffix. Prefer valid calendar pairs only.
    original = m.group(1)
    for split in range(1, len(original)):
        day_s, month_s = original[:split], original[split:]
        try:
            day, month = int(day_s), int(month_s)
        except ValueError:
            continue
        if 1 <= month <= 12 and 1 <= day <= 31:
            candidates.append((month, day))
    # A two-digit token such as 8月 is usually OCR'd as 08月.
    if len(original) <= 2:
        try:
            day = int(original)
            if 1 <= day <= 31:
                candidates.append((0, day))
        except ValueError:
            pass
    return candidates


def choose_date(token: str, *, previous: tuple[int, int] | None = None) -> tuple[int, int] | None:
    candidates = [c for c in date_candidates(token) if c[0] != 0]
    if not candidates:
        return None
    if previous is None:
        # Prefer the split with the longest day prefix. This resolves 148 -> 14/8.
        return candidates[0]
    prev_month, prev_day = previous
    descending = [
        c for c in candidates
        if c[0] < prev_month or (c[0] == prev_month and c[1] <= prev_day)
    ]
    if descending:
        # Choose the closest date not newer than the previous card.
        return max(descending, key=lambda c: (c[0], c[1]))
    return candidates[0]


def _year_from_boxes(boxes: Iterable[dict[str, Any]], default_year: int | None) -> int | None:
    for box in boxes:
        m = _YEAR.match(str(box.get("text", "")).strip())
        if m:
            return int(m.group(1))
    return default_year


def card_regions_from_ocr(
    boxes: list[dict[str, Any]],
    *,
    default_year: int | None = None,
    right_column_x: float | None = None,
    viewport_bottom: float | None = None,
) -> list[CardRegion]:
    """Segment one album viewport using the left-hand WeChat date rail.

    Coordinates may be global Mac screen coordinates.  Only relative x/y
    ordering is used.
    """
    year = _year_from_boxes(boxes, default_year)
    if year is None:
        return []

    date_boxes: list[tuple[dict[str, Any], tuple[int, int]]] = []
    previous: tuple[int, int] | None = None
    for box in sorted(boxes, key=lambda b: float(b.get("y", 0))):
        token = str(box.get("text", "")).strip()
        chosen = choose_date(token, previous=previous)
        if chosen is None:
            continue
        date_boxes.append((box, chosen))
        previous = chosen
    if not date_boxes:
        return []

    if right_column_x is None:
        left_dates = [float(box.get("x", 0)) for box, _ in date_boxes]
        date_right = max(float(box.get("x", 0)) + float(box.get("w", 0)) for box, _ in date_boxes)
        right_column_x = date_right + 20

    bottom_limit = viewport_bottom
    if bottom_limit is None:
        bottom_limit = max(float(b.get("y", 0)) + float(b.get("h", 0)) for b in boxes) + 1

    regions: list[CardRegion] = []
    for i, (marker, (month, day)) in enumerate(date_boxes):
        top = float(marker.get("y", 0)) - 8
        bottom = (
            float(date_boxes[i + 1][0].get("y", 0)) - 8
            if i + 1 < len(date_boxes)
            else float(bottom_limit)
        )
        lines: list[tuple[float, str]] = []
        for box in boxes:
            x = float(box.get("x", 0))
            y = float(box.get("y", 0))
            text = str(box.get("text", "")).strip()
            if not text or x < right_column_x or not (top <= y < bottom):
                continue
            if text in {"相册", "前往设置", "加载更多"} or _YEAR.match(text):
                continue
            lines.append((y, text))
        lines.sort()
        texts = tuple(text for _, text in lines)
        text = "\n".join(texts) if texts else None
        try:
            posted = date(year, month, day).isoformat() + "T12:00:00+00:00"
        except ValueError:
            continue
        tap_x = right_column_x + 80
        tap_y = max(top + 12, min(bottom - 12, float(marker.get("y", 0)) + 18))
        regions.append(
            CardRegion(
                year=year,
                posted_date=posted,
                top=top,
                bottom=bottom,
                text=text,
                evidence_texts=texts,
                tap_x=tap_x,
                tap_y=tap_y,
            )
        )
    return regions
