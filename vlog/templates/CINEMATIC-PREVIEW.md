# Preview a Vlog Markcut template

The executable template is [cinematic-vlog.md](cinematic-vlog.md).
The Producer instantiates it through [the compiler](../lib/cinematic-vlog.mjs) into the dated run's canonical `video.md`. Scene structure, selected BGM, root sound volume, subtitles and effects are changed **in that template**, not in Agent prose or separate JSON files.

A short demonstration file, [cinematic-preview-demo.md](cinematic-preview-demo.md), is a synthetic editing fixture and **not** a real episode. For a sandbox preview, copy it under ignored `runs/<dated-test>/video.md`, then open it in Markcut Preview. Synthetic media do not establish permission to publish.

For a real episode:

1. Director/Editor supply approved source files, source hashes, scene IDs, story progression, in/out timing and transitions.
2. Producer supplies the licensed, source-matched local BGM asset and evidence, instantiates [cinematic-vlog.md](cinematic-vlog.md), and validates the generated Markcut DSL with `markcut verify video.md`.
3. Producer uses `neo.markcut_preview` for **revision-bound** owner approval; on changes, rebuild and preview the new revision in the same Worker.
4. Markcut render, actual audio/visual QA, specialist PASS and separate publication consent remain mandatory. A template preview does not satisfy an episode's approval.

Do not embed demo URLs, invented source footage or unverified GPS in a production run. Any optional route scene is assembled from [geo-story.md](geo-story.md) or [route-overview.md](route-overview.md); map tiles, narration and endpoint visibility require real playback verification.
