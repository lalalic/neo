# Audience-first everyday Vlog — research and creative review

**Goal:** Make a viewer in China care about a recognizable person experiencing ordinary Canadian life. The content is not a tourism montage, an arbitrary diary of everything recorded, a forced adversity arc, or an inspirational speech. **But an overfocused one-gesture edit that discards useful footage is also a failure**: a complete lived experience needs meaningful context, lead-in, interlude, reaction and aftertaste. Favor generous source coverage with reasoned exclusions instead of counting scenes or cutting to one fragment. This guide informs the existing Director → Editor stages; it does not add another agent, schema, approval gate, or compulsory duration.

## Research cases and transferable decisions (reviewed 2026-11-09)

- **Xiaohongshu, @平平无奇的小周:** An interview describes a widely viewed family-memory film made with imperfect old photos and everyday narration. Takeaway: choose a *specific lived relationship or small event* rather than optimizing photographic beauty. Secondary account; full note/video and current metrics were not independently inspected. https://info.51.ca/articles/1466968
- **Xiaohongshu, @julia_ty:** Case analysis describes the shift from everyday food mini-vlogs to a distinct visual point of view, with the essay-film 《你的生活，其实没有很多观众？》. Takeaway: a concrete personal *idea* can bind mundane moments more strongly than a location tour. Secondary case study, not current ranking evidence. https://www.newrank.cn/article/detail/27414
- **Xiaohongshu, 2024 account-growth sample / 2025 video sample:** Kas's retrospective of 500 fast-growing accounts identifies relaxed authentic daily-life vlogs; Qiangua's 2025 sample emphasizes lived process. Neither proves one universal algorithm or a guaranteed format. https://www.woshipm.com/share/6178203.html ; https://www.sdyanbao.com/detail/927499
- **Xiaohongshu, older creators:** Reporting on @梅英阿嬷 and @霞士比亚 shows that recognizable character and an unexpected personal perspective can resonate across age groups. This is not a mandate to be hyper-energetic or imitate someone else; an ordinary middle-aged narrator can have a quieter recognizable voice. Secondary reporting, not independently verified current counts. https://www.ginkgotime.com/index.php?a=index&aid=181&c=View&m=home
- **YouTube, Casey Neistat:** His own how-to-vlog explanation selects a small story from the day rather than a chronological everything-log; use establishing, locked and handheld perspectives to orient, observe and experience an action. Transfer story selection and visual grammar, *not* compulsory conflict/three acts. https://www.youtube.com/watch?v=Q980C74SdYQ
- **YouTube, Lucy Moon:** YouTube's creator interview foregrounds observational everyday life, deliberate sound, quiet pacing and authenticity. Transfer intentional quiet and tangible details, not a generic cinematic preset. https://blog.youtube/creator-and-artist-stories/discover-the-cinematic-vlogs-of-lucy-moon/
- **YouTube official retention guidance:** Strong intros deliver on the video's title/thumbnail promise; inspect actual first-30-second retention and dips/spikes, compare with videos of similar length. The 30-second report is a measurement window, **not** a command to make every Vlog 30 seconds or use a clickbait hook. https://support.google.com/youtube/answer/9314415 ; https://support.google.com/youtube/answer/16559650

## Director's creative decision (reasoning, not a new schema)

1. Inspect the footage and **real source audio**. Find up to three candidate *observed* human moments, not just pretty places. Each candidate must answer: *what can a stranger actually watch happen, and why might they care?* Prefer the one that is truthful, distinct to this creator, and has a real next beat or honest unfinished question.
2. Write privately a **viewer promise** in one concrete sentence: “Watch me notice / try / encounter ___, and by the end you will see / understand ___.” A calm, observational promise (“为什么在这条空路上停住了”) is valid. If footage cannot deliver, narrow the promise; do not invent a quest.
3. Choose one consistent **narrative lens** based on recorded evidence: small discovery, funny mishap, a useful Canada–China contrast, human interaction, quiet mood with concrete sensory detail, or an ongoing personal habit. Avoid imposing the same formula on every episode. A place, a season or a camera filter is not a lens by itself.
4. Start the manuscript with **a specific action, observation, on-camera line or question**, and develop that same line. Prefer first-person conversational Mandarin and modest wit. Distinctive voice means surprising *specifics*, not repeating a catchphrase or a personal biography. Let the ending pay off the actual opening or rest on a deliberate unresolved image/sound; no compulsory moral, reversal, struggle or victory.
5. Provide Editor with the promise/lens/hook/payoff in **existing** `story.md` or `visual-brief.md` prose; bind hook/payoff to verified source IDs and time ranges. Design `post.md` titles around the *same truthful promise*: concrete and human, never a scenic roll-call or unverified claim. No new machine-readable fields required.

## Editor's storytelling cut (not a rigid seconds template)

1. **Promise cut:** At the opening, show or hear the most understandable source-backed human moment. Arrange context afterward if needed. A cold open is optional; never reveal an action impossible to pay off. Judge first 5–10 seconds for clarity, but do not mechanically time every cut.
2. **Continuity cut:** Preserve real action before/during/after, gestures, source dialogue, looks, scene direction and spatial anchors. A tempting 1-second teaser must not cut off the very gesture that explains it. Use wide context briefly when it orients the viewer; use close detail when it advances the event. Reordering footage must not pretend events happened in a false chronology.
3. **Voice and sound cut:** Listen to real source speech when available; use it and ambient sound before covering an action with generated narration. A voiceover should add perspective or a useful Canada–China detail, **not repeat what the camera already shows**. Keep audible silence for purposeful anticipation or release; BGM must not bury words or ambience.
4. **Information-density cut:** Remove duplicate scenic passes, lists of locations, generic aphorisms, repeated hook images without new meaning, forced transitions and lengthy title sequences. A quiet shot earns its place when it supplies meaningful mood, recognition, timing, or a sense of presence. Fast cutting is not itself a quality signal.
5. **Viewer-check cut:** Watch the complete rendered draft with picture and sound (technical decode is insufficient). At natural pauses ask: *Do I know whose moment this is? What changed since the previous shot? Do I want to see the next one? Does the ending honor the opening?* Cut or rebuild weak sequences, then verify the actual Markcut revision.

## Creative evaluation (human/model judgment, separate from stage validator)

Run the optional [Director creative artifact evaluation](../.evals/rubrics/director.md) and
[Editor rubric](../.evals/rubrics/editor.md) against the **real Markdown**:
`node scripts/eval-creative-artifacts.mjs --run runs/<id> --stage both --prompt-only`.
This produces a source-coverage and craft report plus grounded judge prompts;
`--judge` invokes an independent model reviewer if available. Compare the
repaired cut against the same Run, but never allow keyword counts, transition
quantity or a model score to overrule truthful artistic judgement. No
publication gate is added.

Evaluate each 0–2: **opening clarity**, **creator specificity**, **one coherent progression**, **source audio/picture continuity**, **honest ending and title**. `0` = absent/misleading, `1` = present but weak, `2` = convincing. Record the concrete timestamp and improvement for each weakness in the existing Editor private review notes. This is a comparison rubric, **not** an automated publish gate or viral-score prediction. Test two differently structured short cuts from the *same real source* where feasible; choose by observed clarity, not by mechanical duration or perfect scenery.

**Evidence limitation:** Public reports/interviews support creative patterns, not measured performance of an unpublished Vlog; no claim about XHS/YouTube algorithm weights, virality probability or current creator metrics without channel analytics. Direct XHS post inspection may be blocked by browser access; keep secondary cases labeled as such.
