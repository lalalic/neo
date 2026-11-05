# Personal Story-first — people before scenery

**The subject of an ordinary Vlog is the creator or another person, not the landscape.** Source photos, route footage and music support a human experience. A pretty sequence, or a JSON field called `goal`, is **not** enough to pass Director or Editor.

## Creative process inside Director

1. Read existing Visioner observations and the creator's available profile, recorded preferences and prior personal-library context, when relevant. Do not demand a new owner interview for everyday material. For an ambiguous outdoor path, cycling/running/walking are **possible stories**, not verified activities.
2. Pick a concrete first-person **everyday goal** (get exercise, buy groceries, meet a friend), a relatable **setback/embarrassing mishap**, actions, and an **outcome with contrast**. Keep it human, ordinary, conversational and sometimes self-deprecating; do not force a beautiful destination, inspiration or grand lesson. A quiet episode still needs a human intention and change.
3. **Write the complete standalone first-person narrative first** in `personal-story.md`. Someone should be able to read it as a little story without watching the video or seeing a shot list. Its beginning, trouble, response and ending must connect. Not just four labels or separate captions.
4. Describe the same story in `personal-story.json` against `contracts/personal-story.schema.json`: `protagonist`, `arc`, `narrative`, `beats`, `provenance`, and optional `tone`. `narrative` must appear verbatim in the Markdown file. Each beat gets a stable ID and one or more actual source IDs for editorial illustration.
5. Then write `story.md` as the **shot-ready adaptation** referring to `story_id`, choose `shot-selection.json` with `personal_story_id` + each shot's `story_beat_id`, and write the visual brief. The Editor carries the IDs into the EDL unchanged, trims/rearranges as needed for pacing and preserves the human premise, setback, and ending. Producer carries `personal_story_id` into `episode-input.json.story` and does not invent a new story.

## What can be imagined

Truthfulness applies to **what the media actually shows**, not to every line of an explicitly fictionalized first-person script. Distinguish:

- `provenance.observed`: visible/audible source facts, each with an actual Visioner `source_id` (e.g. a path, stream, bicycle if clearly visible).
- `provenance.inferred`: plausible context with a named basis (e.g. a person paused beside a creek; running/cycling/walking is uncertain).
- `provenance.fictionalized`: permissible creative details (e.g. "came out to exercise but got distracted taking pictures", "I was embarrassingly lazy"). They are **story invention**, not an assertion of documentary fact or owner testimony.
- `protagonist.persona_basis`: cite relevant saved profile/owner context by a private reference when used; otherwise use `creative_assumption`. Do not invent private biographical facts.

A person need **not appear on camera**. Voiceover can provide the first-person perspective. Do not fabricate a visible person, on-screen bicycle, GPS track, witnessed conversation, or specific real-life event; do not treat a comedic invention as source evidence. Original source audio and exact locations remain subject to their own existing evidence rules.

## Example with only a trail photo and creek footage

**Full-story premise:** "I left home determined to get some exercise; a creek distracted me into taking pictures and a tiny video; I returned with more camera footage than exercise." It has a human goal, a small failure, an action and a self-mocking payoff. It's a fictionalized mundane story **illustrated by** real creek footage; it does not claim the camera proved the creator was jogging or cycling.

**Short-video adaptation:** path ("今天出来，明明是想运动的") → creek photo ("看到小溪又停下来拍照") → real moving water → creek still reused ("视频才一秒半，偷懒倒挺熟练"). Compress or extend timing based on TTS and available shots. Do not confuse the short voiceover with the full readable `personal-story.md`.

## Acceptance and repair

Director must deliver `personal-story.md`, `personal-story.json`, `story.md`, `shot-selection.json`, `visual-brief.md`, `post.md`. Existing `scripts/validate-stage.mjs director <run>` runs the Relay JSON Schema validator and enforces personal narrative references. Editor runs the same human-story gate plus shot-to-beat link checks on EDL. On failure, **repair within the owning Agent** before completing. Reviewer should reject scenic-only descriptive montages or false documentary claims even if the mechanical JSON checks pass. User-requested fictionalized storytelling is compatible with genuine source footage; publication rights remain a separate workflow.
