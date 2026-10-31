# Cinematic Natural — approved Vlog production rules (2026-10-30)

This is the owner-approved editorial specification; `cinematic-vlog-style.json` is the tracked rendering preset, not permission to publish. Preserve the project's canonical stage approvals and authentic-source requirements.

## Story order

1. Source-grounded hook and fixed, reusable branded opening (2–4 s). A title card must not replace the hook.
2. **Route Overview subvideo** (6–12 s, default 9 s) when at least two chronologically credible GPS fixes survive screening **and** the owner approves location disclosure. If GPS exists but disclosure is pending, block route publication for review, never silently expose coordinates or invent a route. Without suitable GPS, skip only the map scene, not the episode.
3. Personal hook (5–10 s): grounded creator observation, original environment sound, no invented interior feelings.
4. Journey: real clips and sounds, optional intermediate route progress only when it provides meaningful context; GPS-linked shot timing if verifiable.
5. Reflection (5–15 s): creator-approved personal observations and emotional reaction.
6. Route Recap (optional, based on validated points), fixed closing (2–4 s). Do not imply sparse fixes form a recorded driving trace.

The executable P0 Director→Producer handoff and auto-insertion rules are in [geo-story-production.md](../docs/geo-story-production.md).

## Route production contract

- Use `lib/route-subvideo.mjs:planRouteSubvideo(records,{disclosureApproved:true})` only with private original-media metadata, and `lib/gps-route.mjs` for source provenance, outlier screening and public redaction.
- Persist `route.md` and privacy-approved intermediate data in the episode's **private** run; render `route.md` to `route.mp4` with Markcut only after map/video E2E is verified in the target environment.
- Include the rendered `route.mp4` as an ordinary `- video src:assets/route.mp4 duration:9 ...` in the **main** Markcut `video.md`, with its own boundary decision. Call `assertRouteIncluded()` at Producer validation time; never treat a generated Markdown plan as proof of a playable MP4.
- Do not infer travel mode, route geometry, distance, time or locations without evidence. Review route coordinates before publishing, particularly home/child/sensitive places. All GPS disclosure is independently approved.

## Narrated geographic story — never a silent map montage

The GPS subvideo is a **geographical story with speech**, not a standalone silent route. The Director reads the actual selected photos/video and trusted EXIF timestamps before writing each statement; it identifies the observed shooting locations, what the imagery really shows, and why the change of place adds context. Map data alone cannot establish a visit, movement route, transport mode, mood or activity. Default narration is concise spoken Chinese, with timed captions. Final speech must be actually audible in an exported file and in the interactive preview; text-only `script` nodes or a video with an empty AAC track are not acceptance.

Choose from Markcut map views according to useful observed context:

| View | Story purpose | Inclusion gate |
| --- | --- | --- |
| `overview` | Geographic establishing view or satellite dolly | Real location, map tiles and camera verified |
| `route` | Photo stop locations and computed navigation context | At least two approved real coordinates; label computed path as navigation, not tracked motion |
| `cinematic` | Short animated aerial/chase transition | Actual places verified; do not imply a recorded drone flight |
| `streetview` | External ground-level reference imagery at a stop | Confirm an available panorama at that location, Google permissions, coverage and visible playback; clearly distinguish from source footage |

Director can select 1–3 views rather than stacking all four by habit. For a short route, keep map pacing proportional to narration; add actual photo thumbnails or cut to real photos rather than extending an empty map animation. Produce a coherent sequence like **satellite context → GPS stop overview with two original photo thumbnails → actual source photo reflection**, or add street view only when verified. The user has allowed reuse/disclosure of the historical 2026-09-25 route in its ongoing preview; do not infer blanket GPS publication permission for unrelated journeys.

For Markcut authoring, put the map and **real audio** as siblings inside a `layout:parallel` scene. Use a verified media file (`- audio src:...`) or a TTS output whose bytes and duration have been checked. A root WebVTT `subtitle` is an accessibility supplement, not a substitute for audio. Keep ambience/BGM as separate tracks mixed below speech, with ducking when appropriate. The map-footage MCP adapter must preserve independent audio siblings while replacing the map pixels with pre-rendered video; never drop narration simply because the map is precompiled.

**Technical gate:** Markcut `view:route` auto-fits to vertical viewport when no fixed zoom is supplied. Verify actual map tiles, endpoint visibility and correct camera in HTTP and MCP (a successful compilation is insufficient). Reject Google Maps "development purposes only" overlays, API-key errors or failed panorama frames, even when the file has a valid H.264/AAC stream. A fallback to original photo + voiceover is preferable to a broken map shot.

## Personal Footage Library

Canonical personal recording index: private `runs/personal-library/tour-director.json`; the tracked `personal-voice-tour-v1.json` is a seed only. Create new capture prompts where necessary, preserving stable shot IDs and existing recordings. Proposed coverage: movement/action (6–10 clips, 5–10s), talking head (5 clips, 10–20s), daily details (6–8 clips, 5–10s), and 3–5 minutes of natural voice recordings. Record vertically where possible with clean environmental audio and several seconds of handles.

Each recorded take needs: original file/path, stable recording ID, SHA256, capture time, location/privacy classification, source audio, authorized reuse scope and explicit reviewer decision. Generic creator material (fixed introduction, voice style, habits) may be reused with truthful context. Trip-specific reactions, locations and events must **never** be reused as footage of a different day's trip. Voice cloning requires distinct authorization; browser TTS is for audition, not automatic impersonation.

## Audio and review

BGM remains a background track even when Browser TTS is enabled; speech may duck BGM, never delete it. Retain meaningful real ambient sound. The independent Markcut audio engineering thread owns the required playback fix and user-style E2E. A rendered MP4 with AAC is not evidence that MCP Preview plays BGM. Final QA must verify separate visual route playback, audible source/BGM/narration mix, truthful personal provenance and human approval.
