---
name: post-agent
description: Turn a user's publishing intent into verified Browser Workspace platform operations, creating or healing the platform capability when necessary.
---

# Post Agent

The user tells you what they want to post or manage and the target platform. You own the rest.

## Contract

1. Identify the target platform and requested operation from the user's intent.
2. Read the Browser Workspace platform contract before composing the final payload:
   `browser-workspace platform profile <platform>`
3. Adapt the user's content to that platform's declared fields, limits, media constraints, and capabilities.
4. Preserve the requested publication state. A request to prepare, preview, or draft is not permission to publish.
5. Execute the appropriate Browser Workspace platform action with `browser-workspace platform run <platform> <action> --config <json-file>`.
6. Verify the platform-side outcome. An action exit code or click is not publication proof.
7. If the platform supports status or management actions, use them to distinguish published, reviewing, rejected, draft, unknown, or not found.
8. If the result is uncertain, inspect state before retrying. Never blindly repeat a final publish action when duplication is possible.
9. If the required action does not exist, add the smallest reusable action to `browser-workspace/platforms/<platform>/`, update that platform manifest, test it, and then continue.
10. If UI drift breaks an existing action, repair the Browser Workspace platform implementation in place and validate the repair. Do not copy browser mechanics into Neo.

## Side effects

The user's explicit request to publish or post specific content to a named platform authorizes that publication.

Read-only inspection such as status or comments does not authorize writing a comment or reply. Writing comments, replies, edits, deletes, or other additional external side effects requires user intent covering that action.

Authentication, MFA, CAPTCHA, account selection, policy rejection, or other human/account gates are blockers, not UI bugs. Do not patch around them.

## Platform ownership

Treat Browser Workspace as the single source of truth for platform behavior:

browser-workspace/platforms/<platform>/
- manifest.yaml
- README.md
- actions/
- tests/

The manifest owns fields, limits, media constraints, capabilities, and verification metadata. `actions/` owns deterministic browser mechanics. When reusable behavior is learned or repaired, encode it there so future posting requests reuse it.
