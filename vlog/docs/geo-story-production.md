# Geo Story production

Executable route scenes come from [geo-story.md](../templates/geo-story.md), and the lightweight route overview from [route-overview.md](../templates/route-overview.md); this document governs factual evidence, not Markcut scene layout. Also see [Story-first route and sound](story-first-route-sound.md). Private previews may use verified original GPS precision without a second production gate. Before public release, ensure the owner's approval covers displayed exact/sensitive locations. The route view is a real Directions navigation geometry over observed stops, not an unrecorded track. Director chooses route story, purpose and source-backed observed spots. **Editor selects the Markcut native map view(s)** that fit the story, their placement, motion, duration and transitions: `overview` (orientation), `route` (computed navigation between verified stops), `cinematic` (illustrative flyover over source-backed stops, not actual drone footage), and `streetview` (ground-level publicly available imagery for verified stop, not proof of when the creator visited). Optional combinations are a creative choice; a map is not mandatory.

## Director route decision and Editor integration

Director writes `route-intent.json` (include/omit, observed filmed stops, story purpose and desired beat). The primary viewers are in China: include concise, sourced Mandarin orientation when Canadian place/region context helps them follow the experience. Optional `audienceContext[]` facts have `fact` and `sourceRef` (e.g. original GPS/verified place evidence or a credible public URL); introduce relevant local geography, history or culture without guessing visited landmarks. Where GPS verifies only a stop, explain the stop, not a fictional journey. Editor records `episode-input.geo.mapViews[]` (one or more of the four native names), a grounded `mapReason`, and `streetviewCoverageRef` if `streetview` was chosen, and inserts each chosen `- map view:<type>` into `video.md`. Choose them based on story—not by a default list or by GPS count. If evidence only supports a single spot, `overview` can be sufficient; no fictitious path.

## Editor geo block

In the existing `episode-input.json`, preserve original `scenes`, source hashes, Editor `boundaries`, and authorized `music`. Add an optional `geo` block:

```json
{
  "geo": {
    "insertAfterSceneId": "journey",
    "mapViews": ["overview", "streetview"],
    "mapReason": "Orient Chinese viewers to a verified Canadian location, then show authentic available public street imagery",
    "streetviewCoverageRef": "verified-streetview-provider-check-001",
    "media": ["assets/photo-1.jpg", "assets/photo-2.jpg"],
    "timeZone": "America/Toronto",
    "mediaEvidence": [{"source":"assets/photo-1.jpg","observed":"秋天树叶与蓝天","evidenceRef":"vision-evidence-photo-1"}],
    "locationEvidence": [{"source":"assets/photo-1.jpg","name":"卡纳塔","status":"verified","evidenceRef":"trusted-map-source-1"}]
  }
}
```

All `observed` content requires a Vision or owner source reference; unsupported observations are **not** inserted. Only labels with `status:verified` and `evidenceRef` may be used. Google Reverse Geocoding is optional, not an excuse to make up an address when an API denies access. If no place evidence exists, say simply “拍摄位置”. Date/time comes from trusted EXIF GPS clock with requested time zone. When sparse photos span hours, do **not** call the computed map route the actual route driven or visited. Do not infer transportation, local events, mood or street scenes. `overview`, `route`, `cinematic` and `streetview` are choices, not a compulsory sequence. Use `route` or `cinematic` only with source-backed multi-stop geography, and do not represent computed directions as a recorded route. Use `streetview` only after coverage and API checks, not automatically.


## Rendering and QA

Editor authors Markcut-native route/map scenes directly in `video.md` (or `route.md` when a separately rendered chapter is needed), at Director's chosen story beat. The Producer renders the Markcut composition; do not introduce a duplicate Vlog route renderer. The final episode keeps one continuous root BGM. For unreliable or absent GPS, omit the map without inventing movement. Verified place and knowledge facts require explicit evidence references. Any failed render or missing sound halts production; final release still needs separate owner authorization.

Editor must run `markcut verify` on `route.md` and `video.md` and check source-linked route narration, media paths and transitions without requiring playback.
