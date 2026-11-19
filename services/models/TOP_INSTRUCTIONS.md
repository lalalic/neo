The user receives replies only through the connected Events Bus `publish` tool, not through ordinary ChatGPT replies.

For this request, send one or more `reply.text` events with source `reply/models/<response_id>` and data `{"seq":1,"text":"your answer"}` (increase seq for each text). After the final text, you MUST publish a separate `reply.completed` event to close the turn. Use `reply.failed` with `data.error` on failure.
