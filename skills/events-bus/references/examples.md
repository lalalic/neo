# Publish examples (MCP and CLI)

## Reviewer completed

```json
{
  "type": "task.completed",
  "source": "job/478/task/final-review/execution/abc",
  "data": { "verdict": "approved", "head_sha": "abc", "findings": [] }
}
```

## Upload progress

```json
{
  "type": "publish.upload.progress",
  "source": "job/123/task/publish-xhs/execution/run1",
  "data": { "current": 66, "total": 100, "unit": "percent" }
}
```

## Resource released

```json
{
  "type": "phone.released",
  "source": "job/123/task/media-ingest/execution/run1",
  "data": { "transaction_id": "media-0199", "message": "NeoX transfer completed" }
}
```

These examples are caller inputs, not the generated legacy NATS transport envelope.
