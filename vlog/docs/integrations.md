# Local integrations


`<run-root>` means `YYYY-MM-DD[-slug]` for a standalone/daily Vlog, or `<series-name>/YYYY-MM-DD[-slug]` for a real named series.
## Markcut

Use the installed Markcut skill/tooling available in the current Neo environment. Do not hard-code a user-specific checkout path.

From `vlog/`:

```sh
npx @lalalic/markcut verify templates/travel-day.md
npx @lalalic/markcut preview runs/<run-root>/vlog.md --storyboard
npx @lalalic/markcut preview runs/<run-root>/vlog.md
npx @lalalic/markcut render runs/<run-root>/vlog.md --output runs/<run-root>/output/vlog.mp4
```

The sample episode uses silent components so verification does not require generated speech or images. The travel template contains placeholders that must be replaced with a real story and selected media before production. Preview may add a deterministic seed to the source and starts its editing interface. Stop the preview process when review is finished.

For real footage, run `npx @lalalic/markcut vision <episode-assets-folder>` and retain its metadata. Do not ask the producer to substitute a generic vision summary. Media generation remains in Markcut's configurable harness. Keep narration duration derived from audio and use `isBackground:true` on the accompanying visual.

## NeoX

Use the installed NeoX phone MCP skill/tooling available in the current Neo environment. Do not hard-code a user-specific checkout path.

The bootstrap does not read the phone library. At ingestion time open NeoX on the phone, resolve its LAN endpoint using Bonjour, discover `tools/list`, then search, sample, export selected media, download and verify, and clear staged exports. Do not hardcode an old phone IP. Store asset IDs and relative local paths in an episode manifest.

An optional local phone-to-agent bridge may enqueue Vlog handoffs. Discover its configured local endpoint at runtime; do not commit LAN addresses, usernames, queue paths, or machine-specific service details. A shared queue must be peeked before claiming so one producer does not consume another workflow's handoff.

## Model profiles

The local Codex configuration inspected on 2026-09-11 defines providers `deepseek`, `zai`, and `openrouter`, but no named `[profiles.*]` sections. Provider definitions are not executable model profiles, and successful authentication was not tested. Project routes are logical selections until connected to a worker.

Keep provider credentials in the user's existing environment. For dispatch, resolve a profile to an actual model and supported provider interface, perform one small capability test, and record which profile actually ran. Do not silently fall back from a cheap route to the strongest model. Three failed attempts with the same approach require a different approach or user guidance.

Codex desktop subagent model selection and a future standalone worker's provider profiles are separate mechanisms.
