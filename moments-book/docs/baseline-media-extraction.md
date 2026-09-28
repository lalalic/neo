# Baseline media extraction: phone-harness + iPhone Mirroring only

This document defines the minimum viable media path when Moments Book has no
Phone MCP access, no Photos-library API, no exported originals, and no direct
phone filesystem access.

## Proven boundary

The shared `phone-harness` iPhone backend does not receive original WeChat or
Photos assets. iPhone Mirroring renders the phone as a Mac window; the harness
captures that window as PNG pixels and uses Vision OCR over those captures.
The capture implementation uses a specific-window capture when possible and a
window-rectangle capture as fallback.

Therefore baseline media is **display-derived evidence**:

- it is suitable for a usable private book and memoir video;
- it is not an original photo/video asset;
- its pixel dimensions are the Mirroring capture dimensions, not proof of the
  source asset's dimensions;
- EXIF, QuickTime source metadata, GPS, altitude, and original capture time are
  not preserved by the window capture and remain unknown;
- compression/cropping performed upstream by WeChat or by the displayed view
  cannot be reversed;
- visible UI overlays are part of the pixels unless the collector deliberately
  opens a cleaner full-screen view before capture.

This is the required degradation floor. Original-media or Phone MCP enrichment
may replace display-derived media later, but failure to enrich must never make a
baseline run invalid.

## Practical strategies

### Still images

Preferred order:

1. Open the Moment and then the individual image in the cleanest available
   full-screen WeChat viewer.
2. Wait for visible loading/animation to settle.
3. Capture the iPhone Mirroring window with `phone-harness` `screenshot()`.
4. Record the capture file as private run evidence under `runs/.../input/` and
   store only its run-relative reference in the manifest.
5. Record whether UI chrome is visible and whether an additional crop was
   applied. Cropping is an editorial transform of display pixels, not recovery
   of the original asset.
6. If the UI exposes a safe, read-only Save/Export action, it may be attempted
   as an enrichment path, but the baseline must not depend on it.

The captured PNG is lossless with respect to the pixels delivered by the Mac
window capture, but those pixels may already be downscaled/compressed/cropped by
WeChat and iPhone Mirroring.

### Videos

The baseline must preserve motion, not silently substitute a poster frame.

Preferred order:

1. Open the Moment video in its cleanest full-screen playback view.
2. Record the Mirroring window or its exact screen rectangle while playback is
   active. macOS `screencapture` supports video recording (`-v`) and bounded
   duration (`-V`); the exact region must be re-derived from the current
   Mirroring window rather than cached because the window can move.
3. If automated region video capture is unavailable or fails, capture a
   deterministic frame sequence during playback and generate a clearly labeled
   display-derived clip from those frames. This is lower fidelity but still
   preserves visible motion better than a single thumbnail.
4. Audio is optional on the baseline path. Do not claim the WeChat video's
   original audio unless it was actually captured and verified. macOS
   `screencapture -g/-G` records Mac input devices, not proof of source-stream
   audio.
5. DRM/protected playback may render black in the Mirroring capture. Treat that
   item as unavailable display evidence and preserve its Moment/media slot with
   explicit uncertainty rather than inventing content.

For either video strategy, measure the produced file with a media probe such as
`ffprobe`: container, codec, display width/height, frame rate, duration, and file
size are properties of the **derived capture**, not the source WeChat asset.

## Measurement contract

For every baseline media capture record:

| Field | Meaning |
| --- | --- |
| `source` | `phone-harness/iphone-mirroring-window` |
| `fidelity` | `display-derived` |
| `captureKind` | `still-frame` or `screen-recording` |
| `bytes` | size of the derived capture |
| `width` / `height` | derived capture pixels when measurable |
| `container` / `codec` | derived file properties |
| `capturedAt` | collector clock time, never original media time |
| `cropApplied` | whether Moments Book changed the captured rectangle |
| `overlayState` | `none-observed`, `present`, or `unknown` |
| `sourceMetadataPreserved` | always `false` for baseline window capture |
| `originalCaptureTime` | status object: `observed`, `missing`, or `unknown` |
| `gps` | `unknown` unless later original-media enrichment proves it |
| `locationText` | separate visible WeChat text; never promoted to GPS |

`moments_book.baseline_capture.probe_baseline_capture()` implements the
privacy-safe derived-file measurement portion of this contract.

## Capability matrix

| Capability | A: Mirroring only | B: + originals | C: + Phone MCP | D: + both |
| --- | --- | --- | --- | --- |
| Own-Moments navigation | required | required | required | required |
| Chronology/text/location text | visible UI/OCR | same | may add structured evidence | best available |
| Still media | display-derived PNG | prefer matched original | baseline plus any MCP asset access | prefer matched original |
| Video | display-derived screen recording/frame clip | prefer matched original video | baseline plus any MCP asset access | prefer matched original |
| Original dimensions | unknown | observed when matched | observed only if MCP proves them | observed when proved |
| Original capture time | unknown | observed from metadata when present | observed only if MCP proves it | observed when proved |
| GPS/altitude | unknown | observed only from matched original metadata | observed only if MCP proves it | observed when proved |
| Completion allowed without enrichment | yes | yes | yes | yes |

## Optional enrichment adapter

`moments_book.media_enrichment.match_original_media()` scores unique
original candidates from capture-time proximity, visual similarity, media kind,
dimensions, and sibling ordering. A match requires confidence of at least `0.9`
and at least two positive evidence signals; a close second candidate remains
`unmatched` with ambiguity evidence.

`enrich_manifest()` preserves the baseline when no original library is
available. When a match is accepted, it reads the minimum ExifTool date/GPS
tags, records EXIF or QuickTime provenance, and preserves timezone-naive EXIF
times in `originalCaptureTime` without claiming timezone-correct `capturedAt`.
Checked-but-absent metadata is `missing`; unreadable metadata is `unknown`.
Invalid or out-of-range coordinates are also unknown. Visible WeChat location
text stays in `locationText` and is never promoted to GPS. Original paths,
metadata, and coordinates remain private run data.

## Graceful-degradation rules

1. Scenario A is a complete product path, not an error mode.
2. A captured full-screen image/video may be used directly in book/video output
   with display-derived provenance.
3. Unknown original timestamp/GPS/dimensions are valid values. Never fill them
   from filename, OCR text, visible place names, or capture file metadata.
4. B/C/D can replace a baseline media reference only when identity is supported
   by explicit matching evidence and confidence.
5. Enrichment failure leaves the baseline asset and provenance unchanged.
6. Video that cannot be recorded remains represented in chronology with
   explicit unavailable/uncertain evidence; the run continues.
7. All real captures, recordings, OCR, derived clips, and probe reports stay
   under ignored `runs/`.
