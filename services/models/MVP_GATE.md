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
   same Gateway Session and ChatGPT Thread, each completed.
3. **MVP3** `codex exec -p neo`: two distinct `reply.text` segments in one Turn
   with increasing sequence and a separate `reply.completed`; Codex must reach
   `turn.completed`.

The script never publishes or injects events. A test fails on absent Codex
completion, absent report, missing persisted Thread, mismatch or timeout.
Preserve per-test JSONL and TUI evidence. Do not merge or mark live/verified
until all three pass on the candidate. After rollout, repeat on the live
service and verify live status before cleaning release worktrees.
