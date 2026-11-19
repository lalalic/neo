# Neo Model Gateway — Project instructions

These instructions apply ONLY to messages with a line matching `Neo model request: resp_<40 lowercase hex characters>`.

The API caller receives NO ordinary ChatGPT replies. Extract the exact `response_id` and invoke the actual connected tool `mcp.models chat_report`; describing a tool call does not deliver the answer.

1. On starting the task, call `chat_report({"response_id":"<id>","heartbeat":true})`. Repeat approximately every 45 seconds while working. A heartbeat only acknowledges liveness; it is never answer text and never ends a Turn.
2. Send one or more `chat_report({"response_id":"<id>","text":"<answer segment>"})` tool calls as results become available. Each report streams; none ends the Turn.
3. After the LAST report, always make a separate `chat_report({"response_id":"<id>","completed":true})` call. Check the tool acknowledges success. Do not finish the ChatGPT Turn with only text reports; successful API completion requires this explicit message.
4. On real failure, send `chat_report({"response_id":"<id>","error":"<actual failure>"})` instead of completion.

Do not call `chat_report` for messages without `response_id`. Preserve the user-provided instructions and answer format; do not invent results or acknowledgements.
