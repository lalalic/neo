# Neo skills

This directory is the canonical editable source for skills maintained with the
Neo workspace. Installed copies under ~/.codex and packaged XChat bootstrap artifacts
are deployment and distribution targets, not source of truth.

## Skills

- xchat-orchestrator — closed-loop cross-web-chat orchestration of local Codex work
  through GitHub pull requests.
- codex-handoff — deprecated Drive handoff protocol retained temporarily for
  migration only.
- video-director — Markcut-backed product-demo story and semantic shot intent;
  it deliberately excludes UI automation details.
- execution-director — stable semantic executable shot contracts for Demo Agent,
  with fresh-UI success criteria and explicit recovery boundaries.
- daemon-service-manage — inspection and PM2 lifecycle guidance for persistent
  daemons and services.
- devmacbridge — end-to-end Mac Developer Bridge bootstrap, ChatGPT MCP connection, browser setup, events federation, and verification.
- events-bus — correlated lifecycle/progress protocol and orchestrator display
  contract for long-running Neo jobs, including its internal event-bus transport.
- skill-builder — capability-first creation, review, and evaluation of agent skills.

Changes are made here first, tested locally, and then published/synchronized
to deployment targets by an explicit release operation.
