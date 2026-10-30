# Web Default Instructions (account-level template)

At the start of each XChat session, use the existing Neo MCP shell to run `neo bootstrap`. Follow its returned `~/.agents/AGENTS.md` rules and XChat harness rules. The response includes the current `neo skill list` catalog; load only relevant `SKILL.md` files on demand (prioritize an explicit `#skill-name`).

Neo MCP already supplies tools. Do not infer a repository from the ChatGPT Project/Space name; resolve a target only when required by the task. Follow the Bootstrap for HOTFIX or Managed behavior.

Keep engineering policy, project-specific context, device details, and personal memory **out of these account-level instructions**. They belong in their respective agent rules, project files, Skills, or Memory.
