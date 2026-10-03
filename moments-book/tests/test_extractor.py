from __future__ import annotations

from pathlib import Path

import pytest

from moments_book.extractor import (
    ExtractionCheckpoint,
    MediaObservation,
    PostObservation,
    RealMomentCollector,
    ViewportObservation,
)


class FakeAdapter:
    def __init__(self, viewports, states=None):
        self.viewports = list(viewports)
        self.states = list(states or ["ready"] * 100)
        self.i = 0
        self.scrolls = 0
        self.loads = 0
        self.opened = []

    def connection_state(self):
        return self.states.pop(0) if self.states else "ready"

    def observe_viewport(self):
        value = self.viewports[self.i]
        self.i += 1
        return value

    def scroll_next(self):
        self.scrolls += 1

    def load_more(self):
        self.loads += 1

    def open_media(self, post, media):
        self.opened.append((post.ui_key, media.order))
        suffix = ".mov" if media.kind == "video" else ".png"
        return MediaObservation(
            kind=media.kind,
            order=media.order,
            opened_capture_path=f"media/{post.ui_key}-{media.order}{suffix}",
        )


def post(year=2026, key="a", text="hello", location=None, media=(), date=None):
    return PostObservation(
        year=year,
        posted_date=date,
        text=text,
        location_text=location,
        media=tuple(media),
        evidence=(f"evidence/{key}.json",),
        ui_key=key,
    )


def test_text_only_post_is_one_moment(tmp_path):
    collector = RealMomentCollector(
        FakeAdapter([ViewportObservation((post(),), reached_end=True)]),
        checkpoint_path=tmp_path / "checkpoint.json",
    )
    collector.run()
    manifest = collector.to_manifest()
    assert len(manifest["years"][0]["moments"]) == 1
    assert manifest["years"][0]["moments"][0]["media"] == []


def test_single_photo_opens_fullscreen_capture(tmp_path):
    p = post(media=(MediaObservation("image", 0),))
    adapter = FakeAdapter([ViewportObservation((p,), reached_end=True)])
    collector = RealMomentCollector(adapter, checkpoint_path=tmp_path / "cp.json")
    collector.run()
    media = collector.to_manifest()["years"][0]["moments"][0]["media"]
    assert media[0]["wechatEvidence"] == "media/a-0.png"
    assert adapter.opened == [("a", 0)]


def test_multi_photo_preserves_order(tmp_path):
    p = post(media=(
        MediaObservation("image", 2),
        MediaObservation("image", 0),
        MediaObservation("image", 1),
    ))
    collector = RealMomentCollector(
        FakeAdapter([ViewportObservation((p,), reached_end=True)]),
        checkpoint_path=tmp_path / "cp.json",
    )
    collector.run()
    media = collector.to_manifest()["years"][0]["moments"][0]["media"]
    assert [m["wechatEvidence"] for m in media] == [
        "media/a-0.png", "media/a-1.png", "media/a-2.png"
    ]


def test_video_is_not_reduced_to_still(tmp_path):
    p = post(media=(MediaObservation("video", 0),))
    collector = RealMomentCollector(
        FakeAdapter([ViewportObservation((p,), reached_end=True)]),
        checkpoint_path=tmp_path / "cp.json",
    )
    collector.run()
    media = collector.to_manifest()["years"][0]["moments"][0]["media"][0]
    assert media["kind"] == "video"
    assert media["wechatEvidence"].endswith(".mov")


def test_visible_location_is_separate_from_gps(tmp_path):
    p = post(location="Visible place")
    collector = RealMomentCollector(
        FakeAdapter([ViewportObservation((p,), reached_end=True)]),
        checkpoint_path=tmp_path / "cp.json",
    )
    collector.run()
    moment = collector.to_manifest()["years"][0]["moments"][0]
    assert moment["locationText"] == "Visible place"


def test_duplicate_revisit_dedupes(tmp_path):
    p = post(key="same")
    adapter = FakeAdapter([
        ViewportObservation((p,)),
        ViewportObservation((p,), reached_end=True),
    ])
    collector = RealMomentCollector(adapter, checkpoint_path=tmp_path / "cp.json")
    collector.run()
    assert len(collector.to_manifest()["years"][0]["moments"]) == 1



def test_duplicate_revisit_with_small_ocr_variation_dedupes(tmp_path):
    p1 = post(key=None, text="空气飘着各种香味，各种\n鸟在叫，感觉整个山林都", date="2025-04-06T12:00:00+00:00", year=2025)
    p2 = post(key=None, text="空气飘若各种香味各种\n鸟在叫 感觉整个山林都", date="2025-04-06T12:00:00+00:00", year=2025)
    adapter = FakeAdapter([
        ViewportObservation((p1,)),
        ViewportObservation((p2,), reached_end=True),
    ])
    collector = RealMomentCollector(adapter, checkpoint_path=tmp_path / "cp.json")
    collector.run()
    assert len(collector.checkpoint.moments) == 1

def test_load_more_boundary(tmp_path):
    adapter = FakeAdapter([
        ViewportObservation((post(key="a"),), has_load_more=True),
        ViewportObservation((post(key="b"),), reached_end=True),
    ])
    collector = RealMomentCollector(adapter, checkpoint_path=tmp_path / "cp.json")
    collector.run()
    assert adapter.loads == 1
    assert adapter.scrolls == 0
    assert len(collector.checkpoint.moments) == 2


def test_disconnect_checkpoint_and_resume(tmp_path):
    cp = tmp_path / "checkpoint.json"
    adapter = FakeAdapter(
        [ViewportObservation((post(key="a"),), reached_end=True)],
        states=["blocked"],
    )
    collector = RealMomentCollector(adapter, checkpoint_path=cp)
    state = collector.run()
    assert state.state == "waiting-for-phone"
    assert cp.exists()

    adapter2 = FakeAdapter([ViewportObservation((post(key="a"),), reached_end=True)])
    resumed = RealMomentCollector(adapter2, checkpoint_path=cp)
    resumed.run()
    assert len(resumed.checkpoint.moments) == 1
    assert resumed.checkpoint.state == "complete"


def test_third_year_is_stop_boundary(tmp_path):
    adapter = FakeAdapter([
        ViewportObservation((
            post(2026, "a"),
            post(2025, "b"),
            post(2024, "c"),
        ))
    ])
    collector = RealMomentCollector(adapter, checkpoint_path=tmp_path / "cp.json")
    collector.run()
    assert collector.checkpoint.selected_years == [2026, 2025]
    assert len(collector.checkpoint.moments) == 2
    assert collector.checkpoint.state == "complete"


def test_precise_date_must_match_year(tmp_path):
    p = post(year=2026, date="2025-12-31T12:00:00+00:00")
    collector = RealMomentCollector(
        FakeAdapter([ViewportObservation((p,), reached_end=True)]),
        checkpoint_path=tmp_path / "cp.json",
    )
    with pytest.raises(Exception):
        collector.run()
