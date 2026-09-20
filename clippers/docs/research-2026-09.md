# Clippers Research Status — September 2026

This document consolidates durable research conclusions produced while proving the first real Clippers campaign. Runtime artifacts and detailed evidence remain under ignored `clippers/runs/`; this file records only reusable conclusions, current defaults, and open research questions.

## Pipeline conclusion

The working pipeline is:

`authorized source -> media preflight -> timestamped transcript -> text-first candidates -> candidate-only structured Vision -> independent Editorial Judge -> three edit variants -> independent QA -> Markcut-ready handoff -> explicit render/publish gates -> metrics -> learning`.

The key design decision is to narrow cheaply before multimodal analysis. Vision is evidence extraction, not final editorial authority. The Editorial Judge combines campaign brief, transcript evidence, and Vision evidence and owns ranking/rationale.

## First real campaign evidence

The Podcast Clips Highlight campaign proved the pipeline through Markcut-ready preview validation using one authorized source. The durable run is `clippers/runs/2026-09-17-podcast-clips-8193`.

Observed stages:
- transcript and twenty text-first candidates were produced;
- structured Vision validation accepted 15/20 candidates under the strict contract;
- Editorial Judge scored 15 candidates and produced a Top-10 shortlist;
- three materially different variants were planned;
- first independent QA correctly rejected non-executable Markcut authoring;
- revised variants later passed normal Markcut preview and local viewer validation;
- the run is intentionally paused before render-based certification/publication pending applicable authorization.

This is evidence that the staged contract works and that independent QA adds real value; it is not evidence of revenue or publishing performance.

## Current gates and autonomous continuation

Two gates now block execution:

1. The first real campaign is waiting at render-based viewer-quality certification. This documentation task does **not** authorize render, generation, spend, publication, outreach, or a new campaign; each subsequent external action needs its own explicit authorization.
2. The Phase 3 measured pilot cannot execute until it has a rights-cleared 30–90 minute source or an explicit durable eligibility finding for an existing source.

PR #20 and Agents Relay job `clipper-research-relay-20260919` are the durable control plane for further bounded research. The PR planner/task markers are authoritative; `.run` is only a private pointer/handoff and must not duplicate job truth.

## Vision / local VLM research

### Markcut Vision

Current Markcut Vision/media plumbing is useful for:
- normalization and ffmpeg/media handling;
- STT/segmentation;
- model invocation and segment perception.

It is not itself the Clippers editorial contract. Clippers requires candidate-only, timestamped structured evidence and keeps transcript-first narrowing before expensive Vision.

A strict validation run produced 15 valid candidates and 5 failures. Follow-up classification found the five failures were prompt/model compliance failures rather than a demonstrated reusable Markcut defect. The validated 15 were sufficient for Editorial Judge progression.

### Local MLX benchmark

The bounded local benchmark compared the existing Qwen3-VL-8B-Instruct-MLX-4bit path with a 4B variant on the five strict failures. The 4B path did not improve the result; validation remained 15/20 overall. Current default remains the 8B path when local Vision is appropriate.

Do not expand the model matrix without a fixed eval set and a concrete failure to solve.

## NotebookLM research

NotebookLM was tested empirically against the campaign source and generated a short-form artifact for comparison. The experiment did not meet the Clippers core requirements for exact source-language grounding, span mapping, duration/control, and evidence traceability.

Current decision:
- keep NotebookLM as optional critique/reference/research support;
- do not promote NotebookLM-generated shorts into the core evidence-backed Clippers production pipeline;
- revisit only with a controlled experiment that can satisfy exact grounding and reproducible UI/artifact evidence gates.

## Editorial / QA research

The Editorial Judge separation is validated. The Judge should remain independent from cheap extraction and Vision description.

The first QA pass exposed a useful failure: editorially plausible variant specs were not executable Markcut node trees. This justified the independent QA boundary. Revision and re-validation subsequently produced preview-valid A/B/C variants.

Reusable rule: a variant is not `markcut_ready` because the idea is good; it must pass installed Markcut executability plus identity/evidence checks.

## Current defaults

- transcript-first narrowing before Vision;
- Vision model/interface remains model-agnostic;
- local 8B MLX path remains the current local benchmark default;
- NotebookLM is optional research/critique, not core production;
- Editorial Judge is separate from Vision;
- independent QA is mandatory before Markcut-ready promotion;
- render/publish remain explicit authorization gates.

## Open research questions

Research should be triggered by observed pipeline gaps, not curiosity alone.

Priority questions:
1. Can a better local or hosted VLM materially improve strict structured-evidence validity on a fixed Clippers eval set without unacceptable latency/cost?
2. Can NotebookLM or another grounded system provide exact source-span mapping and controllable short-form planning useful to the Judge without replacing evidence contracts?
3. Which structured Vision fields actually predict faster/better editorial decisions and can be removed if they do not?
4. After publication is explicitly authorized, which selection/variant features correlate with 24h/72h/7d performance on real clips?

Without crossing either current execution gate, the remaining bounded unknowns are whether the existing fixed 20-candidate eval can establish a better no-spend local Vision benchmark, which existing structured Vision fields improve or add friction to editorial decisions, and whether the existing source's rights record explicitly qualifies it for Phase 3. A relay child task is still required to execute the first two; this handoff itself authorizes none of them.

## Research execution contract

All new Clippers research that uses an agent/worker must be created as an Agents Relay child task under a durable managed job before execution.

Each research task must include:
- a concrete question and falsifiable success criterion;
- authoritative input/eval set references;
- explicit non-goals and spend/publication constraints;
- model-router decision before launch for model-backed work;
- events-bus visibility;
- durable result summary in the Agents Relay task plus artifact references;
- a project-doc learning only when the result changes a durable default or rule.

Do not create ad hoc background research workers outside Agents Relay. Historical pre-relay research may be backfilled with `agents-relay record` when the evidence and commit/artifact references are known.
