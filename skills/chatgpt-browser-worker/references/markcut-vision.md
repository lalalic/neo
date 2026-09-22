# Markcut Vision integration

Markcut already exposes generic image-to-text and video-to-text command
templates through `vision --itt` and `vision --vtt`. Use those extension
points for Browser ChatGPT. Do not add a ChatGPT-specific Markcut command.

The Neo synchronous inference executable is:

```sh
/Users/chengli/Workspace/neo/skills/chatgpt-browser-worker/bin/chatgpt-browser-infer
```

It accepts `--prompt`, one or more `--file` attachments, and optional
`--expect-json`. Markcut's command templates provide `{prompt}` and `{input}`
placeholders, so the direct templates are:

```sh
CHATGPT_INFER=/Users/chengli/Workspace/neo/skills/chatgpt-browser-worker/bin/chatgpt-browser-infer

ITT="$CHATGPT_INFER --prompt \"{prompt}\" --file {input}"
VTT="$CHATGPT_INFER --prompt \"{prompt}\" --file {input}"
```

Use Browser ChatGPT for both image and video perception:

```sh
markcut vision ./media \
  --itt "$ITT" \
  --vtt "$VTT"
```

Use it only for image perception while keeping Markcut's default VTT:

```sh
markcut vision ./media --itt "$ITT"
```

Or provide the templates inline:

```sh
markcut vision ./media \
  --itt '/Users/chengli/Workspace/neo/skills/chatgpt-browser-worker/bin/chatgpt-browser-infer --prompt "{prompt}" --file {input}' \
  --vtt '/Users/chengli/Workspace/neo/skills/chatgpt-browser-worker/bin/chatgpt-browser-infer --prompt "{prompt}" --file {input}'
```

The same templates can be supplied through Markcut's existing
`MARKCUT_ITT_CLI` and `MARKCUT_VTT_CLI` environment variables when persistent
configuration is more convenient.

Browser ChatGPT inference requires the authenticated browser harness to be
available. Each invocation creates a fresh owned Temporary Chat, waits for the
attachment and response, returns the assistant text on stdout, and cleans up
the owned tab. For prompts that require machine-readable JSON, append
`--expect-json` to the corresponding template.

Video input is attached directly by this generic integration. If direct video
inference is too slow or is rate-limited, keep Markcut's `--vtt` pointed at a
different backend rather than adding media-specific fallback logic to Markcut.
