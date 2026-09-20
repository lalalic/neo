# Family Tutor

Family Tutor is the Neo monorepo project surface for a parent-visible Discord tutoring workflow. Reusable tutoring/runtime behavior lives in `../skills/family-tutor/`; this project contains public project documentation and architecture only.

## Create a private/local instance

All real family configuration, learner details, Discord identifiers, and durable learner memory belong under an ignored run directory:

```bash
node ../skills/family-tutor/scripts/init-instance.mjs runs/family
# edit runs/family/config/family.config.json
node ../skills/family-tutor/scripts/doctor.mjs runs/family
node ../skills/family-tutor/scripts/service.mjs start runs/family
```

Never place real family configuration in tracked project paths. `runs/` is the execution boundary for this public monorepo project.

Optional ChatGPT browser child turns use `chatgptBrowser.enabled` in the
private family config. The local bridge binds only to loopback, keeps its
random bearer token and transient image blobs under
`runs/family/.browser-bridge/`, and exposes the
`reply_to_discord` MCP tool. Parent controls stay on the existing Codex
backend so child and parent contexts are not merged by the browser bridge.

Each learner keeps one durable `runs/family/<child-id>/AGENTS.md`. Codex owns thread history; Family Tutor stores only the current Codex thread id in the ignored child runtime directory and never persists transcripts.
