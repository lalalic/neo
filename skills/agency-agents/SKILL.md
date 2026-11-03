---
name: agency-agents
description: Neo-owned required specialist Agent Pool for Neo Projects. Select verified reusable Agency Agents roles for research, design, engineering, marketing, operations, security or QA; read only the selected role instructions on demand. Not a standalone worker runtime.
---

# Agency Agents — Neo Required Agent Pool

This is a Neo-owned Skill. Neo Projects require this **role-selection capability**; they do not load 283 personas at startup. Source: [Agency Agents](https://github.com/msitarzewski/agency-agents).

## Select and use a role

1. Preserve a domain-specific project Agent when it owns project behavior.
2. For generic expertise, inspect `~/.local/share/agency-agents/integrations/dsh/` and select the narrowest existing `agency-<slug>/SKILL.md`. Read only that file.
3. If the role library is absent, run the Neo-owned `skills/agency-agents/setup.sh` installer to recover the official source and generated roles. Do not silently turn a missing role into a valid graph node.
4. Upstream role Skills are not automatically Relay Agent manifests. Check Agent discovery and the actual PromptBuilder result before using an Agent ID in `graph.mmd` or reviewers; otherwise adapt the selected role or reuse a verified fallback.
5. Project artifacts, permissions and review contracts override generic persona instructions. Relay owns scheduling and execution, and Agency Agents supplies expertise only.

## Source and refresh

The role library is maintained separately from Neo's tracked files at `~/.local/share/agency-agents` so 283 generated files are neither duplicated in Git nor installed as 283 global top-level Skills.

Install or verify with `skills/agency-agents/setup.sh` from the Neo repository. The role library is generated using the upstream repository's official `./scripts/convert.sh --tool dsh`; the generated output lives under `integrations/dsh`. To refresh, update the upstream checkout and rerun that converter, then verify the selected role files. This Skill is discovered via `neo skill list` from the canonical Neo repository; no global `~/.agents/skills/agency-agents` entry is needed.

This is a required **Neo Project capability**, not one of Neo.app's required global infrastructure Skills. It must not trigger application startup work or 283-role prompt expansion.
