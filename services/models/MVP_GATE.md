# Mandatory Codex CLI model release gate

**Every change to the Neo Model Gateway, its release gate, or WebHelm ChatGPT transport requires all
three actual Codex CLI MVPs to pass before merging or activating the change.**
Unit/integration tests, manual `publish`/`chat_report` calls, synthetic reports,
and MCP-injected completion events DO NOT count as MVPs.

Do not create, select, or test through a dedicated **Neo Models** Tab Group.
The Gateway only accepts WebHelm Sessions from the shared `WebHelm` workspace;
leave user browser groups untouched. The gate itself does not configure workspaces.

Run on Neo Master against the exact built/restarted candidate. Prerequisites:
Codex CLI, the connected `events.publish` tool, a logged-in ChatGPT WebHelm
Session, and Python `pexpect`. Verify the chosen target has its own state dir.

```sh
python3 services/models/mvp-gate.py \
  --phase candidate \
  --base-url http://127.0.0.1:8786/v1 \
  --state-dir /tmp/neo-model-candidate/state \
  --output-dir /tmp/neo-model-candidate/mvp-evidence
```

**Fail-closed release contract:** after `candidate` outputs
`all-3-mvps-pass.json`, merge/push/reload the exact matching source. Then run:

```sh
python3 services/models/mvp-gate.py \
  --phase live \
  --base-url http://127.0.0.1:8769/v1 \
  --state-dir "$HOME/.local/share/neo/model-gateway" \
  --output-dir /tmp/neo-model-release/live-evidence \
  --candidate-evidence /tmp/neo-model-candidate/mvp-evidence/all-3-mvps-pass.json
```

**Both** gate invocations must exit 0 and print `ALL_3_MVPS_PASS`.
An unfinished or failed live gate is a **failed release**, even if production
is responding to health checks. Roll back or fix/retest it; never mark the
change delivered. Both gates verify the source fingerprint (Gateway and
installed ChatGPT Actions) so candidate evidence cannot be reused for a
different build. Gate output is cleared before any retry, and failed runs
never leave a new pass certificate. MVP 2 is strictly one Send per Turn;
no speculative extra Enter while waiting for a model response.

Test outcomes:

1. **MVP1** `codex exec -p neo -c 'model="chatgpt"'`: one text and separate `reply.completed`.
2. **MVP2** native interactive `codex -p neo -c 'model="chatgpt"'`: two distinct Turns in one TUI,
   same Gateway Session, exact persisted Codex Thread ID mapping, and ChatGPT Thread, each completed.
3. **MVP3** `codex exec -p neo -c 'model="chatgpt"'`: two distinct `reply.text` segments in one Turn
   with increasing sequence and a separate `reply.completed`; Codex must reach
   `turn.completed`.

The script never publishes or injects events. A test fails on absent Codex
completion, absent report, missing persisted Codex/ChatGPT Thread mapping, mismatch or timeout.
Preserve per-test JSONL and TUI evidence. Do not merge or mark live/verified
until all three pass on the candidate. After rollout, repeat on the live
service and verify live status before cleaning release worktrees.

### Exact Codex Thread identity (required)

No message matching is permitted. The `thread-id` HTTP header is the Codex
conversation UUID, and the persisted Gateway Session records `codexThreadId`
and `threadId` (ChatGPT). The gate checks the Codex `thread.started` event
against the saved mapping and verifies the native TUI Turn retains both IDs.
For a separate-process `codex resume <UUID>` check, verify that the second
process retains the same Codex UUID and reuses the mapped ChatGPT Thread.
Do not use the `Neo Models` Tab Group.

The gate intentionally **pins the ChatGPT model** rather than reading the
`neo` Codex Profile default (which may be `z`). This preserves the mandatory
Events Bus verification after adding additional browser-backed models.
Each new backend also requires its own real provider E2E acceptance tests;
three ChatGPT MVP passes alone cannot certify Z.ai.

## Additional mandatory Z.ai acceptance gate

The three ChatGPT MVP passes do **not** certify the `z` backend. Before
merging or activating a Z.ai Gateway change, run and preserve separate
**real Codex** Z.ai acceptance evidence from the candidate and again from
live production:

1. **Z MVP1:** `codex exec -p neo -c 'model="z"'` returns an exact reply
   after automatic one-hour Token issuance, Z.ai bootstrap in a real Thread,
   observed `NEO_BOOTSTRAP_PASS`, actual Z.ai `chat:completion done=true`,
   and OpenAI `response.completed`.
2. **Z MVP2:** two native Codex TUI Turns in the **same** Codex UUID resume
   the exact same persisted Z.ai Thread. Both actually complete. A browser
   user-message match cannot replace the explicit Codex ID map.
3. **Z MVP3:** the Z.ai webpage's genuine SSE stream yields separate
   observable output deltas and a terminal completion, without manufactured
   Z replies, a single lump falsely labeled streaming, or re-submission.

Tests, synthetic WebHelm receipts, a mere accepted user message, an HTTP 200
without the site's `done=true`, and ChatGPT's own three-MVP gate cannot be
reported as Z acceptance. If any Z gate is blocked by Z.ai tooling or site
latency, fail closed and leave the production `neo` profile unchanged.
