# Vlog / Hey Neo — Visioner segmentation context

This is a Neo Project semantic instruction passed to the Markcut segmentation Agent via --instruct, not hardcoded in Markcut.

- Preserve original source IDs, source-local timestamps and every covered interval. Do not physically delete or concatenate source footage.
- ITT/VTT describe visual evidence; STT WebVTT transcribes speech. Never infer spoken content from silent frames.
- Recognize the creator's "嘿 Neo" / "Hey Neo" editing instructions by meaning, including nearby continuation cues, paraphrases and mixed languages.
- Distinguish editing instructions from spoken narration.
- Group meaningful original-source segments using video descriptions, STT cues, user hints and scene changes. VTT ranges are evidence, not mandatory boundaries.
- For keep/remove/emphasize/pacing/original sound requests, record in each related segment's optional instructions array the utterance, semantic intent, source-local time_seconds and confidence. Do not execute any edit.
- Uncertain references remain unresolved; leave uninteresting source footage represented.
- Only the Director selects story/shot order, Editor creates EDL and Producer renders.
