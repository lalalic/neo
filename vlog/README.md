# Vlog

Vlog is a Neo monorepo project for turning real phone/desktop media into evidence-backed short-form videos. NeoX supplies phone media, Codex/agents coordinate production, and Markcut handles media analysis, storyboards, preview, and rendering.

The tracked project contains only the reusable production system. Every actual vlog execution—including source media, episode Markdown, SQLite state, generated narration/BGM, previews, reviews, publish receipts, and final video—belongs under ignored `runs/<series-name>/<YYYY-MM-DD[-slug]>/`.

## Project layout

- `AGENTS.md` — project routing and run-boundary contract.
- `src/neo_vlog/` and `tests/` — durable workflow implementation and regression tests.
- `config/` — reusable routing configuration.
- `docs/` — architecture, integration, producer, and verification contracts.
- `templates/series/` — reusable public series definitions; mutable series state belongs under `runs/<series-name>/`.
- `templates/`, `styles/`, `personas/` — sanitized reusable content definitions.
- `scripts/` — reusable automation.
- `runs/` — ignored production executions and all private/generated content.

## Run the workflow

Python 3.11+ is sufficient; the core runtime has no third-party dependencies. From `vlog/`:

```sh
export PYTHONPATH=src
python3 -m neo_vlog --db runs/neo-vlog/2026-09-16-demo/state/vlog.sqlite --config config/routing.json init
python3 -m neo_vlog --db runs/neo-vlog/2026-09-16-demo/state/vlog.sqlite --config config/routing.json event \
  --key demo-arrival-001 --series neo-build-log \
  --payload '{"media_path":"runs/neo-vlog/2026-09-16-demo/assets","source":"bootstrap-demo"}'
python3 -m neo_vlog --db runs/neo-vlog/2026-09-16-demo/state/vlog.sqlite --config config/routing.json run
python3 -m neo_vlog --db runs/neo-vlog/2026-09-16-demo/state/vlog.sqlite status
```

If `--db` is omitted, the CLI defaults to `runs/neo-vlog/<YYYY-MM-DD[-slug]>/state/vlog.sqlite`.

`run` prints pending command/role plans; it does not call a model or fetch phone media by itself. A producer resolves/imports actual media into the run, claims a job, performs the planned work, then completes it with evidence or fails it with an error. Review gates bind approval to the displayed revision and artifact hash.

Run regression tests with:

```sh
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

## Markcut

A run-local storyboard can be previewed/rendered directly:

```sh
npx @lalalic/markcut preview runs/<series-name>/<YYYY-MM-DD[-slug]>/vlog.md --storyboard
npx @lalalic/markcut render runs/<series-name>/<YYYY-MM-DD[-slug]>/vlog.md --output runs/<series-name>/<YYYY-MM-DD[-slug]>/output/vlog.mp4
```

## Audio and narration

- Every final vlog should include episode-appropriate BGM sourced through the installed `audio-sourcing` skill and stored inside that run.
- Prefer usable original speech. Personal voice references/clones are private run-local inputs and are never committed.
- If a private voice reference is unavailable, use the conversational Mandarin fallback defined in `docs/architecture.md` and `personas/ray.json`.
- Generated narration must pass listening QA and local STT content back-check before final review.

## Publishing

Publishing is outside the core Vlog production state machine. When explicitly authorized, hand the approved run artifact to `skills/post` and verify platform-side state before reporting success.

See `docs/architecture.md`, `docs/integrations.md`, `docs/producer.md`, and `docs/verification.md` for the detailed contracts.
