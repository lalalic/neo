# Video Director: Shotcraft recipe decision for 9:16

Use the global `video-shotcraft` skill as an optional **single-shot** reference, not as a fixed component catalog or stock-video collection. Each decision must be grounded in the actual source footage and the story.

| Source and story | Decision | Reason |
| --- | --- | --- |
| High-resolution still photo, quiet reveal of an autumn scene | Consider a matching subtle camera-move recipe after reading its card and demo | Digital movement may create a useful reveal without changing source truth |
| Handheld walking video with substantial camera motion | Ordinary cut, no extra camera recipe | Added movement may make the shot harder to follow |
| Portrait clip of a person speaking | Ordinary shot unless a safe, story-driven treatment passes preview | Keep face, original speech, and authenticity intact |
| Long web-page screenshot, product demo | `steep-tilt-glide` can be a candidate | Its fixed-camera/moving-panel design targets wide UI, not ordinary travel footage |

For a chosen recipe:

1. Resolve the card in `video-shotcraft/gallery/api/library.json`.
2. Read the entire `references/shots/<category>/<card>.md` and its referenced demo TSX; use the tuned parameters as a starting point.
3. In `visual-brief.md`, record source path/time range, story purpose, recipe name and revision, suitability, motion parameters, safe crop, and why this treatment beats an ordinary cut.
4. Have Producer implement the **shot on the real media**, using Markcut's existing JSX/Remotion authoring or an independently rendered clip if needed. Do not write a fake `recipe:` DSL field or assume the recipe renders itself.
5. Verify the actual Markcut preview (1080×1920, normally 30 fps): framing, face/text readability, motion, duration, audio, and original source truth. Reject and return to a normal cut if it fails.

Do not run Shotcraft's full-promo, workbench, upload, or publication process for a Vlog. Markcut remains the single canonical timeline and final render.
