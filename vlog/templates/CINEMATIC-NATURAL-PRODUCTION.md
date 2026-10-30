# Cinematic Natural — approved Vlog production rules (2026-10-30)

This is the owner-approved editorial specification; `cinematic-vlog-style.json` is the tracked rendering preset, not permission to publish. Preserve the project's canonical stage approvals and authentic-source requirements.

## Story order

1. Source-grounded hook and fixed, reusable branded opening (2–4 s). A title card must not replace the hook.
2. **Route Overview subvideo** (6–12 s, default 9 s) when at least two chronologically credible GPS fixes survive screening **and** the owner approves location disclosure. If GPS exists but disclosure is pending, block route publication for review, never silently expose coordinates or invent a route. Without suitable GPS, skip only the map scene, not the episode.
3. Personal hook (5–10 s): grounded creator observation, original environment sound, no invented interior feelings.
4. Journey: real clips and sounds, optional intermediate route progress only when it provides meaningful context; GPS-linked shot timing if verifiable.
5. Reflection (5–15 s): creator-approved personal observations and emotional reaction.
6. Route Recap (optional, based on validated points), fixed closing (2–4 s). Do not imply sparse fixes form a recorded driving trace.

## Route production contract

- Use `lib/route-subvideo.mjs:planRouteSubvideo(records,{disclosureApproved:true})` only with private original-media metadata, and `lib/gps-route.mjs` for source provenance, outlier screening and public redaction.
- Persist `route.md` and privacy-approved intermediate data in the episode's **private** run; render `route.md` to `route.mp4` with Markcut only after map/video E2E is verified in the target environment.
- Include the rendered `route.mp4` as an ordinary `- video src:assets/route.mp4 duration:9 ...` in the **main** Markcut `video.md`, with its own boundary decision. Call `assertRouteIncluded()` at Producer validation time; never treat a generated Markdown plan as proof of a playable MP4.
- Do not infer travel mode, route geometry, distance, time or locations without evidence. Review route coordinates before publishing, particularly home/child/sensitive places. All GPS disclosure is independently approved.

## Personal Footage Library

Canonical personal recording index: private `runs/personal-library/tour-director.json`; the tracked `personal-voice-tour-v1.json` is a seed only. Create new capture prompts where necessary, preserving stable shot IDs and existing recordings. Proposed coverage: movement/action (6–10 clips, 5–10s), talking head (5 clips, 10–20s), daily details (6–8 clips, 5–10s), and 3–5 minutes of natural voice recordings. Record vertically where possible with clean environmental audio and several seconds of handles.

Each recorded take needs: original file/path, stable recording ID, SHA256, capture time, location/privacy classification, source audio, authorized reuse scope and explicit reviewer decision. Generic creator material (fixed introduction, voice style, habits) may be reused with truthful context. Trip-specific reactions, locations and events must **never** be reused as footage of a different day's trip. Voice cloning requires distinct authorization; browser TTS is for audition, not automatic impersonation.

## Audio and review

BGM remains a background track even when Browser TTS is enabled; speech may duck BGM, never delete it. Retain meaningful real ambient sound. The independent Markcut audio engineering thread owns the required playback fix and user-style E2E. A rendered MP4 with AAC is not evidence that MCP Preview plays BGM. Final QA must verify separate visual route playback, audible source/BGM/narration mix, truthful personal provenance and human approval.
