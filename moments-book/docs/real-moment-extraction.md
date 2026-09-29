# Real Moment extraction

The production extraction unit is one WeChat post, not one iPhone Mirroring viewport.
The required baseline remains phone-harness + iPhone Mirroring + the authenticated
WeChat app. Phone MCP and original Photos assets are optional enrichment.

## State machine

```text
ensure ready
  -> observe album viewport
  -> segment cards from the date rail
  -> de-duplicate post fingerprints
  -> for each new post
       -> preserve visible date/text/location evidence
       -> open each observed media item
       -> capture the cleanest full-screen display-derived image/video
       -> fall back to card evidence when opening media fails
       -> checkpoint immediately
  -> if 加载更多: load once and checkpoint pagination
  -> otherwise scroll one deterministic step
  -> stop at the first post in the third distinct year
  -> validate canonical manifest
```

`moments_book.timeline.card_regions_from_ocr()` segments the iPhone OCR stream by
the date rail. It handles OCR forms such as `297月` (29 July), `124月` (12
April), and ambiguous forms such as `111月` by preserving descending chronology.
A viewport that omits the year heading inherits the last observed year.

`moments_book.extractor.RealMomentCollector` owns the durable run state. Its
checkpoint records selected years, post fingerprints, Moment records, pagination
count, viewport count, and the next stable per-year sequence. Every accepted post
is checkpointed before the next scroll. A blocked/no-window phone state becomes
`waiting-for-phone`; reconnecting and constructing a collector with the same
checkpoint resumes without duplicating posts.

## Evidence model

A `PostObservation` represents one actual WeChat post/card and carries:

- the calendar year and most precise visible date;
- visible post text and visible location text;
- one ordered `MediaObservation` per observed photo/video;
- private source-evidence paths and OCR uncertainty;
- an optional UI key used only to distinguish visually identical posts.

Media capture is opened-media first. The adapter attempts to open every media
item in WeChat and records the resulting full-screen display-derived capture. If
that read-only action fails, the collector keeps the timeline/card evidence as
a fallback and continues. It never promotes visible place text to GPS.

## Read-only boundary

The phone adapter may navigate, scroll, expand text, open media, close media, and
activate `加载更多`. It must not like, comment, post, delete, send, change privacy
settings, or save into Photos as part of the required baseline.

## Tests

Synthetic tests cover text-only, one-photo, multi-photo, video, visible-location,
duplicate revisit, loading-more pagination, disconnect/resume, third-year stop,
and OCR date-rail segmentation. Private real-phone evidence remains under ignored
`runs/` and is never committed.
