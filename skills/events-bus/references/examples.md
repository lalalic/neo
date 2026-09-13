# Neo event examples

## Upload progress

```json
{
  "version": 1,
  "event_id": "0199-upload-66",
  "job_id": "0199-job",
  "orchestrator_id": "chatgpt:web",
  "task_id": "publish-xhs",
  "parent_task_id": null,
  "type": "publish.upload.progress",
  "status": "running",
  "timestamp": "2026-09-13T19:12:00Z",
  "source": {"agent": "codex", "host": "chengli.local"},
  "visibility": "user",
  "level": "info",
  "message": "小红书视频上传中 66%",
  "progress": {"current": 66, "total": 100, "unit": "percent"},
  "data": {}
}
```

## NeoX released

```json
{
  "version": 1,
  "event_id": "0199-phone-released",
  "job_id": "0199-job",
  "orchestrator_id": "chatgpt:web",
  "task_id": "media-ingest",
  "parent_task_id": null,
  "type": "phone.released",
  "status": "succeeded",
  "timestamp": "2026-09-13T19:05:00Z",
  "source": {"agent": "producer", "host": "chengli.local"},
  "visibility": "user",
  "level": "info",
  "message": "NeoX 素材传输已完成，现在可以正常使用手机了",
  "data": {"transaction_id": "media-0199"}
}
```
