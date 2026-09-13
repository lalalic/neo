# Routing patterns used as references

This file records ideas to borrow, not dependencies to install.

## 1. orange-the-weak/codex-auto-model-router

Useful ideas:

- benefit-gated routing rather than routing every turn;
- keep the coordinator where it is when switching cost exceeds expected gain;
- choose a route once and reuse a model-specific execution path when useful;
- separate task-fit judgment from orchestration overhead.

Do not copy its fixed GPT-family route catalog or assumptions that the candidate set is known in advance. Dynamically discover configured profiles first, then apply benefit-gated switching inside that candidate set.

## 2. autohandai/routes

Useful ideas:

- capability gates before cost/latency preferences;
- policy dimensions including quality, cost, latency, privacy, health, budget, and locality;
- explainable decision traces and rejected candidates;
- provider health and budget as first-class routing inputs;
- sticky routing when continuity matters;
- eval-driven routing policy.

Do not copy its permanent OpenAI-compatible gateway requirement or centrally maintained provider inventory. The current harness discovers and invokes profiles.

## 3. Codex profile/provider patterns

Current Codex configurations can define custom model providers and profile-specific selections, with profiles selected by `--profile`/`-p`. Modern layouts may use profile-specific files under Codex home instead of only legacy `[profiles.<name>]` tables.

Route to a profile as the stable execution unit when possible, read the runtime's actual configuration rather than a copied list, and preserve provider/profile identity for persistent threads.

## 4. Codex model-router projects

Mixed-provider Codex projects demonstrate that provider switching is safer through explicit profiles, credentials stay local, and subscription-backed execution can coexist with external providers.

Do not copy provider-specific fixed maps or assume only two providers exist.

## 5. User-specific policy

Prefer suitable capacity the user has already paid for or prepaid, especially when it would otherwise expire or reset unused. Still quality-gate every choice: paid capacity should not override material capability requirements.

## Boundary

This reference does not define a provider leaderboard. Live environment and trustworthy runtime/provider metadata are the source of truth.
