# Working on Moments Book

Read the Neo root `AGENTS.md` first. This project follows the universal Neo
run/privacy contract.

## Owned outcome

Given a consenting user's reachable phone, create a private chronological memoir
from that user's own WeChat Moments and produce both:

- a book artifact; and
- one Markcut memoir video whose nested scene tree drills down by year and then
  by individual Moment/story.

Both outputs MUST derive from the same canonical run manifest.

## Extraction contract

- Use the shared `phone-harness` skill for WeChat/iPhone interaction.
- Navigate to the user's own Moments album, not the general friends feed.
- Observe before acting and verify every navigation step.
- Extraction is read-only by default. Never like, comment, post, delete, send,
  or change account settings as part of memoir collection.
- Preserve visible post date, text, media count/order, and visible location
  text when available.
- De-duplicate overlapping scroll viewports before persisting a post.
- Treat OCR as evidence, not perfect truth. Keep enough source evidence in the
  private run to audit uncertain text.

## Media and location contract

- Prefer original phone photo/video assets over WeChat thumbnails when they can
  be matched safely.
- Match using evidence such as capture time, visual similarity, ordering, and
  dimensions; record match confidence rather than assuming identity.
- Preserve original EXIF/QuickTime capture metadata and GPS when present.
- Never invent GPS. A place inferred from Moment text is `location_text`, not
  `gps`.
- Keep raw coordinates and personal media only inside ignored `runs/`.

## Canonical manifest

`runs/.../manifest.json` is the canonical intermediate product. Book and video
generators read it; neither scraper nor renderer owns a second competing data
model. The reusable schema is in `templates/manifest.schema.json`.

## Markcut structure

Use nested Markcut scenes, not separate year videos:

```text
# video
  ## year-YYYY
    ### moment-...
    ### moment-...
  ## year-YYYY
    ### moment-...
```

The root is the complete memoir video. H2 year scenes are parent sections. H3
Moment/story scenes are their drill-down children. Static imagery under narrated
scenes uses `isBackground:true`; narration controls duration.

## First real validation

Use the project owner's private run as the first E2E test and process the latest
two available years. Do not hard-code those calendar years: discover them from
the user's own timeline because the latest visible years may differ over time.

## Autonomous execution

Phone unreachability is a resumable external dependency. When phone-harness
reports the phone is unavailable, preserve progress and mark the execution
blocked/waiting for the phone rather than retry-looping, clearing data, or
failing the overall objective.

## Quality gates

Before calling a run complete:

1. no committed private data;
2. manifest validates against the schema;
3. latest-two-year range is complete enough to explain any known gaps;
4. media matches and GPS claims carry evidence/confidence;
5. book and video reference the same Moment IDs;
6. Markcut source verifies and rendered output is visually reviewed.

## Project learnings


- 2026-09-29: iPhone Mirroring may report `session state: ready` while phone-harness window capture still returns 0 bytes. Before real extraction, require `phone-harness --doctor ios` to pass `window capture works`; if it says Screen Recording permission needs a terminal restart, treat the run as externally blocked rather than retrying WeChat navigation.
