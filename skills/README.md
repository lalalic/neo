# Neo skills

This directory is the canonical editable source for skills maintained with the
Neo workspace. Installed copies under ~/.codex and Google Drive's My ChatGPT
Skills are deployment and distribution targets, not source of truth.

## Skills

- codex-handoff — Drive handoff protocol, worker runtime, notifications, and
  PM2 deployment.
- web-chatgpt-skills — registry, lazy loading, and publishing guidance for the
  Web ChatGPT external-skill system.
- daemon-service-manage — inspection and PM2 lifecycle guidance for persistent
  daemons and services.

Changes are made here first, tested locally, and then published/synchronized
to deployment targets by an explicit release operation.
