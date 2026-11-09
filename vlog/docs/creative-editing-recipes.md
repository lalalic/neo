# IT佬加国砰砰砰 · creative editing playbook

**Creator / viewer:** A Chinese-speaking IT worker in Canada, sometimes dealing with AI, IT work, immigration information, parenting, exploration or midlife. The format is an **actual day's experience plus imaginative conversational commentary**. Humor is a point of view on real events, never a claim that an unfilmed mishap or private conversation took place.

## One story, a whole bag of footage

Director must inspect and consider **every approved source**. In `visual-brief.md` give a `素材盘点与取舍理由` table: source ID, authentic moment, possible story function (event/context/reaction/cutaway/ambience/callback), use or omit with reason. A scene that feels unrelated to the central action may provide a useful visual breath or time/place context. It may equally be cut. Avoid one-split dominance and 10 disconnected scenic stops alike; no footage quotas or maximum duration.

Choose one of six primary directions, but enrich with human reaction, interesting cultural comparisons, observations, speculation clearly marked as speculation, gentle self-mockery, odd questions and funny timing. The writer may be *imaginative with words* without falsifying filmed acts, spoken dialogue or the narrator's private emotional testimony. A complete but uneventful outing is a legitimate story.

## Executable treatments, not instructions claiming an effect exists

Pick recipes from the installed `video-shotcraft/references/shots` catalog (124 cards). Useful mappings for this personal Vlog:

| Footage opportunity | Shotcraft idea | Markcut / React implementation | Sound decision |
| --- | --- | --- | --- |
| Recognizable discovery / small surprise | `camera/crash-zoom-punch` (one accent, not repeated) | Short original-source crop with native `effects` scale keyframes; cut to detail | A quiet original `discovery-chime.wav` |
| Walking route and scene orientation | `transition/transition-hidden-cut` and `transition/circle-match-iris` | Matched shape/motion cut, brief `transition:cut`, `wipe` or `fade` where Markcut actually supports; map only with real GPS | Footsteps or scene ambience across boundary |
| A self-deprecating aside | `opening/letterspace-materialize` | Markcut `- component duration:...` React/JSX caption or thought bubble (never fake source dialogue) | `awkward-pluck.wav` or real silence |
| Two genuine reactions or moments | `transition/card-flip-reveal` | Side-by-side composition or a short matched split-screen showing *real* source media | Sound bridge, not machine-gun effects |
| Quiet observation | `camera/depth-layer-moves` | Slow animated crop on a true still, minimal text; preserve the actual texture | Source ambience, music ducked |
| Closing callback | `opening/text-as-mask` | Short return to the actual opening object, optional branded caption | Resolve the opening 3-tap motif gently |

**Use Markcut's real DSL:** `- image ... effects:[{...}]` supports custom keyframe motion; a `- component duration:... jsx:"..."` or `~~~jsx` block supports React overlays; scene-level `transition` and supported transitionSeries must be verified. A text instruction in `instruction:` does not execute a transition. Root audio, actual source speech and timed SFX are separate streams; avoid unsupported packages, black tails, audio clipping and blanket volume 0.

### React component opportunities

1. **BrandSting:** short animated graphic “给生活加点料” with three pulses; can overlap a genuine cold-open shot or play as a brief bumper. Use the same sound every time; vary only placement.
2. **ThoughtCaption:** subtle self-deprecating aside (“这次又想多了”), labeled commentary rather than source speech, with a quick upward pop.
3. **AwkwardFreeze:** *hold the original frame*, add a nonfactual “空气突然安静” typographic pause + real ambience; do not claim an accident occurred.
4. **CanadaContext:** a compact location/context label where grounded, rather than expensive faux news graphics; never use unverified local facts or precise private GPS.
5. **BeforeAfterSplit:** split-screen of two genuinely existing clips, not a hypothetical scene presented as footage.
6. **RouteThread:** short animated map for verified observed stops; arrows between points are illustrative unless actual GPS tracks exist.

Use one motivated accent per meaningful beat, not six transition types per clip. Build/reuse a project-owned JSX component only after `markcut verify` and an actual render prove the syntax and appearance. Keep any public reusable component deterministic (no web fonts or external image URLs).

## Sound personality

The original royalty-free-free **self-generated sound cues** in `assets/brand/` are opt-in: three small wooden taps (`brand-three-taps.wav`), comic pause (`awkward-pluck.wav`), discovery (`discovery-chime.wav`), and minor disappointment (`tiny-flop.wav`). These are original signal synthesis, not sampled copyrighted meme sounds. Short SFX may overlay the template-selected bed without replacing it; keep `BGM volume:0.7` and measure actual mix. They do not replace the specified **Worknode ChatTTS male** voiceover.

**Permanent title motif:** “给生活加点料” (only the precise phrase) appears on-screen each episode and is voiced if an **authorized original recording** or real Worknode ChatTTS male file exists; do not invent one. Natural human delivery variants for voice recording or ChatTTS: conspiratorial/soft, playful punchy, slightly embarrassed/dry. Keep the motto short to respect the actual hook. Text graphics plus the original three-tap sting still work when speech synthesis is unavailable; don't label that voiced.

Before handing off, ask the independent Creative Artifact Eval to critique `story.md` and `video.md`; then actually watch the render and listen to audio. Syntax PASS and the AI judge's score do not mean the film is compelling or publish-ready.
