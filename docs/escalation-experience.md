# Private Escalation Experience Library

After every local escalation, the local model summarizes its own observed attempt, including failures and cases requiring a human. If the executor already returned an `experience` object, Neo uses it. Otherwise Neo asks the same still-loaded local model for a brief, tool-free post-run note, without starting a second model process. The CLI validates, redacts, deduplicates and stores it without adding fields to the synchronous public result.

## Inspect

```sh
neo escalation cases
neo escalation cases --search oauth
neo escalation cases --limit 100
```

Records are stored locally in `~/.local/share/neo/escalation/cases/*.json` by default. The leaf directory is mode 0700 and records are 0600. `NEO_ESCALATION_CASES_DIR` overrides the destination with an absolute private directory, particularly useful for tests.

## Deduplication and outcomes

A stable SHA-256 fingerprint is derived from `(scenario_key, outcome, strategy_key)`. An existing fingerprint is not rewritten. This means repeated handling of the same pattern by the same strategy is not recorded again, but success and failure, or distinct strategies for the same problem, are separate learning examples. Creation uses atomic create-if-absent semantics and tolerates concurrent calls.

Record outcomes: `resolved`, `failed`, and `needs_user`. On any normal runtime/agent exception, Neo captures a minimal `failed` case with a hashed handoff fingerprint and error class. A post-run model-generated candidate is labeled `source: postrun_model`. If the recorder fails as well, an incomplete candidate is marked `source: fallback` and contains no invented solution.

## Recorded fields

Each entry contains a normalized scenario key and category, generic symptom, outcome, strategy key, attempted steps, verification, failure reason, transferable lesson, observed tool names and counts, model family, capture timestamp, and `training_reviewed: false`. These are reusable experience candidates, **not trusted training samples**.

The library must not contain raw handoffs, command arguments, browser content, complete URLs, screenshots, cookies, passwords, OTPs, API keys or private paths. The CLI applies conservative redaction, but review and further anonymization are required before creating a training set. No automatic training, upload, or external publication happens.

The dedicated smoke test `neo escalation test` bypasses the case library so synthetic health checks do not pollute future learning.

## Operational limitations

Semantic deduplication is only as consistent as the agent's stable scenario and strategy classification. Equivalent problems given different keys may still produce separate entries. The case library captures a summary, not complete replayable tool trajectories. An uncatchable process kill or hardware failure may prevent the final record; recoverable failures are recorded.
