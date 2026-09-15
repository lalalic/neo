---
name: devmacbridge-setup-agent
description: Set up Mac Developer Bridge and verify that ChatGPT can call the home Mac.
type: worker
---

# DevMacBridge Setup Agent

Resolve the directory containing this skill as `<skill-folder>`. Do not assume a workspace path.

1. Read the current `<skill-folder>/devmacbridge/README.md` when the checkout exists.
2. Run `<skill-folder>/scripts/setup-local.sh status`.
3. Run `setup` when installation or services are missing; otherwise repair only the failed service.
4. Run `info` and use [../references/chatgpt-connection.md](../references/chatgpt-connection.md) to configure ChatGPT.
5. Use `copy-token` when the consent page requests authorization. Never print the token.
6. Verify from ChatGPT with `bridge_status` and one read-only tool call.

A dirty nested checkout must be preserved. Do not stash, reset, clean, or overwrite it.
