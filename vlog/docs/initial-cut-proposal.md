# VTT + Hey Neo -> initial cut (provisional)

The Visioner first runs this **preprocess** with source metadata and available
**speech-to-text** WebVTT captions. Markcut visual Video-to-Text inference is
then run *after* the rough cut, with the rough-cut context. The video-to-text
concept and the WebVTT subtitle file are different things. Only an STT transcript
can support a spoken Hey Neo command; never infer speech from image frames.

Generate the first *proposal* from approved sources and existing Markcut metadata:

```bash
node vlog/scripts/propose-initial-cut.mjs \
  /Users/chengli/Workspace/neo/vlog/runs/<dated-episode> \
  --context "骑行 Vlog，讲述途中的所见所闻" --preview
```

The results are private run artifacts:
- `initial-cut-proposal.json`: provisional timecoded rough-cut EDL and Hey Neo constraints;
- `initial-cut-preview.mp4`: optional low-resolution playable H.264 proxy, with command speech muted;
- `vision-context.json`: structured input for the subsequent Markcut/DeepSeek Vision pass.

This **does not** write the accepted `shot-selection.json`, `edit-decision-list.json`,
canonical Markcut `video.md`, final MP4, or publication receipts.

The source hash is checked against every physical original before it becomes
eligible. No visual inference is required for a preliminary cut: video duration
comes from the manifest or ffprobe; available cached visual observations are
optional. The proposal links the STT cues to their speech times and any recognized
spoken command to an explicit candidate intent. The wake phrase plus the *immediately following*
utterance is an instruction, not story narration. For a wake phrase in one
cue, the next cue is considered only when it starts within 2.5 seconds.
Command audio is normally excluded; scene audio and unrelated dialogue remain.
Ambiguous instructions and uncertain referents are never silently applied.
Only a clear `remove` command that names exactly one verified source ID/file
can exclude that source from the proxy. Other commands remain reviewable
constraints for Director/Editor; the spoken command interval is muted in the
rough proxy but surrounding genuine sound remains.
Missing STT yields an explicit warning, not a claim that no commands exist.

An evidence-backed default rough order prefers the first real video as a
*provisional* opening-motion candidate, then available sources by verified
capture time. Its first 5 seconds are a technical candidate, not a claim of
the best hook. Director must choose the truthful hook, arc, story beats, source
windows, and any location context; Editor must refine exact in/out, original
sound decisions, and source-linked Hey Neo intent before producing an accepted
`edit-decision-list.json`. Producer still owns canonical `video.md`,
required Markcut preview approval and technical review.

The first result has status `DRAFT_DIRECTOR_EDITOR_REVIEW_REQUIRED` and
cannot itself satisfy any normal Vlog stage acceptance gate.

## Second pass: DeepSeek Vision

After the preprocessor writes a draft EDL, the Visioner loads `vision-context.json`
and supplies its text as the `--context` argument to Markcut Vision's existing
DeepSeek backend. It asks for visual evidence, scene relevance, improved selected
source ranges, and hook/payoff suitability while retaining original-source
timestamps. The rough-cut order is **context**, not proof that those shots should
survive. Do not analyze a proxy as though its timestamps were original source
camera timestamps; provide the original media files to Markcut Vision.

If STT is missing, report a gap; do not assume there were no Hey Neo commands.
Run an authorized Markcut STT pass when supported and regenerate the draft
before declaring spoken-control compliance. Never invent a command from vision.

A valid SSE reply and parseable tile JSON prove delivery, **not** the visual
accuracy of the model. A multi-image contact sheet may still misattribute
what belongs to a tile. Director must cross-check source IDs, labels and
visual evidence before treating model descriptions as source truth, especially
when the draft story context could bias interpretation.
