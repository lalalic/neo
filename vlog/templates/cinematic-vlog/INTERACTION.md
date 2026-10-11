# Episode interaction policy — pilot / autopilot

This is a declarative Vlog **template/agent contract**, not a Relay server feature. Every episode chooses a mode in its initial task input, saved as `execution/interaction-policy.json` in its ignored run directory. The episode agentGraph and producer/editor agents implement stage presentation, decision recording and timed continuation using capabilities **already available**. No Vlog scheduler, poller, browser daemon, or Relay server modifications are permitted. If an existing task/turn cannot stay alive or be durably resumed to honor a deadline, report `WAITING_FOR_CONTINUATION` and use a supported Relay continuation/resume path; **never** assert that a timer or an approval happened merely because a deadline was written to disk.

## Config

```json
{
  "mode": "pilot",
  "feedback_window_minutes": 60,
  "timeout_action": "advance_private_only",
  "implementation_thread_id": null,
  "reviewer_thread_id": null,
  "publish_authorized": false
}
```

`mode` is `pilot` or `autopilot`. The feedback window is a *per-stage* duration measured from a confirmed preview delivery timestamp, not render start or Job creation. A task may override the default of 60 minutes by supplying a positive integer; no deadline exists until preview delivery is confirmed. Thread IDs are bound by the owning Agents Relay Job, not invented by the agents. An active feedback/changes request always takes priority over a timeout; repeated previews issue a new draft hash and new deadline.

## Mode differences

| Stage | `pilot` | `autopilot` |
|---|---|---|
| Source + story + direction | Expose concise stage progress and first Markcut `video.md` preview to implementation thread | Work internally; retain artifacts and provenance |
| Draft / asset / audio iteration | Publish the playable `video.md` preview and stage highlights with source IDs and timecodes; accept edits and iterate | Run independent internal agent reviews, revise until both PASS |
| Intermediate feedback window | User approves via Markcut preview, requests changes or gives scene notes; if no feedback by deadline, policy-advance privately | No intermediate human wait |
| Final QA / review | Present final playable Markcut preview, Director+Market findings, actual MP4 QA and Approve/Request changes | **Only** present final review/preview; same approval control |
| No final response by deadline | Policy-approve **private completion only**, record `decision=timeout_auto_approved`, not human-approved | Same, independently configurable deadline |
| External publication | Requires a separate actual user authorization regardless of mode/deadline | Same |

## Reviewable gate protocol

For each stage that is externally exposed, generate or update the **same** canonical `video.md`, invoke existing `markcut.preview` on its absolute run path, and provide its playable experience plus a summary of changed scene IDs. Do not substitute `story.md`, a still image, or a link-only status message for an accessible Markcut preview. Markcut Approve/Request changes is the authoritative explicit feedback control where supported; text discussion in the same thread also counts as feedback. Separate `reviewerThreadId` is for independent reviewer decisions, not a generic preview delivery shortcut. `implementationThreadId` only routes eligible implementation tasks; an agent must arrange supported thread delivery and verify it. When delivery/interactive approval is not possible, mark `DELIVERY_BLOCKED`, not assumed success.

Write `reviews/interaction-events.jsonl` (append-only) with `{stage, video_md_sha256, preview_url, delivered_at, deadline_at, decision, decided_at, decision_actor, feedback, thread_id, delivery_receipt}`. Write `reviews/creative-approval.json` and `reviews/human-approval.json` as **materialized decisions** for the exact hash. Allowed decision labels: `explicit_approved`, `changes_requested`, `timeout_auto_approved`, `waiting`, `delivery_blocked`. For `timeout_auto_approved`, set `decision_actor: "policy"` and preserve the expiry evidence; NEVER set `decision_actor: "user"`. Manual approve requires recorded interaction evidence. When `video.md`/MP4 changes, invalidate earlier approvals/reviews for that artifact. `timeout_auto_approved` never bypasses source/rights checks, independent Video Director+Market PASS, actual QA PASS, or external-action authorization.

No response means *continue privately under policy*, not consent to publication, purchase, identity/voice cloning, data sharing, or other irreversible external action. If an episode-specific contract explicitly requires human-only approval, no timeout can override it.
