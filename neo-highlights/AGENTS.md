# Neo Highlights Project Rules

This directory is a Neo content project. Follow the parent Neo `AGENTS.md` in
addition to these rules.

## Director engine

Before creating or revising a highlight video, load the installed `markcut`
skill and use it as the video director engine. Do not invent or maintain a
parallel `DIRECTOR.md` that duplicates Markcut's story, scene, narration,
visual, preview, review, or rendering contract.

The project decides **whether the event is worth a video and what is true**.
Markcut decides **how the video tells it**.

## Required workflow

1. Read the event's `source.md` before authoring `video.md`.
2. Reject or leave as a candidate when the event is routine, unsupported, too
   private, or lacks a meaningful audience payoff.
3. Treat claims and dates as facts only when supported by the source or
   observable evidence. Never turn a plan, log message, exit code, or agent
   assertion into a claimed real-world result without evidence.
4. When reusable media exists under `assets/`, use Markcut's `vision` workflow
   to understand it before deciding the story. Do not manually guess media
   contents when Markcut can inspect them.
5. Let Markcut choose the story structure. Do not force every highlight into
   the Neo Build Log grammar or a fixed scene count.
6. Author the result as Markcut-compatible `video.md`; prefer project-relative
   asset paths and keep manually supplied media under `assets/`.
7. Run `markcut verify`, then `preview --storyboard` before expensive generation
   or final rendering. Record meaningful findings in `REVIEW.md`.
8. Apply Markcut's review contract to the actual viewer experience and revise
   authoring problems before treating the highlight as ready.
9. Render only when the requested workflow reaches that stage. Publish through
   Neo's `post` skill only after explicit user authorization.

## Source and privacy contract

- `source.md` is the durable truth boundary for the event.
- Separate observed facts from interpretation/story angle.
- Reference evidence instead of copying secrets, credentials, private prompts,
  or unnecessary personal data into tracked files.
- If required evidence is missing, say so and leave an explicit capture or
  sourcing need. Do not fabricate screenshots, results, quotes, or metrics.
- Neo `events-bus` messages may nominate candidates, but completion/progress
  events alone are not evidence that a highlight-worthy outcome occurred.

## Runtime and media

- Event media: `events/<event-id>/assets/` (ignored by Git).
- Markcut cache/generated state: `.markcut/` (ignored by Git).
- Run logs/temp diagnostics: `../logs/neo-highlights/<event-id>/<run-id>/`.
- Durable tracked state: source, `video.md`, and review decisions only.
