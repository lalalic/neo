# Cinematic template: interactive Markcut Preview

This is a **design fixture** for evaluating story rhythm and visual language, not a genuine episode or evidence that the production QA gates have passed.

## Quick preview

The source-controlled template is `vlog/templates/cinematic-preview-demo.md`. To review it with Markcut MCP, copy it to an ignored run and call `markcut.preview` on the **run's** Markdown file:

```bash
mkdir -p vlog/runs/YYYY-MM-DD-cinematic-template-preview
cp vlog/templates/cinematic-preview-demo.md vlog/runs/YYYY-MM-DD-cinematic-template-preview/video.md
```

For a checkout rooted at `/Users/chengli/Workspace/neo`, the currently validated design preview is:

`https://neoy.qili2.com/files/vlog/runs/2026-10-14-cinematic-template-preview/video.md`

Ask the MCP tool to preview that URL. The Vlog project root must first be mounted with `neoy.setup("files mount vlog /absolute/path/to/neo/vlog")`. The preview uses synthetic Markcut fixture media accessible under the separately authorized `markcut-review` mount.

## Template review loop

1. **Hook (0–2s)** — Is the audience promise readable and emotionally specific?
2. **Motion beat (2–4s)** — Does real moving imagery give visual interest instead of a static slideshow? Is the cut motivated?
3. **Payoff (4–6s)** — Does the ending connect to the hook? Are title and safe-area choices restrained?
4. **Synthetic route (6–9s)** — This is inferred navigation context between fictional stops, not a recorded track.
5. **Synthetic cinematic map (9–12s)** — Test a fly-along camera with the same fictional stops; do not imply real travel.
6. Request changes through the live Markcut Preview UI; preserve versioned Markdown revisions in the ignored run. Do not approve a revision by proxy.
7. After design approval, instantiate the *creative structure* with actual authorized media, original audio and documented source ranges. The 12-second fixture (6 seconds of synthetic story/editing beats plus 6 seconds of map context) is not a required final episode duration.

The demo's remote MP4 is a test clip, its WAV is a test soundbed and its SRT is a technical transcript fixture. None documents a real event or establishes soundtrack licensing for public publication.

## Real episode gating

A template review can establish editorial choices but **cannot** satisfy the production requirements in `cinematic-episode.md`: source-manifest authorization, Video Director and Market PASS on the same draft hash, full rendered playback QA, sound/music rights and separate publication authorization. If real source media or audio rights are missing, mark `INPUT_NEEDED` and do not publish.

Do not hardcode the demo's external resource URLs into real episodes. Resolve episode assets under the project's NeoY `vlog` mount, keeping a single canonical `video.md` in `vlog/runs/`.

## GPS-led journey variation

For geotagged photo/video episodes, use [GPS-ROUTE.md](GPS-ROUTE.md) and `lib/gps-route.mjs` to extract chronological location evidence, then place a native Markcut `map view:route` or `view:cinematic` beat between actual camera footage. Do not disclose precise private location in a public NeoY preview without permission.

## Map rendering acceptance gate

The preview fixture contains two Markcut-native map leaves (`view:route` and `view:cinematic`) with fictional waypoints. **Successful parsing and `markcut.preview` scene compilation do not prove that Google Maps tiles rendered.** The Markcut compiler stamps `GOOGLE_MAPS_API_KEY` into each map leaf when configured; if the key is absent, interactive map rendering remains unverified and must not be recorded as a passing visual QA check. Do not enable a billable external API without authorization. Independently verify the ChatGPT-hosted MCP iframe, playback/seek and audio, not only localhost or `/api/video-data`. Review/approval is separate from map render QA and publishing authorization.
