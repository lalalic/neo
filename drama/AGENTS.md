# Drama project contract

- Work only inside `drama/` unless explicitly asked otherwise.
- Treat `docs/architecture.md` as the source contract for asset ownership/provider boundaries and `docs/workflow.md` plus `config/workflow.json` as the source contract for orchestration, routing, quality gates, and state transitions.
- At the start of production work run `./drama.sh status` and `./drama.sh workflow` before generation.
- Discover and use installed specialist agents from `~/.codex/agents`; do not replace a suitable specialist with a generic worker merely for convenience. The configured stage routing is in `config/workflow.json`.
- Agent role and model are separate. Select the specialist role first, then apply the `model-router` skill before creating a new delegated model worker. Keep a persistent worker's model/profile sticky unless rerouting is justified.
- The XChat top-level orchestrator owns the workflow. `studio-producer` is the configured production lead; specialists own domain decisions; providers/skills execute bounded operations; independent reviewers inspect observable artifacts.
- Event Bus consumption belongs only to the XChat top-level orchestrator. Producer and leaf specialists are publish-only and must never block production by trying `wait/history/progress/health`.
- Durable episode stages use a single-writer lease and serial quality gates by default. Parallelize only independent provider work with non-overlapping files and no continuity dependency.
- Keep delegated cost bounded: route leaf specialists economy-first to the weakest suitable configured profile, pass bounded stage context, and reserve stronger/high-reasoning workers for ambiguous integration review or evidence-backed escalation.
- For one series or episode production run, create one top-level Event Bus `job_id` and keep repairs/retries inside that job. Do not create a new top-level job for dependency repair, rerender, QA repair, or delivery retry.
- Follow the global `events-bus` protocol: subscribe before launching work, keep consuming until a reconciled top-level terminal event, and proactively surface every meaningful `visibility=user` milestone. A wait timeout or `task.completed` is not top-level completion.
- Durable run state under `runs/<series-name>/<YYYY-MM-DD[-slug]>/` answers what is true; Event Bus answers what is happening; `runs/<series-name>/<YYYY-MM-DD[-slug]>/generated/manifest.json` records artifact-stage provenance. Do not substitute one for another.
- Keep story, world, character, episode, shot, continuity, and prompt changes in durable text assets.
- Series/story state, characters, locations, episodes, generated media, caches, reviews, and runtime state all belong under `runs/<series-name>/<YYYY-MM-DD[-slug]>/` and are excluded from Git.
- Every generated media artifact must have adjacent metadata describing its provider, prompt, source inputs, command log, status, size, and SHA-256. Video success additionally requires deterministic decode/duration evidence.
- Providers are fixed by `config/providers.json`: local `mlx-audio` for TTS, local `mlx-vlm` for understanding, Agnes for image/video generation, and Markcut for timelines/rendering.
- Never print provider keys or other secrets. Report key presence and resolution source only.
- If Agnes authentication or service access fails, stop the affected generation stage and report the exact blocker; do not silently switch providers.
- Use continuity deliberately. A shot may set `continuity_from` to an earlier shot; the pipeline extracts that shot's end frame and uses it as the next Agnes image-to-video input. `continuity_from` must point backward within the same episode.
- A generator never certifies its own output. Use independent review according to `config/workflow.json`; combine deterministic checks, sampled evidence, continuity review, and narrative coverage.
- Treat these as distinct states: `generated != accepted`, `rendered != approved`, `sent != delivered`.
- On failure, repair the smallest failed stage, preserve accepted upstream artifacts, return to the failed gate, and continue the same run.
- `prepare` and `render` are validation commands. `--media` is the only flag that invokes Markcut's full render.
- Drama core production ends at `APPROVED`. Delivery to a reviewer/chat is a separate external adapter job, not a Drama state transition and not social publication. It must consume an exact approved artifact identity and record destination-side verification. For WeChat video, use `send-video`; reserve `send-file` for non-video attachments.
- Publishing to social platforms is not part of this pipeline and still requires explicit publication authorization.

## Project learnings

- 2026-09-15: Generated media is not accepted media. Keep provider generation, deterministic technical validation, and independent narrative/visual review as separate gates; a successful generator call cannot certify its own output.
- 2026-09-15: Continuity repairs should preserve accepted upstream work and repair the smallest failed stage. Rebuilding unrelated shots increases cost and can introduce new continuity drift.
