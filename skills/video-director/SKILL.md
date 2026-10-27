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

## Reusable motion capabilities

Choose visual treatments from the active project's Markcut catalog at `docs/motion-capabilities.json` when that file exists. It lists capability names, supported aspect ratios, input props, render modes, source/license metadata, example paths, and verified status. Resolve the catalog relative to the Markcut repository or the project that supplies it; do not assume it is under this Video Director skill.

For vertical authoring, target 1080×1920 at 30 fps unless the destination specifies another canvas. Favor one clear subject, readable typography, and safe margins. Check motion at phone scale before final rendering. Record the selected capability name and editorial intent in the scene description/instruction; author the treatment through normal Markcut JSX imports or a pre-rendered asset node. See [9:16 capability example](examples/motion-capability-9x16.md).

This is a **discovery and creative-direction contract**, not a new plugin runtime or timeline. Video Director chooses shot, pacing, and story treatment; Markcut owns durations, assembly, preview, QA, and MP4 rendering. If the catalog is absent or an entry is unverified, use a verified built-in or validate the third-party treatment before claiming support. No project-specific Vlog engine or Episode Graph change is required.
