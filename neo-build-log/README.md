# Neo Build Log

Neo Build Log records real work while building Neo: the problem, the attempted
solution, and the parts worth sharing with other AI users. Each episode starts
as source notes, becomes a story, and is expressed as Markcut-compatible
Markdown.

## Layout

- `episodes/001/` — Episode 001 source notes and storyboard.
- `AGENTS.md` — project-level rules automatically applied when an agent works
  from this directory.
- `DIRECTOR.md` — repeatable process for turning a solved problem into an episode.
- `CAPTURE_AGENT.md` — executes desktop + NeoX capture and owns the capture review gate.
- `schemas/neox-capture-tour-v1.schema.json` — repository copy of the NeoX v1
  Capture Tour manifest contract.

Neo Build Log owns the content and story design. Markcut owns validation,
preview, and rendering. Final rendering and publication remain user review
steps unless explicitly requested.

## Series contract

Each episode follows a recognizable build-log grammar: hook on the first
screen, short Neo Build Log opener, problem/constraint, investigation or
attempt, the real build, evidence/result, and a closing payoff with a next
episode hook when appropriate. Real screen recording and screenshots are the
main visual evidence, presenter footage supports the explanation, and every
episode uses background music.

`AGENTS.md` is the short enforcement layer for Codex/agents working in this
folder. `DIRECTOR.md` is the canonical detailed editorial specification.

## Runtime layout

`neo-build-log/` is tracked as part of the Neo repository. Codex and production
runtime output is intentionally separate: use Neo-root
`logs/neo-build-log/<episode>/<run-id>/` for command logs, preview logs, and
temporary diagnostics. That root `logs/` directory is ignored by Git. Episode
media lives under `episodes/<NNN>/assets/` and is also ignored, while the story,
recording plan, capture tour, review decisions, and schemas stay tracked.

## End-to-end flow

`source → Director/story → recording list → NeoX camera tour + desktop capture → capture review → Markcut storyboard → preview → user review`

Each episode keeps `RECORDING_PLAN.md` as the complete shot list. Camera or
presenter shots are also emitted as `capture-tour.json` for NeoX. The Capture
Agent executes both capture lanes and records what actually exists in
`CAPTURE_REVIEW.md`; only accepted media should replace recording placeholders
in the final storyboard.

## Preview

From the Neo repository root:

```sh
npx @lalalic/markcut preview neo/neo-build-log/episodes/001/episode.md --storyboard
```
