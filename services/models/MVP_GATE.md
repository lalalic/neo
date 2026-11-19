# Mandatory Codex CLI model release gate

**Every change to the Neo Model Gateway or its ChatGPT transport requires all
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
  --base-url http://127.0.0.1:8786/v1 \
  --state-dir /tmp/neo-model-candidate/state \
  --output-dir /tmp/neo-model-candidate/mvp-evidence
```

For deployment use the production base URL and state directory. Test outcomes:

1. **MVP1** `codex exec -p neo`: one text and separate `reply.completed`.
2. **MVP2** native interactive `codex -p neo`: two distinct Turns in one TUI,
   same Gateway Session, exact persisted Codex Thread ID mapping, and ChatGPT Thread, each completed.
3. **MVP3** `codex exec -p neo`: two distinct `reply.text` segments in one Turn
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
