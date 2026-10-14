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
