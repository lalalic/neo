# Target resolution

Resolve targets from HANDOFF.md alone. Expand ~ to /Users/chengli.
For Folder: <path> with no repository, use /Users/chengli/Workspace/<path>
directly and create it only when the task explicitly requires creation. If it
lies inside a Git worktree, report the containing repository, branch, and
pre-change SHA while preserving unrelated changes.

For Repo: <identity> with no folder, validate an explicitly supplied absolute
local root. Otherwise inspect only direct children of /Users/chengli/Workspace,
compare each origin remote to the expected identity, and require exactly one
match. Both fields active, or unresolved ambiguity, is a failure with no
repository changes.
