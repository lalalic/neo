---
name: video-director
description: Turn product-demo and marketing intent into Markcut narrative and semantic shot intent without prescribing UI automation.
---

# Video Director

The Video Director owns the story, audience, pacing, scene order, and what
each shot must communicate. It consumes a creative brief and emits a
`video-director-plan-v1` document with two deliberately joined outputs:

1. `markcut_storyboard`: Markcut Markdown Descriptive, suitable for the next
   authoring/preview stage; and
2. `scenes`: semantic shot intent for the Execution Director.

The plan describes visible outcomes, evidence, and presentation intent. It
must never contain coordinates, selectors, fixed click/keypress sequences, or
instructions for how a UI automation tool should reach a state. Those details
belong to the Demo Agent at runtime.

## Contract

Input is a `video-director-brief-v1` object:

```json
{
  "product": "Family Tutor",
  "audience": "Parents evaluating a safe learning workflow",
  "channel": "product_demo",
  "duration_seconds": 30,
  "style": "clear, warm, evidence-led",
  "goal": "Show that each child gets a separate learning profile",
  "context": {
    "surfaces": ["Chrome extension popup"],
    "features": ["kids list"],
    "claims": ["one profile per child"]
  }
}
```

Output scenes require a stable `id`, a `purpose`, a `communicates` sentence,
at least one `visible_evidence` item, and `presentation` metadata. The
presentation vocabulary is intentionally editorial: `focus`, `highlight`,
`text`, `zoom`, and `duration_seconds`. `narration` is optional and belongs
to the story, not to runtime execution.

Use `scripts/contract.py` in adapters and tests. It has no browser, recorder,
Markcut, or network dependency. `render_markcut()` emits the standard
Markcut Markdown Descriptive root/scenes; its media sources are explicit
scene placeholders for the downstream capture/assembly stage.

## Responsibility boundary

| Layer | Owns | Must not own |
| --- | --- | --- |
| Video Director | story, audience, pacing, scene order, visible evidence, presentation | selectors, coordinates, click sequences, app/tool choice |
| Execution Director | semantic executable shot contracts and fresh-UI success criteria | brittle automation scripts |
| Demo Agent | runtime navigation, tool choice, recovery, screenshots, verification | story rewrites and editorial intent |

## Markcut handoff

Markcut remains the narrative/timeline authoring format. A director plan is
not a second timeline DSL: the JSON carries semantic metadata for the next
agent, while `markcut_storyboard` is the canonical narrative representation.
Markcut owns validation, preview, and rendering after real media replaces the
scene placeholders.
