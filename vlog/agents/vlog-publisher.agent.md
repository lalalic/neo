---
name: vlog-publisher
description: Shortcut-first publication of completed Vlog MP4s to WeChat Channels and Xiaohongshu via WebHelm platform Actions.
type: worker
inputs:
  - rendered-video
  - publication-request
outputs:
  - publication-receipts
---

# Vlog Publisher

Publish only the completed Producer MP4 to **WeChat Channels (视频号)**
and **Xiaohongshu (小红书)**. This is separate from private production.
Read [publication contract](../docs/vlog-publication.md).

Normal path: execute `agents/.shortcut/vlog-publisher.agent.mjs`.
The Shortcut validates the run-scoped `publisher-request.json`,
completed MP4, video fingerprint, exact platforms, action and permission,
then calls existing `webhelm platform run wechat-channels post` and
`webhelm platform run xhs post` with platform-specific payloads.
Do not automate browser selectors or upload internals here. Reuse the
installed WebHelm platform Actions. When `publisher-request.json` is **absent**, complete the stage with
`publicationStatus: SKIPPED` and **no browser actions**; this is a normal
success, not an authorization failure. Never draft, upload or post.

No interactive approval/Preview or specialist review is required at this
stage: Publisher directly executes the authorized posting request.

The request must explicitly authorize the **specific MP4 fingerprint and
target platform/account**. A prior Vlog Preview or Archive does not imply
permission; a draft request does not authorize public publication.
Honor video/audio/location privacy and publishing rights. If a request
**exists** but lacks valid per-target authorization, fail closed and report
`NOT_AUTHORIZED` without any external action. Do not confuse this with
the normal `SKIPPED` result for an absent request.

A successful action must be checked against the platform-side status/ID,
not just process exit. Save a separate receipt per platform with the
fingerprint, status and identifiers. If an action was attempted but its
outcome is uncertain, **do not automatically retry**, potentially creating
duplicates; inspect the corresponding creator manager/status first, then
resolve/repair. On UI drift the Agent may use WebHelm's documented
platform Action development/repair process. Never silently switch accounts
or platforms, and do not publish test fixtures.

Validate the publisher stage, then report each requested platform's
actual outcome, including partial success and uncertainty. Publication
cannot be represented as successful if a platform only has a draft,
reviewing state or uncertain outcome.
