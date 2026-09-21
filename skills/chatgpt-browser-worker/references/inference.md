# Synchronous browser inference

`bin/chatgpt-browser-infer` is the stable local integration surface for tools that need a synchronous ChatGPT result from attached media. It is separate from the delegated `browser-worker` agent contract.

The command opens a fresh worker-owned Temporary Chat tab, uploads each `--file`, waits for attachment processing and a verified user turn, waits for a complete assistant result in that same tab, then closes the owned tab. It never reopens a conversation. `--expect-json` requires the complete assistant text to be JSON or a single whole-response JSON code fence; successful fenced responses are normalized to plain JSON. Incomplete, prose-wrapped, or failed attempts are retried in a fresh owned tab, up to `--attempts`.

Example:

```sh
chatgpt-browser-infer \
  --prompt 'Return exactly one JSON object describing this image.' \
  --file ./frame.jpg \
  --expect-json
```

This surface is intended for local authenticated inference such as Markcut ITT/VTT. Delegated repository/tasks continue to use the `browser-worker` agent and its task/PR or file output contract.
