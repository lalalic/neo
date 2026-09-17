# Clippers

Clippers turns one **explicitly authorized** long-form source into ranked, evidence-backed short-form clip specifications for Markcut. It is a capability experiment, not permission to use arbitrary copyrighted media.

## Owned outcome

Repeatedly produce source-aware, independently reviewed clip decisions with a defensible chain from source authorization through timestamped evidence, candidate selection, ranking, and QA. Clippers owns source rights intake, moment evidence, editorial judgment, run state, and selection learning. It does not own generic video direction or publication.

## Pipeline

1. **Authorized source** — explicit rights intake and machine-readable authorization.
2. **Source research/provenance** — source identity, rights context, campaign constraints, and observable metadata.
3. **Timestamped transcript/media evidence** — validated speech and media observations tied to source milliseconds.
4. **Candidate moments** — evidence-backed, bounded moments with measured editorial attributes.
5. **Specialist selection/ranking** — `rubric-v1` hypotheses ordered by configured weights.
6. **Independent QA** — `reality-checker` reviews evidence, eligibility, claims, and readiness.
7. **Markcut-ready specs** — approved handoff records only; rendering is a later gate.

Rendering and publication are later gates. No public posting, upload, campaign, or engagement action occurs without explicit user authorization through the Neo `post` flow.

## Run layout

Every execution stays under `runs/<YYYY-MM-DD[-slug]>/`, following the root Neo run contract. Inputs, transcripts, candidate JSON, QA records, specs, media, caches, logs, and generated outputs are private run artifacts. Durable rules, schemas, examples, and scripts remain tracked.

## First source contract

The orchestrator must provide:

- an existing local media path inside the dated run;
- completed `schemas/source-authorization-v1.schema.json` with source, authorizer, scope, restrictions, authorization evidence, and expiry when applicable;
- source title/URL/producer and campaign objective when the source is authorized;
- whether transcription and redistribution are permitted for the requested platform.

Missing authorization, ambiguous redistribution rights, unavailable local media, or absent word/sentence-level timestamps are hard stops—not prompts to substitute arbitrary media.

## Contract commands

```bash
python3 clippers/scripts/clippers.py validate authorization clippers/examples/source-authorization-v1.json
python3 clippers/scripts/clippers.py status runs/<YYYY-MM-DD[-slug]>
python3 -m unittest discover -s clippers/tests
```
