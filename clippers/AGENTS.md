# Clippers Project Rules

Follow the root Neo `AGENTS.md` plus this contract. This project accepts only sources for which an authorizing human has supplied explicit, auditable rights for the exact use requested.

## Delegation boundary

- **Clippers owns**: source authorization and provenance, timestamped evidence intake, candidate moments, run state, rubric application, selection memory, QA readiness, and Markcut handoff.
- **Global specialists own discipline-specific review**: use installed professional agents rather than recreating their prompts.
- **Markcut owns**: story direction, preview, verification, editing execution, and rendering after an approved Clippers handoff.
- **Neo `post` owns**: publication only after the user explicitly asks to publish.

## Specialist routing

- `short-video-editing-coach` is the **primary editorial specialist** for clip construction, pacing, captions, audio, visual support, and Markcut-spec readiness. Inspection found no better installed replacement for Clippers editorial ownership.
- `video-optimization-specialist`, `social-media-strategist`, and `tiktok-strategist` review platform fit and audience-facing packaging for applicable targets.
- `visual-storyteller` and `studio-producer` are optional supports for narrative clarity and production sequencing.
- `growth-hacker` and `tracking-measurement-specialist` own experiment hypotheses, measurement definitions, and post-delivery learning. They do not certify pre-publication virality.
- `reality-checker` is the mandatory independent gate for authorization, provenance, evidence, ranking eligibility, unsupported claims, and readiness.
- Use `understand-image-video` and `tts-stt-sts` as evidence utilities; validate timestamps and claims rather than trusting model output.
- Use `browser-harness` only for source/provenance research. It does not establish rights by itself.
- Use `events-bus` for observable lifecycle progress, `model-router` for bounded specialist cost/routing, and `post` only for explicit publication authorization.

## State lifecycle

`initiated` → `source_authorized` → `source_researched` → `evidence_extracted` → `candidates_extracted` → `ranked` → `qa_passed` → `markcut_ready`.

`qa_failed` is a recovery state; it proves no Markcut-ready spec can be promoted. Remediation must create a new QA decision, return through `ranked`, and preserve accepted upstream artifacts. `blocked` records a hard stop that requires new human input. `failed` records terminal failure for the attempt.

Run repair stays inside the same run and top-level job. Repair the smallest failed gate, retain prior artifact versions, and do not overwrite authorization or evidence history. State advancement must point to the artifact that justifies the new state.

## Selection contract

Apply `config/rubric-v1.json` exactly. Scores are testable hypotheses about viewer attention and completion, not virality claims. Hard gates are authorization/provenance, bounded valid timestamps, source-matched evidence, eligible candidate status, complete measured editorial fields, and independent QA. Excluded candidates may remain in evidence but cannot enter a ranked selection.

## Publication boundary

Preparation, preview, draft, and render requests are not publication authorization. Publishing requires an explicit user instruction, a specific ready spec/artifact identity, destination/platform scope, and the Neo `post` workflow. Engagement and replies remain deferred unless separately requested.

## Project learnings

- 2026-09-17: Evidence-backed candidate selection must remain project-owned because installed editors, platform strategists, and media tools support judgment but do not enforce source rights, timestamp provenance, or ranking eligibility.
