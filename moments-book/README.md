# Moments Book

Moments Book turns a consenting user's own WeChat Moments into a private,
chronological memoir that can be rendered both as a book and as one Markcut
video.

The project is reusable. Real accounts, screenshots, extracted Moments,
original photos/videos, GPS coordinates, generated books, rendered videos, and
other personal data belong only under ignored `runs/`.

## Product flow

```text
phone-harness -> own WeChat Moments -> normalized manifest
                                  |-> match original phone media + metadata
                                  |-> book
                                  `-> Markcut memoir video
```

The normalized manifest is the single source of truth for both outputs.

The required baseline media path is documented in docs/baseline-media-extraction.md. It treats iPhone Mirroring captures as display-derived evidence and never as original media or metadata.

## First validation

The first real end-to-end validation uses the project owner's own account and
the latest two available calendar years in that account. This is test evidence,
not product-specific logic.

Success means:

1. phone-harness can navigate to the user's own Moments timeline and extract
   enough structured evidence to reconstruct posts;
2. the latest two available years are captured without duplicates;
3. original phone media is matched where practical so book/video use the
   highest-quality assets available;
4. capture time and GPS are preserved from original media when present and
   remain unknown when absent;
5. one validated manifest drives both a readable book and a Markcut video;
6. the video is structured as memoir -> year -> Moment/story so each year is
   a drill-down sub-tree rather than a separate unrelated video.

## Runtime layout

```text
runs/<YYYY-MM-DD[-slug]>/
├── input/                 # screenshots / captured source evidence
├── media/                 # matched original photos and videos
├── manifest.json          # canonical normalized memoir
├── book/                  # generated book sources/output
├── video/                 # generated Markcut source/output
└── evidence/              # QA and extraction evidence
```

Everything under `runs/` is private runtime state and is ignored by Git.

## Renderers

After a run has a valid `manifest.json`, render both outputs from that one
canonical input:

```sh
python3 -m moments_book.renderers runs/<date-slug>/manifest.json runs/<date-slug>/rendered
```

This writes `book.md`, `video.md`, `verification.json`, and local copies of the
selected media under `assets/`. Matched original media is preferred; otherwise
the renderer uses the phone-harness capture referenced by `wechatEvidence`.
Media metadata, GPS, and the chosen provenance remain explicit in the manifest
and book. Markcut maps are emitted only for `gps.status=observed`.

Run the authoritative Markcut parser after rendering:

```sh
npm exec --yes --package=@lalalic/markcut -- markcut verify runs/<date-slug>/rendered/video.md
```

Then visually review the rendered video before treating the run as complete.

## Dependencies

- shared `phone-harness` skill for user-controlled phone navigation
- Markcut for video authoring/rendering
- optional phone/media metadata access for matching original assets

Phone reachability is an external runtime dependency. If a phone is unavailable,
the run waits and resumes later; the durable project objective is not failed or
reset.

## Rendering

After a canonical manifest and its run-relative media files exist, render either
or both products without changing the manifest:

```sh
python -m moments_book.cli runs/<run>/manifest.json runs/<run>/outputs both
npm exec --yes --package=@lalalic/markcut -- markcut verify \
  runs/<run>/outputs/video/memoir.md
```

`book` writes editable `book.md`, printable `book.html`, and copied assets.
`video` writes one nested `memoir.md` source and copied assets. `both` writes a
`render-summary.json` that records the same ordered Moment IDs used by both
products.
