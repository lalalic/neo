# Neo Visioner inference adapters

The shared executable `run-visioner.mjs` owns inference configuration and metadata
reuse; Markcut owns normalization, frame sampling, prompts, STT and segmentation.
The default adapter `codex-infer.mjs` invokes `agents-relay route --input-file -`
with capability facts, hard `reasoning: low`, and verified eligible Codex profiles.
No source data or prompt goes to the routing decision engine. It runs exactly the
selected provider/model/profile through Codex with low reasoning and a read-only
sandbox. Semantic segmentation is text-only, with a validated JSON-object result.
No hidden provider fallback or resubmission.

Provision the dedicated `vision-low.config.toml` in CODEX_HOME (or ~/.codex)
using an authorized, image-capable model with low reasoning. On Neo Master the
verified profile is OpenAI `gpt-6-luna`, low. The operator may set
`NEO_VISION_PROFILES` to a comma-separated set of other authorized, verified
low-reasoning vision profiles; the canonical router decides among them.
An unavailable or ineligible route fails closed. Markcut uses its built-in
chronological VTT frame sampling via the ITT hook; an explicit custom adapter
can override both hooks. Projects must authorize external transfer.

The optional existing WebHelm DeepSeek adapter is retained for callers that
explicitly choose it; it is no longer the shared default.

Tests: `node --test agents/visioner-adapters/*.test.mjs`.
