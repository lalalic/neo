# Video Director: reusable 9:16 motion treatment

This is an authoring example for a project using Markcut. The canonical renderable demonstration is `markcut/examples/motion-capabilities-9x16.md`; use that file to preview and verify six treatments. Resolve capability names, props, supported aspect ratios, license and status against the project's `docs/motion-capabilities.json` before reuse.

The Video Director starts with the story and writes the treatment name into the scene description. Markcut renders the timeline. For example:

```md
---
width: 1080
height: 1920
fps: 30
---
# video
layout:series

## Product reveal
description:"CinematicPush: start wide, settle on the promise, and keep the headline in the central safe area."
- component duration:3 jsx:"<CinematicPush eyebrow='INTRO' title='A clear idea' tone='#64d9c6' />"
```

The JSX is illustrative. Define or import `CinematicPush` through the same Markcut `~~~js imports` mechanism used in the complete demonstration before rendering. Avoid copying third-party code/assets without the recorded license review.

For a project with generated animation assets, replace the JSX node with a normal `video src:"assets/treatment.mp4"` stream and use the same Markdown timeline. Check visual frames, duration, audio, and phone-scale safe area in the final render.
