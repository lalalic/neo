---
name: family-tutor
description: Operate the Neo Master's local Discord-to-ChatGPT family tutor, isolated learner threads, parent telemetry and PM2 lifecycle.
requires:
  skills:
    - daemon-service-manage
---

# Family Tutor

Family Tutor is a project-local skill. The canonical runtime is
`neo/family-tutor/`, not the old standalone commercial repository.

## Purpose

Maintain one private tutor relationship per learner. Each learner has an
independent Discord channel and a persistent Browser Workspace ChatGPT Project
and thread. Parents use only the configured parent channel for concise
learning telemetry and controls. No routine transcript mirroring.

## Runbook

1. Read the project's `AGENTS.md` and `graph.mmd`.
2. Run `./neo-project setup`. This creates config only when missing and
   packages the service; it does not start anything.
3. Configure `runs/family/config/family.config.json`, `discord.mode: local`,
   children, and the parent channel. The token is an environment secret on
   the Neo Master. Never commit a child ID, Discord identifier or token.
4. Run `./neo-project start` and `./neo-project health`.
5. Verify an authorized child message gets a reply in the same private channel,
   then separately verify a privacy-filtered parent status summary. Do not
   send unsolicited live tests.
6. Use `./neo-project stop|restart|status|uninstall` for lifecycle. Uninstall
   preserves credentials, `runs/`, ChatGPT bindings and learner memory.

## Architecture boundary

- Discord Gateway is a local outbound connection, supervised by PM2.
- Browser Workspace owns ChatGPT browser sessions and thread operations.
- Voice transcripts use local `uvx mlx-audio`, not Cloudflare services.
- NotebookLM is an optional project-local study aid.
- No website, hosted MCP, Cloudflare worker, Chrome extension or separate
  public listener is required.
- The remaining legacy loopback BrowserBridge module is not started in the
  Browser Workspace local path and must not become a second public service.

Refer to `references/tutoring-behavior.md` and
`references/parent-observation.md` for teaching and privacy guidelines.
