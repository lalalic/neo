from moments_book.timeline import card_regions_from_ocr, choose_date, date_candidates


def box(text, x, y, w=45, h=18):
    return {"text": text, "x": x, "y": y, "w": w, "h": h}


def test_date_rail_parser_common_ocr():
    assert (8, 14) in date_candidates("148月")
    assert choose_date("297月") == (7, 29)
    assert choose_date("124月") == (4, 12)
    assert choose_date("3112月") == (12, 31)


def test_ambiguous_111_uses_descending_context():
    assert choose_date("111月", previous=(1, 15)) == (1, 11)


def test_segments_each_date_marker_as_one_post():
    boxes = [
        box("2025年", 1380, 309),
        box("297月", 1379, 350),
        box("早上起来掰点玉米", 1562, 346, 122),
        box("124月", 1378, 454),
        box("正宗川剧真的值得看", 1577, 450, 152),
        box("114月", 1377, 558),
        box("四川老乡想象力太丰富", 1584, 554, 166),
    ]
    cards = card_regions_from_ocr(boxes)
    assert [c.posted_date[:10] for c in cards] == [
        "2025-07-29", "2025-04-12", "2025-04-11"
    ]
    assert cards[0].text == "早上起来掰点玉米"
    assert cards[1].text == "正宗川剧真的值得看"


def test_multiline_text_stays_in_its_card():
    boxes = [
        box("2025年", 1380, 309),
        box("064月", 1379, 448),
        box("空气飘着各种香味，各种", 1584, 446, 166),
        box("鸟在叫，感觉整个山林都", 1584, 467, 166),
        box("醒了", 1587, 488, 100),
        box("033月", 1379, 634),
        box("感觉这样英语学习起来", 1583, 631, 168),
    ]
    cards = card_regions_from_ocr(boxes)
    assert cards[0].posted_date.startswith("2025-04-06")
    assert cards[0].text.splitlines() == [
        "空气飘着各种香味，各种", "鸟在叫，感觉整个山林都", "醒了"
    ]
    assert cards[1].posted_date.startswith("2025-03-03")


def test_default_year_supports_viewport_without_header():
    boxes = [
        box("162月", 1378, 738),
        box("按下100多天的暂停键", 1580, 736, 160),
        box("151月", 1377, 842),
        box("小红书真国际化了", 1567, 839, 135),
        box("111月", 1375, 945),
        box("阳光灿烂日子", 1586, 943, 120),
    ]
    cards = card_regions_from_ocr(boxes, default_year=2025)
    assert [c.posted_date[:10] for c in cards] == [
        "2025-02-16", "2025-01-15", "2025-01-11"
    ]
