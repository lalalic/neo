# Private Escalation Experience Library

After every local escalation, the local model summarizes its own observed attempt, including failures and cases requiring a human. If the executor already returned an `experience` object, Neo uses it. Otherwise Neo asks the same still-loaded local model for a brief, tool-free post-run note, without starting a second model process. The CLI validates, redacts, deduplicates and stores it without adding fields to the synchronous public result.

## Inspect

```sh
neo escalation cases
neo escalation cases --search oauth
neo escalation cases --limit 100
```

## Teach the local agent interactively

Open a real terminal on Neo Master:

```sh
neo escalation learn
```

The CLI loads the same local Qwen/llama (or configured local inference endpoint) as `neo escalation`.
It holds the exclusive inference lock for the interactive session. Conversations are kept
in process memory only. It does not create a Hermes thread, Relay Job, or persistent transcript.

Describe the scenario and the steps. Learn mode enables Shell, WebHelm and Neo
Computer Use by default and continues calling tools until the agent finishes
its current turn. There is no fixed Learn-mode limit on dialogue turns,
tool-call rounds, or tool calls in a model batch. You can give corrections
between turns. Model context and individual inference requests still have
technical limits. The WebHelm CLI's `help` output is authoritative.

Commands:

- `/quit`: end the learning conversation and unload the model.
- `/tools off` / `/tools on`: disable or re-enable tool execution.
- `/remember`: optionally review and manually save a proposed lesson.

When tool evidence confirms completion, Neo requests a fresh verification
check and then automatically saves the reusable lesson. A manual save still
requires confirmation.

Confirmed lessons have `outcome: "taught"`, `source: "owner_taught"`,
`owner_confirmed: true`, and `training_reviewed: false`. A taught procedure is
**not** represented as a verified successful execution. Re-teaching the same
scenario and strategy and confirming again updates the saved taught lesson.
No raw conversation or tool transcript is retained.

Use `neo escalation cases --search "Apple Developer"` to inspect saved lessons.
When a future `neo escalation --handoff-file ...` matches the lesson's scenario
terms, the CLI supplies the relevant lesson(s) to the local agent as **untrusted
suggestions**. The agent must verify them in the current situation and obey all
authorization and safety rules. Unrelated lessons are not injected. Learned
content is separate from automatic Escalation outcome records.

Records are stored locally in `~/.local/share/neo/escalation/cases/*.json` by default. The leaf directory is mode 0700 and records are 0600. `NEO_ESCALATION_CASES_DIR` overrides the destination with an absolute private directory, particularly useful for tests.

## Deduplication and outcomes

A stable SHA-256 fingerprint is derived from `(scenario_key, outcome, strategy_key)`. An existing fingerprint is not rewritten. This means repeated handling of the same pattern by the same strategy is not recorded again, but success and failure, or distinct strategies for the same problem, are separate learning examples. Creation uses atomic create-if-absent semantics and tolerates concurrent calls.

Automatic execution outcomes: `resolved`, `failed`, and `needs_user`. Interactive teaching uses a separate `taught` outcome. On any normal runtime/agent exception, Neo captures a minimal `failed` case with a hashed handoff fingerprint and error class. A post-run model-generated candidate is labeled `source: postrun_model`. If the recorder fails as well, an incomplete candidate is marked `source: fallback` and contains no invented solution.

## Recorded fields

Each entry contains a normalized scenario key and category, generic symptom, outcome, strategy key, attempted steps, verification, failure reason, transferable lesson, observed tool names and counts, model family, capture timestamp, and `training_reviewed: false`. These are reusable experience candidates, **not trusted training samples**.

The library must not contain raw handoffs, command arguments, browser content, complete URLs, screenshots, cookies, passwords, OTPs, API keys or private paths. The CLI applies conservative redaction, but review and further anonymization are required before creating a training set. No automatic training, upload, or external publication happens.

The dedicated smoke test `neo escalation test` bypasses the case library so synthetic health checks do not pollute future learning.

## Operational limitations

Semantic deduplication is only as consistent as the agent's stable scenario and strategy classification. Equivalent problems given different keys may still produce separate entries. The case library captures a summary, not complete replayable tool trajectories. An uncatchable process kill or hardware failure may prevent the final record; recoverable failures are recorded.

## Full Challenge Ledger (separate from reusable cases)

A second private ledger records the **original complete unredacted handoff before any model inference** and keeps a compact attempt-start and finish record plus a replaceable last-stage checkpoint while running. The existing case library above continues to store concise sanitized teaching examples; the new Challenge Ledger does not redact the handoff, raw result or error/cause messages. It omits duplicate initial handoffs, repeated stack traces, empty fields and all completed-attempt stage logs. No chat transcripts or tool output streams are retained by this ledger.

```sh
neo escalation challenges
neo escalation challenges --search Build
neo escalation --handoff-file /absolute/handoff.md --correlation-id job/release/task/upload
```

The optional stable, opaque `--correlation-id` associates multiple attempts under one challenge even when the updated handoff changes. Without it, identical handoff bytes are grouped by SHA-256 fingerprint; changed text produces a new challenge. Each attempt has a unique ID and durable start and finish records. During execution, one replaceable checkpoint holds only the latest stage; it is deleted on completion, but survives an interrupted process. There are no accumulating stage logs. An original handoff, including updated handoffs on retries, is retained verbatim.

Default directory: `~/.local/share/neo/escalation/challenges/<challenge-id>/`; leaf directories use 0700 and JSON files 0600. Set `NEO_ESCALATION_CHALLENGES_DIR` for isolated tests. Output of `neo escalation challenges` is **unredacted**, may contain credentials and private data, and must only be inspected on a trusted Neo Master terminal or by an explicitly authorized reader. Do not upload, forward, or print the complete ledger in public logs. The CLI's ordinary escalation result still applies its existing public-output credential protections.

Errors are classified by execution stage and code, while the exact error message and nested cause messages are persisted, without repeated stack traces. Each stage updates a single crash-recovery checkpoint rather than appending diagnostic logs; a crash cannot fabricate a terminal outcome. The ledger does not execute automatic retries or perform any fallback to a cloud model.
