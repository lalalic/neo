# Finished-film one-Scene Preview

When Producer Review is explicitly requested, run
`node vlog/scripts/final-film-to-md.mjs <run>` **after** the final MP4 and
production receipt have been verified. It creates `final-film-preview.md` with
one `finished-film` Scene referencing `output/video.mp4` (the complete,
already-rendered movie), never the Editor's component-heavy multi-Scene tree.
All graphics, voice and music are already inside that MP4. Keep the original
`video.md` as Editor source of truth. Producer needs no separate MP4
re-render and no per-Scene conversion. The script binds the exact MP4 and
Editor MD hashes from the Producer receipt, runs `markcut verify` and emits a
deterministic Markdown revision. Git Stage checkpoint includes the generated
single-Scene Markdown before Event Preview. Comments at Preview time map to
**finished-film timeline timecodes**; the Editor decides which underlying
shot/story to revise. Default Review OFF does not generate this extra MD.

# Producer human Preview event adapter

Relay owns the Task workflow and event contract. When the Producer is a managed Relay worker, build the Event Template from the **canonical injected Relay Event Contract**: `type: "task.interactive_decision"`, copy the exact authorized `source` from Task context, and set only immutable `data.interactive.jobId`, `taskId`, `executionId`, and a stable `invocationId` unique per review request. Those fields must match the current execution. Never prefill `decision`, `feedback`, `comments`, `revision`, `commitSha`, `previewId`, `requestId`, or `idempotencyKey`: the Preview UI fills them after the human submits feedback, then publishes through authenticated Events MCP. Never emit a Markcut-specific event, a Final Reviewer verdict, or terminal `task.completed` from Preview.

**Codex / terminal Producer on Neo Master:** Write the immutable template to a JSON file, run `neo project review checkpoint --project vlog --path <run> --stage producer` and use the returned SHA in `markcut preview <run>/final-film-preview.md --delivery event --event-template <absolute-template.json> --commit-sha <SHA>`. The CLI uses the Markcut hosted-preview compiler, then delivers the Neo-owned `mobile/review/notify` REST request to Neo Master for iPhone delivery. The CLI output `status: "review_requested"` means **the mobile inbox accepted the request only**. The phone must be reachable with Neo running; a failed request does not silently switch to Text. Review comments/decisions return asynchronously via Event Bus to Relay. The CLI does not await the human and does not itself resume a Codex thread. New video revisions need new invocation IDs; use the same `--request-id` UUID only when retrying an uncertain ACK for the same revision.

**ChatGPT-hosted Producer:** For a standalone text Preview, call `neo.markcut_preview` on the generated `final-film-preview.md` with `review: {delivery: "text"}`. For an actual Relay Event Review, use the Markcut CLI with current Task event template and verified full Git SHA; the Neo-hosted tool currently does not expose the required `commitSha` argument. Do not confuse a text-preview decision with a Relay Event decision, and never treat a compilation receipt as approval.

Stand-alone interactive ChatGPT Preview continues to use default `text` delivery through `ui/message`. In Relay mode, do not silently fall back to text on Event transport failure. Human approval binds the exact reviewed Git Commit SHA, not a cache/content hash. Relay accepts the event and records its decision, but **transport receipt alone does not mean the Producer was resumed**: the active Worker must consume its accepted decision or the authorized Relay continuation/recovery path must bring the original Task back. Do not claim review passed, render approved, or Task complete without current-version human approval and real playable/audible output. Repeated review requests must use new invocation IDs; retrying the same submission preserves its idempotency key.

Git-backed Project Run reviews must checkpoint the verified Producer through `neo project review checkpoint --project vlog --path <run> --stage producer` **before** `markcut preview --delivery event --event-template ... --commit-sha <40-char SHA>`. Relay review decisions bind the exact Git Commit SHA, not the Markcut compile fingerprint. Content hashes remain internal media cache identifiers only.
