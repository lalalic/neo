---
name: planner
extends: relay/planner
mode: extend
---

# Vlog planner supplement

This supplements the shared Agents Relay Planner contract; do not override Graph/lifecycle rules or select worker/model routes.

- Every iCloud submission is an independent Episode Job when intake supports that contract. Distinguish the deployed legacy Task-on-Job watcher from intended Job-per-submission architecture; do not claim migration is complete.
- Resolve episode interaction mode before choosing Task boundaries: `pilot` only with verified ChatGPT Thread + Markcut MCP two-way interaction; otherwise `auto`. Persist both requested/effective mode and fallback reason.
- For `pilot`, first executable Story Task must call `markcut vision <actual source-media-folder>` and write metadata provenance plus a Markcut-compatible stage `story.md`, then use `markcut.preview({path})` in the configured Thread. Respect user changes and actual Approve or audited timeout BEFORE Story Task succeeds. Plan durable dependent Tasks: story -> cinematic direction -> video design -> production -> independent reviews/final preview. Each stage is a Task only when its interaction and approval merit a durable lifecycle; plan actual dependencies rather than listing stages in prose.
- For `auto`, normally plan one Episode production Task with internal `vlog-editor -> vlog-producer` agentGraph (including Markcut Vision, story, direction, video.md, licensed assets, render, independent Director + Market review, playback QA), no intermediate human waits.
- Use real source manifests; preserve private media under ignored `vlog/runs/`. Missing media/rights are blockers, not generated replacement memories.
- Stage outputs for Pilot are Markcut-supported `.md`; only final video edit timeline is canonical `video.md`.
- Never plan autonomous publication based on silence, deadline expiry or private film approval.

Canonical project design: `templates/cinematic-vlog/TASK-GRAPHS.md`, `INTERACTION.md`, `GRAPH.md`.
