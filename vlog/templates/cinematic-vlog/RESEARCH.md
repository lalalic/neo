# Open-source cinematic workflow reference study (2026-10-11)

**Scope:** public repository source inspection, not proof of the projects' advertised quality or a successful Neo video render. XiaoHongShu descriptions are discovery leads, not validated execution results. Existing private exploratory research in `vlog/runs/` is not copied or versioned here.

| Source / owner | Verified repository content | License and caution | Adopt in Neo | Deliberately do not adopt |
|---|---|---|---|---|
| [lemomo-ai/lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar) | Public `lemomo-ai` repository includes `DIRECTOR.md`, `TECHNIQUE.md`, `styles/`, `styleboard/`, examples; README advertises 43 styles and code-generated films | [MIT](https://github.com/lemomo-ai/lemo-opuscar/blob/main/LICENSE). Third-party audio, voice and sample assets may have separate terms | Separation of narrative/director decisions, style constraints, executable technique, iterative picture/audio self-checks | No code-generated film renderer, style library import, voice/audio assets, or claim that 43 styles work in Markcut |
| [Ding200602/video-shotcraft](https://github.com/Ding200602/video-shotcraft) | Public Ding200602 project credits Vincentwei1021; README describes recipe cards, Remotion templates, audio categories, 2.5D motion and beat alignment | [Apache-2.0](https://github.com/Ding200602/video-shotcraft/blob/main/LICENSE) for repository; bundled audio has separate rights, Remotion its own license | Shot-intent vocabulary, per-shot timing/easing/continuity plan, beat-alignment ledger, separate audio SFX and dialogue treatment | Do not import Remotion, templates, recipes, bundled assets or commercial/demo metrics as a proven Neo feature |

Sources were verified against repository pages on 2026-10-11. README counts such as 43 styles / 152 cards / 209 previews are **upstream self-reported inventories**, not independent performance, accuracy, or quality verification; not copied as Neo promises. Likewise, social posts' “cinematic” or “one-click” claims have not been proven. Repository-level MIT/Apache-2.0 does **not** imply that included music, branded footage, fonts, trademarks or dependencies can be republished. No implementation or media copied.

## Minimal reusable contracts

1. **Director/style:** `story.md` states true source IDs, intent, hook, tension, payoff. `visual-brief.md` specifies at most one primary visual language per sequence: mood/grade reference, composition, motivating camera movement, transitions, source truth, default joyous/lively tone; every beat has a selected footage range and purpose. Use establishing → wide → medium → detail only where those shots really exist. If absent, use an honest cut or ask for capture; never simulate personal events.
2. **Shot grammar:** each shot lists `source_id`, time range, intended duration, scale, screen direction/continuity, transition motive, crop/stabilization feasibility and source audio. The producer translates only renderer-supported treatment into canonical `video.md`; missing native grade, ramps, stabilization or adaptive ducking are logged in `execution/` as dependency, not claimed complete.
3. **Pace/sound:** `execution/timeline-audio.md` documents frame rate/aspect, each cut's timing and whether beat-aligned or story-motivated, beat timestamps measured from appropriately licensed BGM, ambiance/music/dialogue/SFX lanes, intended relative levels and speech ducking. Beats are guides, not an excuse to cut mid-action or overrun rights.
4. **Verification:** draft hash is common input to independent Video Director and Market PASS reports; final video requires actual rendered, watched-and-listened QA, ffprobe/media facts and the existing >=85/100 rubric. Human creative and final-video decisions are separate records tied to immutable hashes. Publish only upon further specific authorization and a platform receipt.

## Existing Neo comparison and remaining gaps

- `vlog/templates/cinematic-episode.md` already defines manifest, story, visual brief, Markcut `video.md`, parallel reviews and QA thresholds; `vlog/agents/vlog-editor.agent.md` and `vlog/agents/vlog-producer.agent.md` already divide editorial and production ownership. The graph makes the stages, paths and human checkpoints discoverable, rather than replacing those agents.
- `vlog/README.md`, `vlog/AGENTS.md` and `GRAPH.md` define **one top-level episode Task**. Relay owns its graph/recovery; Markcut renders; no Remotion or new orchestration engine.
- Unknown until actual render/pilot: whether selected Markcut runtime supports full-screen playback, specific grading, stabilization, speed ramps and adaptive ducking; whether a given license permits a soundtrack; whether measured beat synchronization and mix are audible/pleasant. These require capability checks and playback of real output, not document-only PASS.
- The separately blocked pilot media intake stays BLOCKED; no fabricated personal footage or implied source approval. A synthetic metadata fixture can test validations but is **not** cinematic-quality evidence.

## Bounded verification

Run `node --test vlog/test/cinematic-contract.test.mjs vlog/test/cinematic-template.test.mjs` from repository root. These are deterministic contract/document checks, **not** a full renderer pilot or audio QA. Any later approved genuine-media pilot must archive hashes, both independent reviews, actual player observation and QA in ignored episode `runs/`.
