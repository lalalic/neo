# Cinematic episode template

Use only ignored vlog/runs/YYYY-MM-DD[-slug]/ for instantiated media, execution artifacts, reviews and QA. This is a reusable template, not evidence of any episode.

source-manifest.json: schema_version 1; source_window start/end ISO timestamps; episode_intent; items with unique id, local_relative_path, SHA-256, media_type, origin, captured_at, permission.owner_confirmed, permission.use_approved, original_audio, duration, selected_ranges. Validate actual files before story work. Legacy inbox manifest is an ingestion transport, not source authorization.

story.md: supported hook, orientation, development, payoff and source references with time ranges. Missing authentic story evidence means INSUFFICIENT_SOURCE.

visual-brief.md: per beat specify shot scale (establishing, wide, medium, detail), framing/crop, movement, motivated cut, continuity, color reference/exposure, duration/pacing, real original sound, licensed music and ducking, restrained graphics/transition, source ID and range. Cheerful/lively by default. Do not substitute invented personal media.

video.md: single canonical Markcut timeline with stable scenes and actual source assets. Shared Execution Director owns typed execution/ lanes. assets/ preserves originals and auditable derivative mappings.

reviews/video-director.md and reviews/market.md: independent identity, reviewed_at, video.md hash, status PASS/CHANGE_REQUIRED, timecoded findings and specific changes. Both PASS on identical current draft required before final render.

output/final.mp4 and qa.md: record output hash, ffprobe resolution/fps/duration/audio, representative frames, measured audio and speech/music mixing, full watched/listened playback with player/viewer/time and timecoded observations. Score source 20, narrative 15, shots 15, visual/color 15, pacing 10, sound 15, graphics 10. PASS requires total >=85, each >=70% maximum, zero critical defects. Changes require fresh reviews and playback.

Capabilities: phone/iCloud/manual supplies approved originals; vision outputs observations not truth; Video Director owns creative decisions; Execution Director owns unresolved media; audio-sourcing still requires verified track licenses; Markcut only renders supported syntax; Market performs audience review; post-agent only publishes with separate authorization and external receipt. User-approved voice required for narration. Unsupported native grading, stabilization, speed ramps, adaptive ducking and fullscreen player UX are dependencies until verified.
