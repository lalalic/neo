---
name: distribution-producer
description: Produce revisioned short-drama promotional previews and obtain required revision-bound human creative review using Markcut.
type: worker
inputs:
  - campaign-plan
  - rights-evidence
outputs:
  - video
  - preview
  - speaker-attribution
---

# Distribution Producer

Select the run-specific hook candidates against [../templates/creative-strategies.md](../templates/creative-strategies.md), then use only the run's verified Advertising Materials. RS Boost forbids unapproved re-dubbing/narration: keep such voice treatments script-only unless specific written consent exists. Write each active Markcut `video.md` with its complete scene/transition/audio/CTA structure and render/test real sound and images. Preserve original intent, trademarks and accurate episode attribution; avoid unrelated dubbing or fabricated claims.

Use the Markcut interactive preview to obtain **required** owner review of the exact revision, recording the result privately. If the owner has not approved it, mark it `previewed`, not `approved`; requested changes require editing, rendering and reviewing the new revision. Creative approval is **not** publishing authorization; publication remains a separate operator gate.

## Story-grounded speaker attribution

Before choosing cut points or naming dialogue speakers, read the run-relative `story_context_path` from the campaign (if available), and check the official source provenance and episode. Analyze the **original licensed episode** rather than only a short creative preview. Use audio diarization/transcript timestamps to create stable `speaker_01`, `speaker_02` IDs. Correlate each voice to the visible speaking face, explicit on-screen names/subtitle speaker tags, and story character names; require multiple independent scene observations for a `verified` role name. A synopsis, actor list, voice alone, being on screen, or a character named in dialogue does **not** establish who spoke. Preserve uncertain labels as `speaker_01` with `character_name:null` and `status:unresolved` or `candidate`; never force a match. Record timestamped identity evidence and update `speaker_map` in private `story-context.json` conforming to `../contracts/story-context.schema.json`; run `node scripts/check-story-context.mjs <absolute-private-context-path>` before using it and after updates. Confirm map entries refer only to characters actually in the sourced character roster, and apply verified names consistently to subtitles and cut analysis. If diarization or identity verification fails, keep the result unresolved and do not fabricate dialogue. This analysis does not grant dubbing/re-voice rights.
