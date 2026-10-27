# Synthetic design acceptance — no real episode, approvals, or publication

Everything in this page is a fabricated teaching fixture. Media, GPS, timestamps, owner consent, music rights, reviews, QA and authorization events are **SYNTHETIC**. The materialized artifacts stay under ignored `runs/2026-10-21-workflow-design/`; tracked excerpts below are copied from the same deterministic generator output. Parser validation is structural only and is never playback, render, audio, or hosted-player E2E.

These examples are historical synthetic fixtures from the former `vlog-editor -> vlog-producer` flow. The current canonical Episode Graph adds Visioner and separates Director (shot selection, optional route/location research and story) from Editor (precise cuts), then Producer and Final QA. Do not use the fixture graph to plan a new episode.

| Boundary | No GPS — 阳台上的突然小雨 | Partial GPS — 市场里找回笔记本 | GPS enhanced — 天台风筝被风抢走 |
| --- | --- | --- | --- |
| Sources | `SYN-N1` text fixture 0–4s; `SYN-N2` 4–8s; coordinates absent | `SYN-P1` 0–3s at synthetic `43.60,-79.30`; `SYN-P2` 3–8s absent | `SYN-G1` 0–4s at synthetic `43.60,-79.30`; `SYN-G2` 4–7s at `43.70,-79.40` |
| Event / tension / payoff | Rain suddenly hits; phone almost slips; books are rescued; standing water reflects returning light | Notebook slides from a bag; stalls obscure the trail; the walker retraces remembered stalls; a blue cover appears under a bench | Wind tightens the kite line and steals it over a railing; the chase crosses to a park; the kite stops in a bush |
| Research | `NOT_APPLICABLE`; no map; no invented locality | One authorized position sample only; untagged `SYN-P2` remains unlocated; movement `not_established` | Two privacy-scoped position samples; movement remains `unknown`; samples are not a recorded track |
| Production | 0–3 hook, 3–4 tension, 4–6 recovery, 6–8 payoff; each r1/r2 beat records synthetic original/ambient sound, composition, motion, and entry/exit transition | 0–3 hook, 3–5 tension, 5–6 recovery, 6–8 payoff; per-beat editorial plan makes no location implication for untagged footage | 0–3 hook, 3–4 tension, 4–5 recovery, 5–7 payoff, 7–9 optional map, 9–11 recap; map entry/exit is explicit and remains non-route context |
| Music / captions | BGM `NOT_PROVEN`; duck to `-24 dB`; WebVTT r1→r2 copy changes | Same BGM/rights hold; caption explicitly says position unknown | Same BGM/rights hold; map is capped at 2s after payoff and says samples only |
| Review revision | r1 `CHANGE_REQUIRED`: make the caption an event sentence, not the title. r2 changes video and VTT bytes | r1 `CHANGE_REQUIRED`: remove continuity from the unlocated shot. r2 changes video and VTT bytes | r1 `CHANGE_REQUIRED`: label samples instead of a route. r2 changes video and VTT bytes |
| QA / publication | Structural `PASS`; playback/audio/captions `NOT_RUN`; authorization absent ⇒ `HOLD` | Same; authorization absent ⇒ `HOLD` | Structural `PASS`; maps/audio/captions/playback `NOT_RUN`; authorization absent ⇒ `HOLD` |

Each fixture directory contains hashed `assets/*.synthetic.txt`, `source-manifest.json`, `research-evidence.json`, revision-specific `story-r1.md`/`story-r2.md`, `visual-brief-r1.md`/`visual-brief-r2.md`, and `editorial-plan-r1.json`/`editorial-plan-r2.json`, plus current r2 aliases, `music-plan.json`, `captions-r1.vtt`, `captions-r2.vtt`, immutable `video-r1.md`/`video-r2.md`, structured review records, `qa.json`, and `publication-hold.json`. Every review binds the exact video `revisionId`/`contentHash` and hashes of source media, source manifest, story, visual brief, music plan, captions, and production video.

## Actual Markcut excerpts

```markdown
## hook instruction:"雨点突然砸下" sourceId:"SYN-N1" shotRange:"0-3s" start:0 duration:3
- component duration:3 jsx:"<div style={{background:'#174EA6',color:'white',width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center'}}>SYNTHETIC 雨点突然砸下</div>"
```

```markdown
## hook instruction:"笔记本从袋口滑出" sourceId:"SYN-P1" shotRange:"0-3s" start:0 duration:3
- component duration:3 jsx:"<div style={{background:'#174EA6',color:'white',width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center'}}>SYNTHETIC 笔记本从袋口滑出</div>"
```

```markdown
## hook instruction:"风筝线突然绷直" sourceId:"SYN-G1" shotRange:"0-3s" start:0 duration:3
- component duration:3 jsx:"<div style={{background:'#174EA6',color:'white',width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center'}}>SYNTHETIC 风筝线突然绷直</div>"

## map instruction:"两个示例地点，非真实路线" start:7 duration:2
- map view:route duration:2 mapType:roadmap waypoints:[43.6,-79.3,"Stop 1"; 43.7,-79.4,"Stop 2"]
```

The GPS map is deliberately placed after payoff. It renders two approved samples and carries no `travelMode`; therefore it never claims a recorded path or movement mode.

## Negative revision and publication gates

1. The persisted r1 review is `CHANGE_REQUIRED`; it can never authorize r2. A positive r2 review is `PASS` and `simulated: true` with `authorizationEffect: NONE`.
2. Changing any referenced asset, manifest, story, visual brief, music plan, caption, or production-video bytes changes the exact dependency hash and makes the prior review stale.
3. Authorization alone never publishes. Missing authorization, boolean-only authorization, simulated authorization, scope/account/platform mismatch, stale review, `NOT_RUN` QA, or unproven rights each produce a distinct `HOLD` reason.
4. Even when every production prerequisite is simulated as complete, a synthetic fixture returns `SYNTHETIC_FIXTURE_NOT_PUBLISHABLE`. Real publication additionally requires an owner outside this fixture and observable hosted QA.
