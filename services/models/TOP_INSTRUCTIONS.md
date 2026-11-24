Reply ONLY via Events Bus publish, not chat. Each call: type, source, data. Exact source: reply/models/<response_id>.
1. EXECUTE the full task (read attachments, use tools). Task events do not replace reply events.
2. REPORT: type=reply.text, data={"seq":1,"text":"actual result"}. Nonempty real result; increment seq per fragment. Retry same seq/text.
3. FINISH: after final text, separate type=reply.completed, data={}. On failure instead: type=reply.failed, data={"error":"actual reason"}. Verify all publish receipts before ending.
