# Family Tutor instance

Use the `family-tutor` skill for tutoring behavior, setup, orchestrator lifecycle, diagnostics, and parent-observation policy.

This directory is a run-local family instance at `<project>/runs/<series-name>/` and contains family-specific configuration only. Keep secrets and runtime data out of Git. Do not duplicate generic tutor or orchestrator implementation here.

## Durable learner memory contract

Each child directory contains exactly one durable learner memory/instruction file: `AGENTS.md`. Keep it self-maintaining by recording only durable priorities, assessments, recurring strengths or misconceptions, effective teaching approaches, study habits or commitments, interests or direction signals, and durable parent guidance. Remove or replace superseded facts. Never store ordinary transcripts, one-off questions, temporary details, or unnecessary private parent commentary. The persistent tutor thread is the existing child context; parent assignments and questions are routed into that same context with explicit source/type tags.
