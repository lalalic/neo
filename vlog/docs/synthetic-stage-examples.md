# SYNTHETIC design acceptance — no real Episode Task or approvals

All entries here are fabricated teaching fixtures. Coordinates, timestamps, permissions, audio ranges and approval events are **SIMULATED**, not assertions about a person, trip, rights or actual media. `video.md` snippets are parseable design inputs, not playable real footage or rendered output.

| Stage and gate | No GPS — SYNTHETIC | Partial GPS — SYNTHETIC | GPS enhanced — SYNTHETIC |
| --- | --- | --- | --- |
| Source (vlog-editor) | `SYN-N1` mock shot 0–3s, `SYN-N2` mock audio/shot 3–8s; manifest permission `SIMULATED_USE_OK`; GPS absent | `SYN-P1` mock 0–3s at `43.60,-79.30`, `SYN-P2` mock 3–8s no GPS; permission `SIMULATED_USE_OK`; missing point remains unknown | `SYN-G1` mock 0–3s `43.60,-79.30`, `SYN-G2` mock 3–8s `43.70,-79.40`; synthetic GPS UTC metadata, permission `SIMULATED_USE_OK` |
| Research (conditional researcher) | `NOT_APPLICABLE`, no map and no invented locality | Single source-linked fix only; no route, no inferred second stop, mode `unknown` | Two source-linked GPS samples; context map proposed; recorded route `false`, mode `unknown`; synthetic disclosure scope `SIMULATED_REDACTED_ONLY` |
| Story (vlog-editor) | Hook: a quiet beginning (N1); development: rhythm builds (N2); payoff: an edited closing moment (N2) | Hook: first glimpse (P1); development: detail beats (P2); payoff: reflection (P2). Never infer P2's position | Hook: first view (G1); development: a second image (G2); payoff: visual juxtaposition (G2). No claim of actual travel |
| Visual brief (vlog-editor) | Shot 0–3s N1, muted graphical placeholder; 3–6s N2 paced cut; 6–8s N2 title end card | Shot 0–3s P1; 3–6s P2 close crop; 6–8s P2 payoff. Single GPS location excluded from map | Shot 0–3s G1; 3–6s G2; 6–9s optional illustrative map `view:route` from synthetic points; 9–11s G2 closing |
| Production (vlog-producer) | `video.md` is a labeled component-placeholder draft; original sound reference `SYN-N2@3–6s`, `BGM_LICENSE_SIMULATED_ONLY`, Chinese captions + WebVTT intent | Same mocked original audio (`SYN-P2@3–6s`), `BGM_LICENSE_SIMULATED_ONLY`, Chinese captions; no map | Sound `SYN-G2@3–6s`, `BGM_LICENSE_SIMULATED_ONLY`, Chinese WebVTT captions, optional map with **simulated** disclosure |
| Preview Review (human via Relay) | `SIMULATED changes_requested` revision r1 → r2; see below; never an actual human PASS | `SIMULATED changes_requested`: remove unsupported location implication; r2 omits it | `SIMULATED changes_requested`: label connection *inferred context*; r2 updates caption |
| Video Director + Market | SIMULATED REVIEW ONLY, no PASS usable for real render | SIMULATED REVIEW ONLY | SIMULATED REVIEW ONLY |
| Technical QA (producer/shared QA) | Structural assertions PASS; hosted pixel/audio/seek/WebVTT `NOT_RUN` | Structural assertions PASS; hosted `NOT_RUN` | Structural assertions PASS; Maps tiles/animation/audio/seek/subtitles `NOT_RUN` |
| Publish Authorization (owner) | ABSENT ⇒ HOLD / archive-design only | ABSENT ⇒ HOLD / archive-design only | ABSENT ⇒ HOLD / archive-design only |

Synthetic manifest shape shared by these examples: `{ "fixture": "SYN-N1", "sha256": "SIMULATED-HASH-N1", "source": "generated placeholder", "captureTimeUtc": "SIMULATED", "gpsStatus": "absent", "rights": "SIMULATED_USE_OK_NOT_REAL_PERMISSION" }`. The P and G examples replace fixture IDs, recorded sample coordinates and GPS provenance (`SIMULATED_EXIF`); they never supply fabricated coordinates for absent fixes. The production files use CSS title cards instead of asserting that a real file, sound track or music license exists.

## Revision-and-review simulation (all values SIMULATED)

1. `revisionId=synthetic-r1`, `contentHash=sha256(video.md r1)`, dependencies `{sourceManifestHash: SYN-M1, storyHash: SYN-S1, musicPlanHash: SYN-B1, captionHash: SYN-C1}`. `SIMULATED changes_requested`: “Caption incorrectly implies these source samples prove a continuous journey.”
2. Edit only caption/script to “示意地点连接（并非实际轨迹）”; generate `synthetic-r2`, new `contentHash` and `captionHash=SYN-C2`. Old r1 review becomes **STALE**, never approved for r2. New simulated review is recorded against r2 and exactly its dependency identities; it is a fixture, not human approval.
3. Changes to source/story/music/caption identities independently invalidate previous review even if the video path is unchanged. No production preview, audio QA, ownership approval or publication is inferred.

The runnable deterministic examples are generated under ignored `runs/2026-10-21-workflow-design/` using `node vlog/scripts/synthetic-workflow-examples.mjs`. The separate existing two-path synthetic pilot is retained.
