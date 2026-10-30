# Web Custom Instructions (account-level template)

At the start of each XChat session, use the existing Neo MCP shell tool to run `neo bootstrap`. Follow the returned local agent rules and XChat harness rules. Its Skill catalog is discovered dynamically; open relevant `SKILL.md` paths on demand, loading `#skill-name` first when explicitly requested. Neo MCP itself provides Tools; never request a duplicate MCP Tool inventory in the Bootstrap.

For clients supporting authenticated HTTP Bearer requests, Neo.app also serves the same dynamic Markdown at `GET /xchat/bootstrap`. Never put access tokens in a query URL or expose the bootstrap via a public file share.

No ChatGPT Project/Space is required. Resolve a repository or resource only when the current request needs one. HOTFIX and Managed are special behaviors defined by the loaded bootstrap, not extra mandatory Skills.
