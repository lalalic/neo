# Clippers

Clippers is a concrete, recoverable pipeline that turns one explicitly authorized long-form source into evidence-backed clip variants and measurable learning. It is a capability lab for Neo's video-growth judgment, not an automatic cutting service.

## Owned outcome

Clippers owns source authorization/provenance, cheap text-first candidate discovery, structured Vision evidence, independent editorial judgment, variant planning, run state, QA identity, Markcut handoff, performance evidence, and learning. It does not own generic model prompting, rendering, external publishing, or copied global specialist prompts.

## Stage contract

Every state advance must name the artifact that proves it. Paths must remain inside the dated run.

| Stage | Input | Promotion artifact | Owner |
|---|---|---|---|
| `source_authorized` | user-provided local source and rights record | `source-authorization-v1` | source intake |
| `media_preflight` | normalized source + research/provenance | `media-preflight-v1` and ffmpeg-derived frame index | media utility |
| `transcript_extracted` | normalized audio | `transcript-evidence-v1` | `tts-stt-sts` utility |
| `text_candidates_extracted` | transcript slices | `text-candidates-v1`, target about 20 | bounded extraction |
| `vision_reviewed` | candidates only | `vision-editorial-understanding-v1` JSON | `understand-image-video`, model-agnostic |
| `judge_ranked` | campaign brief + transcript + candidate + Vision | `editorial-judge-v1` then `ranked-selection-v2` (about 10) | `short-video-editing-coach` |
| `variants_planned` | ranked selection | `variant-plan-v1`, exactly 3 for the first experiment | primary editor with platform supports |
| `qa_failed` / `qa_passed` | variants and evidence | `qa-decisions-v1` | `reality-checker` independently |
| `markcut_ready` | passing QA identities | `markcut-handoffs-v1` JSON | Markcut receives a structured handoff |
| `publication_authorized` | explicit human instruction | `publication-authorization-v1` | human + Neo `post` |
| `published` | authorized publish result | `publication-record-v1` | Neo `post` |
| metrics/learning | destination observations | 24h/72h/7d `metrics-observation-v1`, then `learning-record-v1` | `tracking-measurement-specialist` |

The first Podcast Clips Highlight campaign is learning-first: about ten ranked candidates, three materially different variants, human review before publication, recorded rationale, and real 24h/72h/7d observations. Scores and performance do not establish revenue or virality claims.

## Hard rules

- Authorization must be current, exact, permit clip creation, and bind every campaign/variant/Markcut/publish platform.
- A text candidate cites only transcript evidence. Vision runs only after the bounded shortlist and never makes the final selection.
- Every Vision/Judge claim must resolve to a run artifact and fit candidate and transcript bounds.
- State history must use legal adjacent transitions. QA failure repairs through `judge_ranked`, not directly to pass.
- Ranking follows configured descending weighted score with stable `candidate_id` tie-break.
- QA and Markcut bind source, selection, candidate, variant, and QA IDs.
- Publishing is external and never inferred from render/preview/draft intent.

## Orchestrator input

Provide an existing local media file, complete source authorization, source provenance, campaign brief, allowed platforms, restrictions/expiry, and the dated run ID. Missing rights, ambiguous platform scope, unavailable media, or unusable timestamps are hard stops.

## Commands

```bash
python3 clippers/scripts/clippers.py validate authorization clippers/examples/source-authorization-v1.json
python3 clippers/scripts/clippers.py status runs/<YYYY-MM-DD[-slug]>
python3 -m unittest discover -s clippers/tests -v
```
