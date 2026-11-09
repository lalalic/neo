# Visioner actual-artifact reviewer: six independent axes (0–5)

Judge **vision-evidence.json** and **vision-normalized-manifest.json** against the real approved source inventory, not Visioner prompt compliance. Do not claim that text summaries exhaust uninspected frames or actual audio. Required axes:
- `source_coverage`: every authorized media ID represented, useful sampling of human behavior, non-repetitive context.
- `temporal_provenance`: exact original source IDs/hashes, timecode bounds, segment identity, normalization not mistaken for final footage.
- `human_action_audio`: evidence-rich description of real gestures, reactions and uncertain STT rather than scenery-only captions.
- `creator_intent_signals`: preserved `嘿 Neo` annotations where Markcut actually identifies them; missing annotation does not prove no command was spoken.
- `uncertainty_honesty`: distinguishes inference, model text, actual listened voice and open questions; does not invent recorded action.
- `director_handoff`: describes usable story candidates and source-specific moments, not editorial orders or unverified facts.

Score each axis 0–5 with specific evidence and executable repair suggestion. Never issue creative PASS from schema-only evidence.
