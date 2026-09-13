---
name: post
description: Publish prepared media/posts to Xiaohongshu, WeChat Channels, TikTok, and YouTube through reusable browser-harness adapters, with a post agent that verifies outcomes and self-heals stale UI automation when platform pages change.
---

# post

## What this skill enables

Publish prepared content through the user's already-authenticated Chrome session without rebuilding browser automation for every post.

Capability tree:

1. choose the correct platform adapter;
2. read the platform profile and create a platform-specific payload within its implemented fields and limits;
3. validate media and platform-specific fields before touching the browser;
4. run the existing deterministic browser-harness posting code;
5. verify the platform-side result instead of trusting a click or exit code;
6. classify failures and self-heal UI drift when safe;
7. persist a minimal adapter repair so the next post reuses it.

The bundled adapters were migrated from `~/Workspace/.browser-harness.zip`. They are the first choice. Do not manually re-drive a known platform unless its adapter failed or verification is inconclusive.

## Primary workflow

Use the dispatcher:

```bash
python3 ~/Workspace/neo/skills/post/scripts/post.py <platform> <platform args...>
```

Supported platform names:

```text
xhs | xiaohongshu
wechat-channels | wechat | channels
tiktok
youtube | yt
```

Before composing platform metadata or executing, read `references/platforms.json` (machine-readable field/capability/limit profile) and `references/platforms.md` (human-readable CLI/side-effect notes). The post agent should adapt one source story into distinct platform payloads rather than copy identical metadata across platforms.

Inspect a profile directly with:

```bash
python3 ~/Workspace/neo/skills/post/scripts/post.py --profile xhs
```

### Deterministic first

1. Confirm the media files exist and map the user's content to the adapter fields.
2. If the user asked to publish/post, that request authorizes the normal final publish action on the named platform(s); do not ask again merely because the adapter reaches the final button.
3. Run the platform adapter once.
4. Treat exit code `0` as **execution success, not publication proof**.
5. Use browser-harness to verify a platform-side success state, created content entry, matching title/caption, or other concrete evidence.
6. Report success only after verification.

For long-running/delegated posting, follow the `events-bus` skill: surface upload, submit, verification, blocked/failure, and completion milestones when event tools are available.

## Failure classification

Classify before changing code:

| Failure | Action |
|---|---|
| login expired, QR login, MFA, consent, ambiguous account | stop as `blocked`; ask the user to complete authentication; do not patch selectors |
| local validation/content limit/file missing | fail fast; fix input or report the exact constraint |
| transient upload/network/processing timeout | inspect current state; retry only when duplicate publication is ruled out |
| selector/DOM/shadow-DOM/UI drift | invoke the post agent self-heal workflow |
| submit outcome uncertain | verify creator/content management first; never blindly submit again |
| platform policy/review rejection | report the platform message; do not self-heal around policy enforcement |

## Self-heal workflow

Use `agents/post-agent.md` as the behavioral contract.

When UI drift is likely:

1. Start or retain a browser-harness recording for the repair attempt.
2. Inspect accessibility tree first; inspect DOM/shadow DOM or screenshots when necessary.
3. Identify the smallest stale assumption in `scripts/platforms/<platform>/_post_bh.py` or its CLI validation in `post.py`.
4. Patch only that platform adapter. Preserve the public CLI unless the platform itself now requires a new field.
5. Before retrying a final submit, inspect the platform's creator/content list to make sure the earlier attempt did not already publish.
6. Retry once with the repaired adapter.
7. Verify the result independently.
8. Keep a successful minimal repair in the skill so later posts reuse it. If the repair cannot be validated, restore/avoid speculative changes and report the blocker.

Do not "self-heal" by bypassing login, CAPTCHA, MFA, policy checks, audience controls, or confirmation semantics.

## Safety and side effects

- A user's explicit request to post/publish specific content to specific platform(s) is sufficient authorization for that publication.
- A request to prepare, preview, or draft is not authorization to publish.
- TikTok's bundled adapter posts directly; do not invoke it for draft-only requests.
- XHS and WeChat Channels can remain draft unless `--publish` is supplied.
- YouTube defaults to `PRIVATE`; visibility must match the user's requested state.
- Never retry an uncertain final-submit operation until duplicate publication has been ruled out.
- Never expose or copy cookies/tokens. Use the authenticated Chrome session through browser-harness.

## Implementation boundary

The model decides failure classification, repair strategy, and whether verification is sufficient. Deterministic code owns field validation, file-path normalization, platform-specific browser steps, and the normal publish flow.

Do not move stable platform mechanics back into prompt prose. If a repair proves reusable, encode it in the platform adapter.

## Files

```text
scripts/post.py                         unified dispatcher
scripts/platforms/xhs/                 Xiaohongshu adapter
scripts/platforms/wechat-channels/     WeChat Channels adapter
scripts/platforms/tiktok/              TikTok adapter
scripts/platforms/youtube/             YouTube adapter
agents/post-agent.md                    run/verify/self-heal behavior
references/platforms.json               machine-readable fields, limits, capabilities
references/platforms.md                 platform CLI and semantics
```
