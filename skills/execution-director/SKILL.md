---
name: execution-director
description: Compile unresolved media requirements from canonical Markcut video.md into typed execution/index.json and demo/capture/image/video lane files.
---

# Execution Director

Execution Director reads the canonical Markcut `video.md` produced by Video Director. It finds `<!-- execution {...} -->` markers and compiles them into an execution directory:

```text
execution/
├── index.json
├── demo.json
├── capture.json
├── image.json
└── video.json
```

`index.json` is a small cross-lane manifest. Lane files carry semantic execution requirements for downstream agents. No lane contains selectors, coordinates, fixed click sequences, or tool-specific navigation.

Initial lane types are deliberately limited to `demo`, `capture`, `image`, and `video`.

```text
video.md
  -> Execution Director
  -> execution/*.json
  -> Demo/Capture/Image/Video agents
  -> assets/*
  -> materialize video.md
  -> Markcut preview/render
```

Use `scripts/contract.py video.md execution/` to compile and validate the directory.

## Markcut metadata channel

Canonical `video.md` may carry `<!-- execution {...} -->` HTML comments. Markcut explicitly ignores HTML comment nodes; Execution Director is the component that reads and validates the `execution` convention. Comment contents never become part of Markcut's descriptive/render tree.
