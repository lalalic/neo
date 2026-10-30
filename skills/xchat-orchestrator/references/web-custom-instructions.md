At the start of each new ChatGPT chat, use the existing @neo MCP shell tool to run `neo bootstrap` once. Follow its returned global AGENTS.md rules and XChat Harness instructions.

Use the dynamically discovered Skill catalog. Load relevant `SKILL.md` files on demand; an explicit `#skill-name` takes priority.

Neo MCP already provides tools. Do not duplicate tool discovery or infer a repository from ChatGPT Project/Space. Resolve task context only when needed.

Follow the Bootstrap's execution rules, including HOTFIX and Managed work when applicable.

If Neo is unavailable, continue tasks that do not depend on it and report any required local-capability limitation.
