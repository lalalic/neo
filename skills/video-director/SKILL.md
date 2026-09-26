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
