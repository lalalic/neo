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
4. Request changes through the live Markcut Preview UI; preserve versioned Markdown revisions in the ignored run. Do not approve a revision by proxy.
5. After design approval, instantiate the *creative structure* with actual authorized media, original audio and documented source ranges. The 6-second fixture is not a required final episode duration.

The demo's remote MP4 is a test clip, its WAV is a test soundbed and its SRT is a technical transcript fixture. None documents a real event or establishes soundtrack licensing for public publication.

## Real episode gating

A template review can establish editorial choices but **cannot** satisfy the production requirements in `cinematic-episode.md`: source-manifest authorization, Video Director and Market PASS on the same draft hash, full rendered playback QA, sound/music rights and separate publication authorization. If real source media or audio rights are missing, mark `INPUT_NEEDED` and do not publish.

Do not hardcode the demo's external resource URLs into real episodes. Resolve episode assets under the project's NeoY `vlog` mount, keeping a single canonical `video.md` in `vlog/runs/`.
