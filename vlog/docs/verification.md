# Bootstrap verification — 2026-09-11

## Sources of truth

The current user request and recovered `idea` conversation establish the scope. Installed Markcut and NeoX skills establish integration boundaries. The running Markcut CLI and rendered artifacts establish actual behavior.

## Media checks

- Markcut `verify` accepted both the travel-day template and the demo episode.
- Storyboard Preview loaded with Overview, Mission, FirstProject, and NextStep.
- Final Preview loaded the three scenes and its play control was exercised through the browser. No browser errors were returned.
- The requested CDP endpoint `127.0.0.1:64086` refused connections. An isolated `neo-bootstrap` browser was used and closed afterward.
- Markcut rendered `runs/<series-name>/<YYYY-MM-DD[-slug]>/output/vlog.mp4`: H.264, 1080×1920, 30 fps, 360 video frames. Container duration is approximately 12.05 seconds including audio padding.
- A contact sheet sampled all three rendered cards. Text and visuals are present, legible, and uncropped. The demo is deliberately silent; this does not validate generated speech, subtitles, or real footage ingestion.
- Markcut added a seed to the episode source during preview. Its caches and generated outputs were preserved and excluded from Git.

## Runtime checks

- Four regression tests pass: CLI/config routing, event idempotency and restart/context, interrupted recovery with a three-attempt ceiling, and a complete review-to-ready lifecycle.
- Revision tests reject an old approval during re-review, altered storyboard bytes before approval, and altered approved bytes before claiming a render.
- Direct CLI verification initialized `runs/<series-name>/<YYYY-MM-DD[-slug]>/state/vlog.sqlite`, submitted `demo-arrival-001` twice, and confirmed one event, one episode, and one queued analysis job. This synthetic job remains unclaimed and has zero approvals.
- File evidence is hashed as a stream so large videos need not be loaded entirely into memory.

## Audio and voice checks

For every post-contract final vlog, the reviewer listens from beginning through end and records whether episode-specific BGM is audible beneath speech/location sound, does not distract from narration, and ends with the video. Generated narration is checked by local STT against the source text and by listening for intelligibility and obvious artifacts. The silent checked-in demo remains an historical exception, not an accepted final-vlog pattern.

## Scope limits

No phone media was read, no real home-arrival event was observed, and no external model provider was called. No user editorial approval is recorded by this technical check. Publishing and engagement were not implemented.

## Independent audit

A Luna subagent checked documentation and content definitions. Follow-up changes added an explicit demo source manifest, series continuity fields, a production note requiring replacement of template placeholders with selected footage, and a separate Ray persona for the user's supplied voice references. Neo's identity remains separate from Ray's voice configuration.
