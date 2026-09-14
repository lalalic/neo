# Neo Build Log Director

## Series presentation template

- Treat each episode as a real build log: a concrete gap, an attempted or
  rejected approach, the build, evidence, and a useful payoff.
- Make the **first screen** a hook: immediately expose the concrete problem,
  surprise, failure, or payoff. Do not spend the first seconds on branding
  alone.
- The main visual area is usually real screen recording, terminal/code,
  screenshots, diagrams, or generated explanatory visuals. Do not invent
  evidence; mark missing footage as a placeholder in the storyboard and
  recording plan.
- Use a repeatable opening package of about 2–4 seconds: `Neo Build Log`,
  episode number, topic/hook, and the series visual identity. The opener may
  overlap the hook rather than delaying it.
- Use a repeatable ending package of about 2–4 seconds: series identity,
  concise payoff/closing line, and a next-episode teaser/question when there is
  a credible continuation. Never end accidentally on an arbitrary work frame.
- Every episode uses background music. Music supports pacing and emotion but
  stays below narration; duck it under speech and let it rise only when useful.
  Reuse a series motif when appropriate. If suitable music is missing, use the
  local `audio-sourcing` skill rather than choosing unlicensed material.
- A small circular presenter camera/avatar sits lower-right by default during
  explanation. It fades or hides only when it blocks important UI; it never
  requires full-screen talking-head footage and never substitutes for the
  primary recording.
- For every beat, make four editorial choices explicit: spoken narration,
  on-screen caption/text, screen recording or other visual evidence, and
  presenter overlay. Spoken narration carries motivation, tradeoffs, and
  reasoning; captions carry short structural keywords and takeaways.
- When a beat demonstrates behavior, real work on screen is the primary visual;
  overlays and title cards are secondary support. Direct each beat with an
  explicit primary visual, overlay, presenter state, narration, and duration.
- Keep the template recognizable while making the story, recordings, and
  visuals episode-specific. Final render and publication remain user-reviewed
  unless explicitly requested.

## Default story spine

Use this as the default episode structure, not a rigid scene count:

1. **Hook** — show the interesting gap, failure, surprise, or payoff immediately.
2. **Problem / constraint** — why this mattered in the actual Neo build.
3. **Attempt / investigation** — what was tried, rejected, or discovered.
4. **Build / change** — the implementation or workflow change, shown with real
   work whenever possible.
5. **Evidence / result** — observable proof of what works, fails, or remains
   unresolved.
6. **Payoff** — the useful lesson or capability gained.
7. **Next hook** — a short teaser/question for the natural next build step when
   one exists.

The series opener belongs inside this spine rather than before it: the hook must
still be visible or understandable from the first screen.

## Director workflow

1. **Capture the event.** Record the real problem, the constraint that made it
   matter, what was tried, and the working solution. Keep evidence and dates
   separate from interpretation.
2. **Choose the story.** State the concrete gap in one sentence, then shape a
   beginning (the failed expectation), middle (the investigation and build),
   and ending (the working result). Omit generic advice, unrelated framework
   ideas, private data, and claims that the evidence does not support.
3. **Plan the picture, voice, and sound.** For every beat, decide whether
   narration, on-screen text, a code/terminal demonstration, screenshot,
   recording, presenter footage, and BGM treatment are useful. Prefer screen
   recording for actions/motion and screenshots for static state/proof. Use
   placeholders for missing assets instead of inventing results.
4. **Produce capture outputs.** For every approved beat, create/update both
   `RECORDING_PLAN.md` and, when presenter/camera footage is required,
   `capture-tour.json`. The recording plan contains the complete desktop +
   camera shot list. The NeoX tour contains only the human/camera subset and
   must use the stable shot IDs from the recording plan.
5. **Run the Capture Agent.** Follow `CAPTURE_AGENT.md`: record desktop evidence
   on the Mac, run presenter/camera shots through NeoX, and collect the actual
   media under the episode. Do not treat planned shots as captured evidence.
6. **Review captured media.** Create/update `CAPTURE_REVIEW.md` from inspected
   files and NeoX `tour.status`. Essential missing/retake items block the gate
   unless the story is explicitly revised. Update `episode.md` to reference
   accepted media only.
7. **Validate and preview.** After the capture review gate passes, run Markcut's
   validation or safe storyboard preview. Record the exact command and result.
   A preview is a technical check, not editorial approval.
8. **Final review.** Leave final render and publication for the user. After
   review, update the source notes with corrections and retain only useful
   evidence.

Markcut owns Markdown validation, preview, and rendering; Director owns the
content and story decisions.
