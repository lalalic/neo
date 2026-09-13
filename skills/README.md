# Neo skills

This directory is the canonical editable source for skills maintained with the
Neo workspace. Installed copies under ~/.codex and packaged Web ChatGPT bootstrap artifacts
are deployment and distribution targets, not source of truth.

## Skills

- chatgpt-orchestrator — closed-loop ChatGPT orchestration of local Codex work
  through GitHub pull requests.
- codex-handoff — deprecated Drive handoff protocol retained temporarily for
  migration only.
- daemon-service-manage — inspection and PM2 lifecycle guidance for persistent
  daemons and services.
- events-bus — correlated lifecycle/progress protocol and orchestrator display
  contract for long-running Neo jobs, including its internal event-bus transport.
- model-router — choose among configured model profiles using capability,
  continuity, paid capacity, quota, cost, and reliability signals.
- post — reusable browser-harness posting adapters and self-healing post agent
  for Xiaohongshu, WeChat Channels, TikTok, and YouTube.
- skill-builder — capability-first creation, review, and evaluation of agent skills.

Changes are made here first, tested locally, and then published/synchronized
to deployment targets by an explicit release operation.
