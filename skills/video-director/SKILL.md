---
name: video-director
description: Turn product-demo and marketing intent into canonical Markcut video.md with semantic execution markers, without prescribing runtime automation.
---

# Video Director

The Video Director owns story, audience, pacing, scene order, narration, visible evidence, and presentation intent.

Its canonical output is **Markcut Markdown** (`video.md`). There is no second canonical JSON timeline. Scenes that require media which does not yet exist carry a compact HTML comment marker that Markcut ignores but Execution Director can compile:

```md
## profiles
<!-- execution {"id":"profiles-demo","type":"demo","scene_id":"profiles",...} -->
- video src:"assets/profiles-demo.mp4" duration:6
```

The marker describes semantic intent and expected output, not selectors, coordinates, click sequences, or tool choice.

## Flow

```text
creative brief
  -> Video Director
  -> video.md (canonical Markcut source)
  -> Execution Director
  -> execution/*.json
  -> runtime agents
  -> assets/*
  -> Markcut preview/render
```

Use `scripts/contract.py` to validate authoring input and render canonical Markcut. `render_markcut()` emits stable scene IDs and execution markers for unresolved media requirements.

## Responsibility boundary

| Layer | Owns | Must not own |
| --- | --- | --- |
| Video Director | story, audience, pacing, scene order, evidence, presentation, media requirement intent | selectors, coordinates, fixed UI sequences, runtime tools |
| Execution Director | compile media requirements into typed execution lanes | runtime navigation/tool implementation |
| Runtime agents | reach the requested state, capture/generate media, verify outputs | rewrite editorial intent |
| Markcut | canonical timeline, preview, render after assets materialize | runtime product navigation |

## Optional Shotcraft shot recipes

For a scene that benefits from deliberate camera/subject movement, discover the global `video-shotcraft` skill through the normal Neo skill resolver. Use **only its single-shot recipe workflow**, not its full product-promo template, separate workbench, publishing, or end-to-end delivery workflow. If the skill is unavailable, continue with ordinary Markcut treatments; do not invent a recipe or block the story.

Select a recipe only after inspecting the actual source media, Visioner observations, story intent, composition, existing camera motion, resolution, and safe crop. Some Shotcraft recipes target wide web pages and are inappropriate for travel footage. A shot with no suitable recipe should remain an ordinary cut. Never imply generated motion or context was filmed by the creator.

For a selected shot, resolve its exact name using `video-shotcraft/gallery/api/library.json`, read the whole `references/shots/` card and its cited demo implementation, then adapt the motion to the authorized media. The card and demo are execution guidance, **not a pre-rendered stock MP4**, and do not require copying the whole repository into Markcut. Record the card name, source revision/path, media time range, suitability rationale, parameter deviations, and preview validation in the creative brief or scene description.

The Producer implements only the required shot using Markcut's current Markdown/JSX/Remotion or an independently generated clip when necessary; Markcut alone owns the canonical timeline, preview, sound mix and final render. Check representative frames, crop, movement, readability, timing and source authenticity. Never add a second timeline, a Vlog-specific rendering engine, or a new Episode Graph step. For 9:16, normally use 1080×1920 at 30 fps and phone-safe framing. See [shot-recipe decision example](examples/motion-capability-9x16.md).
