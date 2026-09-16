# Neo Build Log

Neo Build Log records real work while building Neo: the problem, the attempted
solution, and the parts worth sharing with other AI users. Each episode starts
as source notes, becomes a story, and is expressed as Markcut-compatible
Markdown.

## Layout

- `runs/neo-build-log/<YYYY-MM-DD[-slug]>/` — Episode 001 source notes and storyboard.
- `AGENTS.md` — project-level rules automatically applied when an agent works
  from this directory.
- `agents/director.md` — repeatable process for turning a solved problem into an episode.
- `agents/capture-agent.md` — executes desktop + NeoX capture and owns the capture review gate.
- `AUDIO_STYLE.md` — canonical narration voice, BGM identity, mix, and local TTS contract.
- `scripts/audio/` — reproducible local TTS adapter and original BGM generator.
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
folder. `agents/director.md` is the canonical detailed editorial specification.

## Runtime layout

Neo Build Log is a series project. Reusable project contracts are tracked here; each actual episode/build execution is private run data:

```text
runs/neo-build-log/<YYYY-MM-DD[-slug]>/
├── source.md
├── episode.md
├── RECORDING_PLAN.md
├── capture-tour.json
├── CAPTURE_REVIEW.md
├── assets/
├── logs/
└── output/
```

Do not split one episode across root-level log/output folders. All execution-specific content stays inside its dated run and is ignored by Git.

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
npx @lalalic/markcut preview neo/neo-build-log/runs/neo-build-log/<YYYY-MM-DD[-slug]>/episode.md --storyboard
```
