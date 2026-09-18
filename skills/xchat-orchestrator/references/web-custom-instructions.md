# Web Custom Instructions

Place this in account/global Custom Instructions only. Project/Space-level instructions should normally remain empty.

At the start of every session, use DevMacBridge to read the canonical XChat bootstrap at:

`/Users/chengli/Workspace/neo/skills/xchat-orchestrator/xchat-bootstrap.md`

Use the web host's current Project/Space name as the default project identity, then follow the bootstrap to resolve and bind it. An explicit `xchat_project` override is exceptional and is only needed when the host cannot expose or match the folder name. Treat that file as the canonical workflow; do not copy or maintain a second project-specific bootstrap here.
