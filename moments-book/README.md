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

## Dependencies

- shared `phone-harness` skill for user-controlled phone navigation
- Markcut for video authoring/rendering
- optional phone/media metadata access for matching original assets

Phone reachability is an external runtime dependency. If a phone is unavailable,
the run waits and resumes later; the durable project objective is not failed or
reset.
