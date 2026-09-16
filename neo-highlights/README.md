# Neo Highlights

Neo Highlights turns noteworthy events in Neo's work and life into short,
evidence-backed videos. It is intentionally selective: routine activity is not
a highlight just because it happened.

## Core idea

This project owns **highlight selection, source facts, evidence, privacy, and
output intent**. The installed `#markcut` skill is the **video director engine**:
it chooses the story structure, scene decomposition, narration, visual intent,
media prompts, variants, preview strategy, and render/review loop.

Do not create a second Director framework here. Project rules should tell
Markcut what happened and what constraints matter, then let Markcut direct the
video.

## What counts as a highlight

A candidate should normally satisfy at least two of these:

- a concrete capability was unlocked;
- a meaningful problem was solved or a failed approach produced a useful turn;
- there is a visible before/after, demo, result, or other proof;
- the event is surprising, emotional, useful, or memorable to the intended audience;
- it advances the Neo story or mission in a way worth remembering or sharing.

Routine commits, generic status updates, model chatter, and unsupported claims
should not become videos.

Neo `events-bus` events may be used as **signals** for candidate highlights, but
a lifecycle event such as `task.completed` is not automatically a highlight.
The source must still pass the selection and evidence gate above.

## Project layout

Each highlight is self-contained:

```text
neo-highlights/
  templates/
    source.md
    review.md
  runs/
    YYYYMMDD-slug/
      source.md
      assets/          # local source/capture media; ignored by Git
      video.md         # Markcut-authored storyboard/video source
      REVIEW.md        # evidence + Markcut preview/review record
```

Runtime logs and temporary artifacts belong under Neo-root
`logs/neo-highlights/<event-id>/<run-id>/`. Markcut-generated state remains in
`.markcut/`. Both are ignored by Git.

## End-to-end flow

```text
candidate event
-> source.md truth/evidence gate
-> inspect supplied media with Markcut vision when applicable
-> #markcut directs video.md
-> markcut verify
-> markcut preview --storyboard
-> review and revise
-> final preview/render when requested
-> publish only when explicitly requested
```

The default output intent is a concise short-form highlight, usually portrait
`1080x1920`. Markcut may choose a different duration or story shape when the
source calls for it. A platform-specific request may use Markcut variants rather
than duplicating the whole story.

## Start a highlight

From this directory:

```sh
./scripts/new-highlight.sh markcut-director
```

That creates `runs/YYYYMMDD-markcut-director/source.md` and `REVIEW.md` from
the templates. Fill `source.md` with facts and evidence, then ask an agent to
make the video with `#markcut`.

For an event already containing media, put the files in its `assets/` folder
and let Markcut inspect them before story decisions:

```sh
npx @lalalic/markcut vision runs/<event-id>/assets
```

Once `video.md` exists, the normal technical checks are:

```sh
npx @lalalic/markcut verify runs/<event-id>/video.md
npx @lalalic/markcut preview runs/<event-id>/video.md --storyboard
```

Rendering or publishing is not proof of truth. The final video must remain
consistent with `source.md` and observable evidence.
