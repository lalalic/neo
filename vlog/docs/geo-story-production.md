# P0 — Automatic GPS Story in Cinematic Natural

The canonical Producer entry point is `node <vlog-root>/scripts/compile-cinematic-vlog.mjs episode-input.json video.md`, executed inside the episode's **canonical private run**. It checks originals for EXIF GPS by default, regardless of whether an optional `geo.media` list was provided. It invokes `lib/cinematic-episode.mjs` and `lib/geo-story.mjs` (no separate Relay or new Graph node).

## Director input contract

In the existing `episode-input.json`, preserve original `scenes`, source hashes, Editor `boundaries`, and authorized `music`. Add an optional `geo` block:

```json
{
  "geo": {
    "media": ["assets/photo-1.jpg", "assets/photo-2.jpg"],
    "disclosureApproved": true,
    "timeZone": "America/Toronto",
    "mediaEvidence": [{"source":"assets/photo-1.jpg","observed":"秋天树叶与蓝天","evidenceRef":"vision-evidence-photo-1"}],
    "locationEvidence": [{"source":"assets/photo-1.jpg","name":"卡纳塔","status":"verified","evidenceRef":"trusted-map-source-1"}]
  }
}
```

All `observed` content requires a Vision or owner source reference; unsupported observations are **not** inserted. Only labels with `status:verified` and `evidenceRef` may be used. Google Reverse Geocoding is optional, not an excuse to make up an address when an API denies access. If no place evidence exists, say simply “拍摄位置”. Date/time comes from trusted EXIF GPS clock with requested time zone. When sparse photos span hours, do **not** call the computed map route the actual route driven or visited. Do not infer transportation, local events, mood or street scenes. `overview` + `route` are selected for reliable stops; add `streetview` only after coverage and API checks, not automatically.

## Production and review

`route.md` contains two geographic scenes, explicit MP3 Mandarin narration (`assets/geo-story/voice-*.mp3`), and source attribution. Route maps are pre-rendered using **Markcut's own** `ensureVideoPreview()`; the frozen compiled Remotion tree (map footage plus original audio siblings) is rendered to `assets/route.mp4`. This avoids Google's unsupported direct Remotion-map mode and the development-watermark error. Producer strictly validates the frozen map videos, speech assets, and an actual MP4 audio stream. Source and narration hashes are recorded in `assets/geo-story/evidence.json`. Identical TTS scripts reuse validated audio bytes.

The canonical compiler inserts `assets/route.mp4` as a full-volume `gps-geography` scene **after the hook**, and records motivated boundary decisions on both sides, preserving all original source scenes. `video.md` includes the Route file, then Producer runs Markcut preview and final render. `episode-production.json` is a draft technical receipt, **not human acceptance or publication approval**.

- No credible GPS: produce the ordinary episode without Route.
- Credible GPS without location-disclosure authorization: `GPS_DISCLOSURE_REQUIRED`, stop the episode, do not silently omit the required Route.
- Map rendering failed, missing speech, or insufficient MP4 evidence: stop with an explicit error, do not mark the episode finished.
- Geocoding/Street View unavailable: keep the observed GPS stops and source-backed narration; omit unavailable third-party panoramas.
- Original source & BGM authorization still apply; preview-only media is not cleared for publication by this build.

The 2026-09-25 private pilot has owner permission for its observed locations; that permission does not cover unrelated episodes.
