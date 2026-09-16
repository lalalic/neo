# Neo Build Log Project Rules

This directory is a content project inside Neo. When the working directory is
`neo-build-log/` or one of its episode folders, follow this file in addition to
the parent Neo instructions.

Read `README.md` and `agents/director.md` before creating or revising an episode.
`agents/director.md` is the canonical editorial contract. Markcut owns video syntax,
validation, preview, and rendering; do not duplicate Markcut implementation
rules here.

## Required episode grammar

Every Neo Build Log episode must be shaped from real work and normally contain:

1. **Hook** — the first screen must immediately state or show the concrete
   problem, surprise, failure, or payoff. Do not begin with generic branding.
2. **Series opener** — show `Neo Build Log`, episode number, and topic using the
   recurring series identity. Keep it short and let it overlap the hook when
   useful.
3. **Problem / constraint** — explain why the issue mattered in this build.
4. **Attempt / investigation** — show what was tried, rejected, or discovered.
5. **Build / change** — show the actual work: screen recording, terminal, code,
   screenshots, diagrams, or other truthful evidence.
6. **Result / evidence** — demonstrate what now works or what was learned. Never
   invent a successful result when evidence is missing.
7. **Payoff + next hook** — end with one concise takeaway and, when there is a
   credible continuation, a teaser/question for the next episode.

## Fixed presentation rules

- Every episode follows `AUDIO_STYLE.md`: the `Neo Builder` narration contract and
  recurring `Neo Build Pulse` BGM are part of the series identity. Prefer the
  user's accepted voice clone when available; otherwise use the documented
  fallback. Narration must duck BGM rather than compete with it.
- Real desktop/screen material is the primary visual language of the series.
  Prefer screen recording for actions and motion; use screenshots for static
  state or proof. Never fabricate evidence to fill a visual gap.
- Presenter footage is part of the visual mix. The default treatment is the
  small lower-right presenter overlay described in `agents/director.md`; use a larger
  human shot only when it genuinely improves the story.
- The first screen must work as a hook even before the viewer understands the
  project. Branding is support, not the hook itself.
- The ending must feel intentional: payoff/closing line first, then a next-step
  teaser when one exists. Do not end on an arbitrary terminal or UI frame.
- Spoken narration explains motivation, reasoning, and tradeoffs. On-screen
  text should be short: hook, section cue, key fact, or takeaway—not a duplicate
  transcript.
- Missing footage or assets must be recorded as explicit capture placeholders,
  never silently replaced with invented visuals or claims.

## Episode outputs

Keep episode-specific source facts, storyboard/Markcut Markdown, and capture
instructions under that episode's directory. A recording plan should identify
which beats need screen recording, screenshot/static evidence, presenter
footage, narration, and any missing asset that still needs capture.

Final rendering and publication remain user-review steps unless the user
explicitly asks for them.

## Capture pipeline

An episode is not ready for Markcut merely because `episode.md` exists. The
required project flow is:

`source.md → story/episode draft → RECORDING_PLAN.md → capture-tour.json (camera subset) → Capture Agent → CAPTURE_REVIEW.md → accepted-media episode.md → Markcut preview → user review`

- Read `agents/capture-agent.md` before executing capture work.
- `RECORDING_PLAN.md` is the complete recording list across desktop and camera.
- `capture-tour.json` is only the NeoX human/presenter subset, using the same shot IDs.
- Validate NeoX manifests against `schemas/neox-capture-tour-v1.schema.json` and
  prefer the live NeoX `tour.start` schema when it differs.
- `CAPTURE_REVIEW.md` is a mandatory evidence/quality/privacy gate. Essential
  missing or retake shots block Markcut readiness unless the Director revises
  the story.

## Codex runtime layout

Treat `neo-build-log/` as the project working directory. The parent Neo
`AGENTS.md` still applies.

Tracked project state belongs here:

- `README.md`, `AGENTS.md`, `agents/director.md`, `agents/capture-agent.md`, `AUDIO_STYLE.md`;
- `schemas/` contracts;
- `runs/neo-build-log/<YYYY-MM-DD[-slug]>/source.md`, `episode.md`, `RECORDING_PLAN.md`,
  `capture-tour.json`, and `CAPTURE_REVIEW.md`.

All execution state belongs inside the dated series run at `runs/neo-build-log/<YYYY-MM-DD[-slug]>/`, including logs, diagnostics, Markcut state, captured media, review files, and final output. Only reusable project rules, agents, schemas, docs, templates, and scripts stay tracked.
