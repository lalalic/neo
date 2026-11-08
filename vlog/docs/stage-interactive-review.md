# Vlog optional Stage Interactive Review — Visioner and Director

**No new DAG Agent, no changes to Markcut or Agents Relay.** The project has
stable Agent source/story/EDL contracts; only this project's review presentation
uses Markcut MD. Stage Review is **off by default**.

## Opt-in

The current Relay Task instructions may explicitly request one or both Stage
reviews. For a prepared private Run, an owner may instead create the ignored
`review-stages.json` in that Run:

```json
{"visioner": true, "director": true}
```

Each flag is independent. Do not infer owner approval from an Agent's preference
or a model's uncertainty. No opt-in means **Visioner emits normal evidence,
Director creates only one chosen story and no Hook Review artifacts**. The
canonical `graph.mmd` remains Visioner → Director → Editor → Producer → Publisher.

## Visioner: one source = one Scene

Normal output contract remains `vision-evidence.json` plus
`vision-normalized-manifest.json`. First validate the original Visioner Stage.
On opt-in only:

```sh
node vlog/scripts/visioner-review-to-md.mjs /absolute/vlog/runs/YYYY-MM-DD-name
```

The project script verifies approved original source IDs and actual SHA-256s,
compares them with `vision-evidence.json`, then generates `visioner-review.md`.
Every `media-<source_id>` Scene starts with a **visible Guide** containing
AI's unreviewed description and a request for time-coded correction; it then
plays/displays a phone-sized media excerpt. For long source videos the Guide
labels the time-bound excerpt explicitly: it is **not the complete original**.
Preview cuts are continuous original timestamps, never sampling/normalized
Vision Understanding files. Private encoding stays under ignored `assets/review/`.
A comment for `media-013` at 6s inside the Scene is NOT automatically original
source time 6s: the Scene starts with a Guide card. Use the mapped media offset
and confirmed source interval before changing evidence. Never change source media
or treat review comments as automatic proof of a visual fact.

## Director: one Hook = one Scene

Without opt-in, make **only one** best story. With opt-in, first create a
complete *provisional* Director story for the recommended direction; normal
Director Stage validation must PASS before immutable Review checkpoint.
Also author optional `director-hooks.json` with 2–3 **different** source-backed
ideas, e.g.:

```json
{
  "recommended_hook_id": "hook-b",
  "hooks": [
    {
      "id": "hook-a", "title": "好奇探索",
      "guide": "先看红果，提出自然疑问；别编造品种。",
      "reason": "有真实观察，但事件感较弱",
      "media": [{"source_id":"013","start_seconds":0,"end_seconds":3.5}]
    },
    {
      "id": "hook-b", "title": "人物事件",
      "guide": "先呈现真实动作，再保留现场反应和原声。",
      "reason": "人物有明确行为和后续反应",
      "media": [{"source_id":"013","start_seconds":4.1,"end_seconds":7.2}]
    }
  ]
}
```

The optional JSON is a **Vlog Director proposal**, not a new global Preview
contract nor a replacement for `personal-story.json` and `shot-selection.json`.
`media` illustrates source-grounded cuts, *not* Editor's final EDL.

```sh
node vlog/scripts/director-hooks-to-md.mjs /absolute/vlog/runs/YYYY-MM-DD-name
```

`director-hooks.md` has one `hook-*` Scene per candidate, each with a visible
Guide, motivation and faithful clip/photo excerpts; recommended Hook has a
visible `★ Director 推荐` label. The converter verifies source identity/ranges
and runs `markcut verify` on exact output, with no creativity/model inference.

## Shared existing Relay + Markcut Review

When an active **managed Task** requests Review, use the authoritative current
Task/Execution context to form its existing canonical `task.interactive_decision`
Event Template. Do not invent Job/Task/Execution/Invocation values or use a
stand-alone fake Event. For example, after this Stage's own validation:

```sh
neo project review checkpoint --project vlog --path /absolute/run --stage visioner
# Or: --stage director
markcut preview /absolute/run/visioner-review.md \
  --delivery event --event-template /absolute/template.json --commit-sha <checkpointSHA>
# Director uses director-hooks.md at the same boundary.
```

The checkpoint is an immutable SHA in a **private, remote-free Run Git repo**;
`project.run.json` allowlists the generated review Markdown and Hook options
JSON as checkpointed text. It excludes media, account data and private inputs.
Markcut's preview cache/content hash is **not** the Relay review revision. A
mobile/hosted Preview receipt means delivery PENDING, not approval. Let Relay
own wait/resume and read its accepted decision after the Worker actually
resumes. Never mark a Stage complete with unanswered required human review.

**Visioner feedback:** `changes_requested` uses Scene source association and
actual source-time comments to correct understanding and uncertainty; then
revalidate and submit the next revision. `approved` allows handoff of current
vision evidence. Human remarks are attributed; original ASR remains unverified
until actually verified.

**Director feedback:** `approved` **without any selection comments** selects
`recommended_hook_id`. To select any non-recommended Hook or request changes,
users attach an explicit selection/comment on that Hook's Scene and tap
**Request Changes**. The present Markcut UI does not submit comments together
with Approve. On continuation, resolve the selected Hook by `sceneName` or
`sceneId` and the actual text (not the mere presence of a comment), apply the
requested adjustments to the normal Director story/visual brief/shot choices,
revalidate and submit an updated Preview if another decision is needed. An
ambiguous or contradictory selection gets another Preview/clarification, not
a silent random choice. Revisions require fresh checkpoint and invocation IDs.

Review does **not** authorize external publishing. Editor stays autonomous
about final edit cuts; Publisher still requires its own explicit permission.

## Evidence and current limitations

The two project converters and actual Markcut `verify`/render are testable
without a phone. They do not simulate a human decision or Relay acceptance.
A true phone/Relay round-trip requires a live managed Task, correct immutable
Event Template and an actual person submitting review; it is not proved by a
successful `.md` render or an Inbox ACK alone.
