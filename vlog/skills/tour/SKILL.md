---
name: vlog-tour
description: Record reusable real speech and video for a Vlog using Capture Tour on Neo.app (Mac) or Neo Mobile (iPhone). Use one private tour-director.json as both the recording guide and media index; Director or Editor can invoke it on demand.
---

# Vlog Capture Tour — record once, reuse responsibly

**Goal:** Director or Editor can ask the owner to record useful material on **Neo.app for Mac** or **Neo Mobile on iPhone**, then use that accepted recording in a later Vlog without creating a second manifest, index or CLI.

## One source of truth

`<vlog-root>/assets/personal-library/` is private and Git-ignored:

```text
personal-library/
  tour-director.json       # Tour prompts AND index of accepted takes
  pv01-weekend-walk-opening-20261107-take01.mov
  pv02-funny-neighborhood-encounter-20261107-take01.mov
```

The existing `tour-director.json` owns both the recording instructions and all media references. Do not create `manifest.json`, `catalog.json`, per-Tour folders, another library profile or another index.

**Record format** (`version: 1`):

- Root: `version`, `tour_id`, `title`, ordered `shots[]`; optional private `index_schema_version` and `library_policy`.
- Each shot is a Tour instruction: `id`, `title`, `filename_hint` (an English descriptive slug such as `natural-opening`), `kind`, `instruction`, `script`, `camera`, `orientation`, `framing`, `quality`, `notes` and optional timing fields. It also owns a private `library` object.
- `shots[].library`: `status` (`unrecorded` or `archived`), `active_recording_id` (or `null`), `recordings[]`, and `use_policy`.
- Each accepted entry in `recordings[]` contains `recording_id`, **`title`** (short human-readable actual-clip label), **`description`** (what is really said/shown, useful to Editor), `status: "archived"`, `media_path` (descriptive basename), `sha256`, `duration_s`, `captured_at`, `source_tour_session_id`, `source_media_reference`, optional `topics`, `transcript_path` and `public_use_approved`. Keep old takes and update `active_recording_id` to select a newer one.
- Filename convention: `<shot_id>-<actual-content-slug>-<YYYYMMDD>-<recording_id>.<actual-extension>` (e.g. `pv01-weekend-walk-opening-20261107-take01.mov`). The slug has **two or more meaningful words** about the *accepted clip*, preferably derived from listening/transcript/visual review; `filename_hint` is a starting suggestion, **not a claim** about actual content. Keep the capture-local calendar date, shot ID and unique take ID. The basename must be recognizable in Finder without opening the index. Avoid secrets and exact private addresses.
- `media_path` must be an original local regular video (`.mov`, `.mp4`, `.m4v`) or audio (`.m4a`, `.wav`) file **in the same directory**, never a nested path, remote URL or symlink. An unrecorded prompt is **not** footage.

Use `<vlog-root>/lib/tour-director-index.mjs`'s `validateTourDirector`, `appendTourRecording` and `selectTourReferences` when updating/selecting the JSON; these are pure library helpers, **not** a CLI or another storage layer.

## Record on either device

1. **Director** may request a Tour when a real personal introduction, observation or story bridge would improve the narrative. **Editor** may request a Tour when an authentic voice/video pickup or reaction is needed for the planned timeline. Do not make a new Tour mandatory for ordinary Vlog processing.
2. Pick the connected device for the actual recording: **Neo.app → Mac camera/microphone**; **Neo Mobile → iPhone camera/microphone**. Both expose Capture Tour. Discover the currently connected provider's real tool names, input schema and export mechanisms via its available tool discovery (`tools/list` where MCP is used); do not hard-code a single device, port, host or unverified tool args.
3. Read the **same** `tour-director.json`. If a new pickup requires a
   different prompt, add a new uniquely identified shot to that same JSON
   (do not replace old shot IDs or accepted recordings). Build the native
   `tour.start` input from its `version`, `tour_id`, `title` and ordered shot guidance; omit private `library` and `index_*` fields from the tool payload **if the live tool schema is strict**. Do not persist this transient payload as another file.
4. The owner records, re-takes or skips each shot and **accepts** the chosen take. Use the device's `tour.status` result for actual `shot_id`, session, acceptance status and media reference. `tour.cancel` cancels an in-progress Tour only if requested or necessary; it is not an archive operation. Do not infer that merely starting a Tour produced accepted media.
5. For each **accepted** take, obtain the original media from the recording device by its **actual** exported file reference: Neo.app may expose a local export, and Neo Mobile may expose a download reference. Follow the live provider result; do not invent an export URL. Before indexing, review the actual recording sufficiently to give it a short, accurate **`title`** and informative **`description`**; do not copy the prompt text or invent a summary. Save it under the descriptive filename convention directly in `assets/personal-library/`. Validate nonempty media, local path, size and SHA-256 **before** indexing; keep older takes intact.
6. Append the verified take under the matching shot in `tour-director.json`, set `active_recording_id`, and save that **same JSON** safely (no partial writes). Preserve the actual device/session/source identity and capture time. Repeat ingestion is idempotent; never overwrite another accepted take, and never clear device media until local archive verification succeeds. If acceptance, original bytes or required provenance cannot be verified, report the gap instead of making an index entry.

## Use the recording in a Vlog

- Director still writes the story based on `user.md`, relevant old Run history and current Visioner evidence; it may **initiate** Tour recording but must not relabel old takes as today’s events.
- Editor opens `tour-director.json` and uses each recorded take's **filename, title, description and topics** to choose the most relevant clip. The pure `selectTourReferences(index, { allTakes: true })` helper can enumerate older archived alternatives; the default returns active takes only. Verify any chosen file beside the index against its SHA-256 before using it. Filter by shot `notes.topic` or take `topics` as relevant.
- A reference take can guide pacing and natural phrasing without adding historical video to the timeline. If actually inserting historical video/audio, preserve take ID/hash/provenance, copy the chosen media into this Run's private assets, and clearly present it as archival material. No automatic public insertion, voice cloning or fabricated present-day source evidence. Existing Run-scoped publication permissions still apply.
- If the index is missing, empty, the device is unavailable or no take fits, continue the current Vlog normally. Do not substitute prompts or synthesized speech as “recorded Tour” evidence.

## What counts as verified

A complete capture has **Tour acceptance + real exported media + nonempty file + SHA-256 + matching indexed shot + readable archived local file**. A `tour.start` acknowledgment, a planned shot, a private index entry by itself, or an unverified file reference does not qualify.
