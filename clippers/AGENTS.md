# Clippers Project Rules

Follow root Neo `AGENTS.md`. Clippers accepts only explicitly authorized sources and promotes stages by artifacts, never prose claims or successful tool exits.

## Specialist routing

- Bounded text/candidate extraction is a cheap filter, not editorial authority.
- `understand-image-video` backs the model-agnostic structured Vision contract. Prefer the installed/local capability first. Changing the model is routing/configuration and requires benchmarking on a fixed evaluation set.
- `short-video-editing-coach` is the primary Editorial Judge and editorial authority for pacing, construction, editability, risk notes, and recommendations.
- `visual-storyteller`, `video-optimization-specialist`, and `tiktok-strategist` are consulted for narrative clarity or platform-specific fit; they do not replace the Judge.
- `reality-checker` is the independent QA/promotion gate. Author and reviewer should differ when practical.
- `tracking-measurement-specialist` owns 24h/72h/7d interpretation and learning. `growth-hacker` may frame experiments but does not certify performance.
- Markcut owns director execution and rendering only after structured handoff. Neo `post` owns external publishing only after explicit human authorization.
- `tts-stt-sts` and `browser-harness` are bounded utilities for transcript/provenance inputs. `events-bus` reports progress, and `model-router` selects configured execution profiles.

Do not copy global agent prompts into project agents. Project-local authority is limited to rights intake, evidence and state contracts, selection rubric application, and handoff identity.

## State lifecycle

`initiated → source_authorized → media_preflight → transcript_extracted → text_candidates_extracted → vision_reviewed → judge_ranked → variants_planned → qa_passed → markcut_ready`.

QA failure enters `qa_failed`, then must return to `judge_ranked → variants_planned` with a new QA decision. Later states are `publication_authorized → published → metrics_24h → metrics_72h → metrics_7d → learning_recorded`. Preserve history, accepted upstream artifacts, and exact artifact identities during repair. Never overwrite authorization, evidence, Judge, selection, QA, or publication history.

## Evidence contract

Text candidates use transcript evidence only. Vision evidence is structured and timestamped; it describes subjects, emotion, events, narrative, hook, weaknesses, vertical crop feasibility, and production opportunities without selecting a winner. Editorial Judge combines campaign brief, transcript, candidate, and Vision, assigns rubric scores plus rationale/edit guidance, and ranks hypotheses. QA verifies source rights, timestamp alignment, ranking, coherence, and all identity bindings before Markcut.

## Publication and learning

The user must explicitly authorize publication of a specific artifact/variant/platform. Record destination identity and actual 24h/72h/7d metrics. Learning may revise hypotheses and benchmark plans; it must not silently rewrite old run evidence or claim business success.

## Project learnings

- 2026-09-17: Keep editorial selection separate from cheap candidate extraction and structured Vision description; expensive multimodal review after slicing protects cost while preserving evidence.
- 2026-09-17: A Markcut handoff is an identity-bound JSON contract, not an arbitrary text brief; QA must bind source, selection, candidate, variant, and QA IDs.
