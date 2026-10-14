# GPS-first cinematic Vlog

Location and capture time from original photo/video metadata are primary **evidence** for story structure. Do not invent locations, time, speed or transport modes. Obtain GPS from the original photo/HEIC/MOV/MP4 using ExifTool before transcoding or stripping metadata.

## Evidence processing

1. Inventory original asset hashes, capture timestamps, timezone provenance, GPS latitude/longitude, GPS accuracy and whether location is absent. Video location may be in QuickTime metadata; use an ExifTool extraction that supports all native source formats.
2. Preserve the raw metadata with source-file IDs privately in `source-manifest.json`; GPS points must link back to actual media. Account for inaccurate device clocks, timezone ambiguity, edited metadata, and GPS outliers.
3. Order media using trustworthy capture time. Build `route.json` and `route.md` in the ignored episode directory only from geotagged, approved assets. Do not fill gaps by guessing.
4. Associate story beats, visual-brief shot IDs, timestamps and media with location stops. Introduce the journey with a restrained route map, then alternate actual footage with map beats as warranted. A map is navigation context, never substitute footage.
5. Shared Markcut supports `- map view:route` and `view:cinematic`, as well as Google Maps route/3D camera, but runtime Google Maps keys and rendering must be verified in the target host. Use observed GPS stop sequence; **a Google Directions road route is computed, not recorded travel**. Only specify `travelMode` when evidenced or explicitly confirmed.
6. Respect privacy: home and sensitive places should be omitted, blurred/coarsened or reviewed before exposure. Publishing exact GPS coordinates requires explicit approval. A public NeoY Mount is not private storage: keep raw coordinates and original EXIF in protected storage unless exposure is authorized.

## Minimal executable tooling

`vlog/lib/gps-route.mjs` exports `readGpsMetadata(paths)`, `extractRoutePoints(records)` and `routeScene(points)`. It emits a Markcut map leaf from timestamp-ordered geotagged media, and fails when fewer than two GPS points exist.

Example Markcut syntax (fictional coordinates, **illustrative only**):

```markdown
## Journey overview
- map view:route duration:7 mapType:roadmap waypoints:[43.6,-79.3,"Stop 1";43.7,-79.4,"Stop 2"]
```

In a real run, combine this with actual selected photo/video leaves and original sound; have humans approve both the route disclosure and creative treatment via Markcut Preview. The user-facing template approval does not authorize publishing or certify actual movement between sparse GPS points.


## Private source-manifest and visual-brief contract

Keep `source-manifest.json` in an ignored, permission-restricted episode directory, never in a public NeoY file mount. Every source entry needs: `sourceId`, `sha256`, `mediaType`, `originalPath`, `rightsStatus`, `useApproved`, `captureTimeRaw`, `captureTimeUtc`, `timeProvenance`, `locationProvenance`, `gpsAccuracyMeters`, `gpsStatus`, `privacyClass`, and optional `originalSoundRange`. Private manifest may contain raw GPS; the shared visual brief must not. Missing location or timezone is an explicit status, not guessed from file mtime or editing location.

Visual-brief shot entries reference `sourceId`, exact in/out times, narrative purpose, original-audio choice, and approval status. The map shot references a private route-segment ID and a *separately approved redacted coordinate export*, never the raw manifest. Media without GPS remains usable as footage but must not become a fictional map stop.

## Rendering and evidence classification

1. `readGpsMetadata(originalPaths)` uses ExifTool GPS and QuickTime tags. Resolve device-local timestamps only with embedded EXIF offsets or an explicitly supplied timezone. Ambiguous clock values are not trusted for movement ordering.
2. `extractRoutePoints(records)` retains time provenance. `segmentRoute(points)` separates long gaps, rejects implausible speeds and inaccurate fixes, and sets `trackedMovement:false`. Threshold rejection is a screening rule, not positive proof of a travelled route.
3. Omit sensitive stops and coarsen retained coordinates using `publicRoutePoints(points,{approved:true,precision:2,excludeSources})` **only after explicit human GPS disclosure approval**. Choose privacy precision based on the actual disclosure risk. Redacted output may still disclose sensitive geography. The original GPS must remain private.
4. `routeScene(redactedPoints,{disclosureApproved:true,view:'route'})` or `view:'cinematic'` generates a map context leaf. It does not demonstrate tracked roads or actual transport. If a calculated Google Directions path is shown, label it *inferred navigation*, not observed movement. Do not enable `travelMode` by default.
5. Preview with the native Markcut MCP iframe. Verify scene compilation, Google Maps readiness/API access, route coordinates, play/pause/seek, and audio. A successful compile or longer startup watchdog does not prove the map rendered. Do not treat a review preview as approval, and do not publish without separate media/rights and publication consent.

Illustrative coordinates in the source-controlled demo are **synthetic**. Neither its locations nor soundtrack establish a real episode.
