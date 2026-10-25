# Vlog canonical intake contract

This is the Vlog-owned wire contract for Neo Mobile and the iCloud Inbox watcher. Bulk originals stay in the app-owned iCloud Inbox; do not send them through public Neo MCP or remote HTTPS. For LAN intake, only the already-authorized local phone-media export path may carry originals.

## Submission manifest (schema version 2)

`manifest.json` is written last and is the final-submission marker. It must contain:

```json
{
  "schema_version": 2,
  "submission_id": "stable-unique-id",
  "master_id": "selected-master-id",
  "source_mode": "manual_icloud",
  "submitted_at": "2026-10-25T18:00:00Z",
  "authenticated_submission": {
    "subject_id": "authenticated-principal",
    "issuer": "neo-core",
    "assertion_id": "auth-assertion-id",
    "authenticated_at": "2026-10-25T17:59:00Z"
  },
  "source_approval": {
    "status": "approved",
    "authorization_id": "owner-approval-id",
    "approved_at": "2026-10-25T17:59:30Z",
    "media_ids": ["asset-id"]
  },
  "media": [{
    "media_id": "asset-id",
    "path": "media/original.mov",
    "size_bytes": 12345,
    "sha256": "lowercase-sha256"
  }]
}
```

`source_mode` is `manual_icloud` or `auto_lan`. Authentication identifies who submitted the request; approval records permission to use each exact asset. Both are required and must not be inferred from `master_id`, a folder name, or an approval boolean elsewhere. The authenticated principal/assertion must originate from Neo Core's authenticated session. Approval must cover every `media_id` in the manifest.

Each media file must be a relative path contained in the submission directory, a local regular file, non-empty, and fully downloaded. `size_bytes` and `sha256`, when supplied, are checked before acceptance. iCloud placeholders, absent files, mismatched lengths and checksums leave the submission incomplete. The watcher leaves an incomplete submission in Inbox, writes its observed readiness/completeness separately under its dated run, and reports `late-incomplete` after the configured age threshold. The manifest must only be written once the producer is done; the watcher rechecks all files on every scan.

## Lifecycle boundaries

| Concern | Owner and values |
| --- | --- |
| Submission identity | `submission_id`, `master_id`, `source_mode`, `authenticated_submission` in the manifest |
| Permission to use sources | `source_approval.status`, authorization reference, time, and covered `media_ids` |
| Media readiness/completeness | Watcher-observed `runs/<YYYY-MM-DD-slug>/intake.json`: `unknown`, `incomplete`, `ready`; separately `unknown`, `incomplete`, `complete` |
| Processing/review lifecycle | Agents Relay's single Episode Task and graph; the watcher records `not-created` or the accepted Task identity, and must not claim review or finish states |

After source approval and complete local media, the watcher atomically moves the submission to `runs/<YYYY-MM-DD-slug>/input/`, records the accepted source manifest as `source-manifest.json`, then creates one top-level Episode Task with stable ID `vlog-episode-<submission_id>` and idempotency key `vlog-episode:<submission_id>`. The Task uses the canonical `vlog-editor -> vlog-producer` graph and writes its story to `runs/<YYYY-MM-DD-slug>/story.md`. A rescan recovers a crash after moving the submission and before Task creation. Relay owns downstream processing/review status.

## Agents Relay Job binding

Configure `VLOG_RELAY_REPO` and the existing watcher PR `VLOG_RELAY_PR`. `VLOG_RELAY_JOB_ID` is an optional explicit binding. If omitted, the watcher uses the supported `agents-relay job adopt --repo OWNER/REPO --pr NUMBER` operation, which allocates a numeric SQLite Job identity and binds the existing PR; it does not access Relay storage directly. Task creation uses the Relay CLI's supported `--idempotency-key` and stable `--task-id` options. No per-submission Job or duplicate Episode Task is created.

Neo Mobile must emit the fields above and preserve their distinctions. The `master_id`, `source_mode`, `submission_id`, authenticated identity reference, approval reference and exact approved asset IDs are the cross-project wire fields; readiness and Relay lifecycle remain Vlog/Relay observations, not mobile assertions.
