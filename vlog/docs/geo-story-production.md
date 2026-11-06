# Geo Story production

Executable route scenes come from [geo-story.md](../templates/geo-story.md), and the lightweight route overview from [route-overview.md](../templates/route-overview.md); this document governs factual evidence, not Markcut scene layout. Also see [Story-first route and sound](story-first-route-sound.md). Private previews may use verified original GPS precision without a second production gate. Before public release, ensure the owner's approval covers displayed exact/sensitive locations. The route view is a real Directions navigation geometry over observed stops, not an unrecorded track. Director chooses route story and evidence; Editor chooses exact placement, visual realization, Markcut authoring and verification.

## Director route decision and Editor integration

Director writes `route-intent.json` (include/omit, observed filmed stops, story purpose and desired beat). Editor maps it to `episode-input.geo` and produces the route media.

## Editor geo block

In the existing `episode-input.json`, preserve original `scenes`, source hashes, Editor `boundaries`, and authorized `music`. Add an optional `geo` block:

```json
{
  "geo": {
    "insertAfterSceneId": "journey",
    "media": ["assets/photo-1.jpg", "assets/photo-2.jpg"],
    "timeZone": "America/Toronto",
    "mediaEvidence": [{"source":"assets/photo-1.jpg","observed":"秋天树叶与蓝天","evidenceRef":"vision-evidence-photo-1"}],
    "locationEvidence": [{"source":"assets/photo-1.jpg","name":"卡纳塔","status":"verified","evidenceRef":"trusted-map-source-1"}]
  }
}
```

All `observed` content requires a Vision or owner source reference; unsupported observations are **not** inserted. Only labels with `status:verified` and `evidenceRef` may be used. Google Reverse Geocoding is optional, not an excuse to make up an address when an API denies access. If no place evidence exists, say simply “拍摄位置”. Date/time comes from trusted EXIF GPS clock with requested time zone. When sparse photos span hours, do **not** call the computed map route the actual route driven or visited. Do not infer transportation, local events, mood or street scenes. `overview` + `route` are selected for reliable stops; add `streetview` only after coverage and API checks, not automatically.


## Rendering and QA

Editor pre-renders narrated Markcut geographic scenes to a verified `route.mp4` and inserts it at Director's chosen story beat, preserving Editor transitions. The final episode keeps one continuous root BGM. For unreliable or absent GPS, omit the map without inventing movement. Verified place and knowledge facts require explicit evidence references. Any failed render or missing sound halts production; final release still needs separate owner authorization.

Editor must run `markcut verify` on `route.md` and `video.md` and watch actual route camera, audio and transitions in the viewer.
