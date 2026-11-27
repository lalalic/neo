---
name: elevenlabs-stt
description: Optional source-authorized ElevenLabs Scribe speech-to-text CLI adapter for Neo Visioner via the product-elevenlabs Markcut profile; preserves word timestamps, diarized speakers and raw transcription evidence.
---

# ElevenLabs Scribe STT — shared Neo Skill

**Scope:** Reusable optional STT backend for any Neo Project using shared Visioner. **Markcut `vision` stays the sole visual/segment-understanding interface.** This Skill only turns authorized audio into private WebVTT + source-bound Scribe JSON. It is not a separate Vision agent, media acquisition process or default transcription service.

## Prerequisites / authorization

- Verify the actual full original media and its permitted use. A signed-in website, publicly viewable XHS post or personal collection does **not** establish permission to send third-party audio to ElevenLabs. Check the project's rights/transfer rules before any cloud submission. If rights are unknown, HOLD cloud STT. **Never** reuse the license from a different job or provider.
- Stage a complete permitted source video under an ignored, private Run directory. Do not check in source bytes, transcripts, xsec tokens or signed URLs. On a source requiring network transfer to Worknode, use the approved Neo cluster transport; do not assume source paths are shared.
- Configure `ELEVENLABS_API_KEY` in an approved secret environment, never in the template string, CLI arguments, Git or logs. Without the key, the adapter fails closed. The API uses ElevenLabs Scribe v3 (`scribe_v3`) by default, optionally `scribe_v2`. This is paid cloud processing.
- **Explicitly authorize cloud upload** for this source and transcription request before passing the CLI's `--confirm-cloud-upload`. There are no blind retries on ambiguous failures. The adapter verifies source SHA-256 and caches raw Scribe output to avoid repeated paid calls.

## Neo Visioner + Markcut CLI

The shared Harness profile `product-elevenlabs.json` extends `product.json` and overrides only STT. Select it **only after explicit authorization for this source and paid cloud request**; the profile's adapter supplies `--confirm-cloud-upload`. Do not select it just because a source is publicly viewable. Normal Visioner runs use product; `--skip-stt` is for independently verified speech evidence. No Agent constructs its own STT template.

```sh
harness=$(neo workspace show | node -p 'JSON.parse(require("node:fs").readFileSync(0,"utf8")).harnessRoot')
markcut vision "$RUN/assets/source" --profile "$harness/agents/visioner-adapters/profiles/product-elevenlabs.json" --instruct "Source-backed story and shot context"
```

- Markcut extracts normalized audio to `.normalized/<video-stem>_audio.mp3`, then calls this STT adapter with `{input}` and `{output}` template expansion. The adapter writes `.normalized/<video-stem>_audio.vtt` and retains `.normalized/<video-stem>_audio.scribe.json`, plus `.normalized/<video-stem>_audio.scribe-source.json`. With an explicit profile, Markcut moves the generated subtitle to a profile-specific VTT under `.normalized/` and writes `metadata.json` with `perception.desc`, `perception.subtitle` and `perception.segments`.
- WebVTT is the **speech transcript**, distinct from Markcut's `--vtt` **video-to-text** CLI template. Timestamped visual evidence and transcript can be aligned in the Visioner artifact; speech alone cannot establish shot actions, visual expressions or audience response.
- The Scribe JSON keeps original word timing, diarization tags, detected language and non-speech audio events. Missing speaker labels are `speaker_unknown`, not guessed identities; inferred diarization is not a verified person's name. Raw word timestamps and the SHA-256 binding must be preserved for review.
- A transcription error, missing file, mismatched input/hash, missing key or cloud-rights blocker is **not** success. Markcut may warn and proceed with partial vision; Visioner must explicitly verify that the intended VTT and source binding exist before claiming STT was performed. No silent Whisper fallback while labeling output ElevenLabs.

Direct adapter invocation for a **verified authorized** audio file:

```sh
node "$harness/skills/elevenlabs-stt/scripts/scribe.mjs" \
  --input "$RUN/assets/source/clip_audio.mp3" \
  --output-dir "$RUN/assets/source/.normalized" \
  --confirm-cloud-upload
```

`--model scribe_v2` is optional; omit for Scribe v3. This direct adapter performs no ffmpeg extraction, no visual understanding and no publishing. It uploads exactly one supplied local audio file; avoid using it for clips already bound to another paid transcription unless intentional.

## Project-level selection

The project may select the shared product-elevenlabs profile when it requires word-timed Scribe STT and cloud authorization is valid. The project owns all rights, provider costs and upload permission. In particular, Content Distribution **Growth** XHS research selects product-elevenlabs for authorized full-video analysis; **Promotion** must preserve its existing complete licensed episode → Transcriber → speaker-resolution chain and should not rerun Scribe in Visioner. If Promotion already has verified speech evidence, Visioner uses `markcut vision --skip-stt` as before.
