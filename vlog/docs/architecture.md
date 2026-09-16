# Vlog architecture

Vlog is an event-driven production system on the home Mac. Codex is the producer and conversation channel. Markcut Preview is the storyboard and final visual-review channel. Publishing to WeChat Channels and Xiaohongshu, notifications, and post-publication engagement are future adapters.

## Boundaries

NeoX supplies phone media discovery, cheap basic vision/OCR, frame sampling, and original export over LAN. Search by content and inspect candidates before exporting. Discover the live MCP tool list before using it. Download selected assets using resumable HTTP, verify the files, then clear only NeoX's staged exports. Keep phone media identifiers in the ingestion manifest. Phone availability is an external dependency.

`markcut vision <folder>` supplies deep semantic media understanding. Codex uses its resulting metadata with series continuity to select moments and write the story. Markcut owns media generation, compilation, preview, and rendering. Producer code should not reproduce those engines.

The workflow persists events, episodes, jobs, attempts, and reviews in SQLite. Repeated delivery of the same event must not create duplicate episodes. Restarting the producer must not lose the current stage. Jobs have at most three attempts per approach.

## Production stages

Event → ingest → analyze → story → storyboard review → render → final review → ready.

In this bootstrap, `ingest` records event intake. It does not mean phone files have been downloaded; a producer must resolve/import media before completing analysis. Series JSON files hold editorial continuity while SQLite holds operational series identity and episode state. The bootstrap does not automatically synchronize these stores.

The producer performs tool jobs and records their actual output. Storyboard review comes before costly media generation. Final review uses the finished video. Changes to reviewed artifacts require a new review. Ready means ready for a future publisher, not published.

The bootstrap provides the durable control plane and command handoffs. The installed `com.neo.vlog-autopilot` worker accepts only the fixed daily-vlog handoff after validating its private-LAN NeoX endpoint; it does not consume other bridge messages or treat handoff text as shell code. It starts an unattended producer through storyboard review. A home-arrival listener, notifications, and publisher are not installed.

## Content model

Series carry premise, dates, recurring characters, ongoing story threads, prior episode summaries, and material to avoid repeating. Episodes belong to a series and own a source manifest, storyboard, review evidence, and rendered outputs. Templates define story structure; styles define audiovisual treatment; personas define voice and perspective. These are independent reusable objects.

The checked-in `neo-001` is an illustrative, silent three-scene technical demo. It is not real travel footage or evidence of business progress.

## Audio and voice contract

Every final vlog has BGM. The producer selects one episode-appropriate track with the installed `audio-sourcing` skill, records it as an intentional run asset under `runs/<run-id>/assets/`, and references it with a portable relative path. Do not reuse a track merely for convenience or download from an ad-hoc web source. Put BGM on a root Markcut stream with `isBackground:true` and a volume deliberately lower than narration and meaningful location sound. Final review must listen through the ending and confirm BGM is audible, non-distracting, correctly mixed, and ends with the video.

Narration follows this voice priority: first preserve intelligible, tonally appropriate original speech from footage; otherwise generate narration with Ray's matching vocal reference. Ray's voice references describe vocal timbre only and do not make the story persona Ray or Neo. The narrative persona remains an independent reusable object. Select `talk` or `normal` by default, use `fun`/`funny` only when the scene justifies lighter tone, and reserve `sichuan` for an episode that intentionally uses that dialect. Avoid caricature and overacting.

If the user's reference or voice cloning is unavailable or fails quality review, use a natural conversational Mandarin fallback: warm, grounded, mature but not announcer-like, medium-low register and energy, slightly brisk everyday pacing, short phrases with small pauses, restrained emotion, and no sales or AI-assistant cadence. Before rendering a final vlog containing generated narration, back-check intelligibility and content accuracy using local STT, listen for obvious voice artifacts, and record that QA evidence. Homophones reported by ASR may be acceptable when the source narration is correct.

## Roles and cost

Producer owns intent and workflow. Media analyst summarizes Markcut results. Story editor writes the episode. Reviewer evaluates independently against the user's request and actual output. Future publishing/engagement uses a separate adapter.

Choose model profiles by task: strong reasoning for producer decisions, cheaper models for routine analysis and metadata, and an independent reviewer when useful. Provider profile names must resolve to actual local configuration; do not assume DeepSeek, OpenRouter, or GLM exists merely because it was discussed. Store routes, attempts, and output evidence, never credentials, in project state.

## Xiaohongshu presentation contract

Neo daily-life Vlogs on Xiaohongshu are Chinese-first. The complete viewer-facing package — title, copy, narration, subtitles, overlays, and hashtags — must be Chinese except unavoidable source text. Titles follow `数字人生｜<本条主题>`. The producer must enforce this before final review and publication.

## Review evidence

Audit Markdown, compiled tree, then rendered output using the installed Markcut review contract. Watch the complete video. Check visual presence, narration tails, cuts, audio completeness, caption alignment, and readability. A syntax check is not visual approval. Record the artifact revision and review rationale.
