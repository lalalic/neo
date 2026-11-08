# Data Model: Chat Gateway

State lives in `~/.local/state/neo/chat-gateway/`. Files are private (mode 0600), written atomically (temp file then rename). Relay remains the authority for job state; nothing here is a job status store.

## ledger.jsonl (append-only)

One line per record, newest state wins by `key`.

- **Terminal Job Record**: `{ kind: "job", key: "job:<jobId>:<to>:<updatedAt>", jobId, title, to, repository, source: "event" | "reconcile" | "baseline", status: "pending" | "delivered" | "baseline", attempts, nextAttemptAt, deliveryId?, createdAt, deliveredAt? }`
- **Chat Report**: `{ kind: "report", id, text, level: "info" | "attention", jobId?, needs?: "work_node" | "phone" | "none", status: "stored" | "pending" | "delivered" | "coalesced", createdAt, coalescedInto? }`

## snapshot.json

- **Job Snapshot**: `{ updatedAt, jobs: { "<jobId>": { state, updatedAt } } }`. Used for baseline and reconciliation diffs only.

## env.json

- **Environment State**: `{ override: "office" | "home" | null, setAt?, lastResolved: { mode, source, since } }`.

## Rules

- A `key` is delivered at most once; a `baseline` record is never delivered.
- `delivered` requires an acknowledgement; a transport success without it stays `pending`.
- Notification text uses job title, terminal state, job id and repository only.
- The ledger keeps a bounded history (default 90 days); pruning never removes `pending` records.
